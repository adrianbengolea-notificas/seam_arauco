import { getAdminDb } from "@/firebase/firebaseAdmin";
import { AppError } from "@/lib/errors/app-error";
import { requireAsset } from "@/modules/assets/service";
import { getCentroConfigMergedCached } from "@/modules/centros/config-cache";
import { scheduleMaterialCatalogMatchAfterCreate } from "@/modules/materials/material-match-scheduler";
import {
  addMaterialLineAdmin,
  addMaterialOtFieldAdmin,
  applySalidaStockPorOtTransaction,
  getMaterialCatalogItemAdmin,
} from "@/modules/materials/repository";
import type { MaterialLineWorkOrder } from "@/modules/materials/types";
import { getAvisoById, updateAviso } from "@/modules/notices/repository";
import { requireAviso } from "@/modules/notices/service";
import type { Especialidad, TipoAviso } from "@/modules/notices/types";
import {
  addChecklistItemsBatch,
  addEvidenciaDoc,
  appendHistorialAdmin,
  createWorkOrderDoc,
  getChecklistItemDoc,
  getWorkOrderById,
  updateChecklistItemDoc,
  updateWorkOrderDoc,
} from "@/modules/work-orders/repository";
import {
  materialOtDenormFromWorkOrder,
  type MaterialNormalizacion,
  type ChecklistItem,
  type EvidenciaOT,
  type FirmaDigital,
  type WorkOrder,
  type WorkOrderSubTipo,
  type WorkOrderVistaStatus,
} from "@/modules/work-orders/types";
import { FieldValue, Timestamp as AdminTimestamp } from "firebase-admin/firestore";

function tipoFromSubtipo(st: WorkOrderSubTipo): TipoAviso {
  if (st === "correctivo") return "CORRECTIVO";
  return "PREVENTIVO";
}

async function nextNotNumber(): Promise<string> {
  const ref = getAdminDb().collection("counters").doc("work_orders");
  const next = await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const prev = (snap.data()?.seq as number | undefined) ?? 1_000_000;
    const seq = prev + 1;
    txn.set(ref, { seq }, { merge: true });
    return seq;
  });
  return next.toString().padStart(8, "0");
}

export async function createWorkOrderFromAviso(input: {
  avisoId: string;
  actorUid: string;
  checklistPlantilla?: Array<Omit<ChecklistItem, "id" | "cumplido_en" | "cumplido_por_uid">>;
}): Promise<string> {
  const aviso = await requireAviso(input.avisoId);
  if (aviso.work_order_id) {
    throw new AppError("CONFLICT", "El aviso ya tiene OT generada", {
      details: { work_order_id: aviso.work_order_id },
    });
  }

  const asset = await requireAsset(aviso.asset_id);
  const n_ot = await nextNotNumber();

  const base: Omit<WorkOrder, "id" | "created_at" | "updated_at"> = {
    n_ot,
    aviso_id: aviso.id,
    asset_id: asset.id,
    codigo_activo_snapshot: asset.codigo_nuevo,
    ubicacion_tecnica: aviso.ubicacion_tecnica,
    centro: aviso.centro,
    frecuencia: aviso.frecuencia,
    especialidad: aviso.especialidad,
    tipo_trabajo: aviso.tipo,
    estado: "ABIERTA",
    texto_trabajo: aviso.texto_corto,
    prioridad: aviso.prioridad,
    fecha_inicio_programada: aviso.fecha_programada ?? null,
    firma_tecnico: null,
    firma_usuario: null,
  };

  const id = await createWorkOrderDoc(base);
  await updateAviso(aviso.id, {
    estado: "OT_GENERADA",
    work_order_id: id,
  });

  await appendHistorialAdmin(id, {
    tipo: "CREADA",
    actor_uid: input.actorUid,
    payload: { aviso_id: aviso.id, n_ot },
  });

  if (input.checklistPlantilla?.length) {
    await addChecklistItemsBatch(
      id,
      input.checklistPlantilla.map((c) => ({
        ...c,
        cumplido_en: null,
        cumplido_por_uid: null,
      })),
    );
  }

  return id;
}

export async function assignTechnician(input: {
  workOrderId: string;
  tecnicoUid: string;
  tecnicoNombre: string;
  actorUid: string;
}): Promise<void> {
  const wo = await requireWorkOrder(input.workOrderId);
  if (wo.estado !== "ABIERTA" && wo.estado !== "EN_EJECUCION") {
    throw new AppError("CONFLICT", "No se puede asignar técnico en el estado actual");
  }

  await updateWorkOrderDoc(input.workOrderId, {
    tecnico_asignado_uid: input.tecnicoUid,
    tecnico_asignado_nombre: input.tecnicoNombre,
  });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "ASIGNACION",
    actor_uid: input.actorUid,
    payload: { tecnicoUid: input.tecnicoUid },
  });
}

export async function startExecution(input: { workOrderId: string; actorUid: string }): Promise<void> {
  const wo = await requireWorkOrder(input.workOrderId);
  if (wo.estado !== "ABIERTA") {
    throw new AppError("CONFLICT", "Solo se puede iniciar ejecución desde ABIERTA");
  }

  await updateWorkOrderDoc(input.workOrderId, {
    estado: "EN_EJECUCION",
    fecha_inicio_ejecucion: FieldValue.serverTimestamp(),
  });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "ESTADO_CAMBIO",
    actor_uid: input.actorUid,
    payload: { desde: "ABIERTA", hacia: "EN_EJECUCION" },
  });
}

export async function addMaterialToWorkOrder(input: {
  workOrderId: string;
  line: Omit<MaterialLineWorkOrder, "id" | "created_at">;
  actorUid: string;
}): Promise<string> {
  const wo = await requireWorkOrder(input.workOrderId);
  if (wo.estado !== "EN_EJECUCION" && wo.estado !== "ABIERTA") {
    throw new AppError("CONFLICT", "No se pueden agregar materiales en el estado actual");
  }

  const lineId = await addMaterialLineAdmin(input.workOrderId, input.line);
  await appendHistorialAdmin(input.workOrderId, {
    tipo: "MATERIAL",
    actor_uid: input.actorUid,
    payload: { lineId, codigo: input.line.codigo_material },
  });
  return lineId;
}

export async function registerEvidenceAfterUpload(input: {
  workOrderId: string;
  meta: Omit<EvidenciaOT, "id" | "created_at">;
  actorUid: string;
}): Promise<string> {
  const wo = await requireWorkOrder(input.workOrderId);
  if (
    wo.estado !== "EN_EJECUCION" &&
    wo.estado !== "ABIERTA" &&
    wo.estado !== "PENDIENTE_FIRMA_SOLICITANTE" &&
    wo.estado !== "LISTA_PARA_CIERRE"
  ) {
    throw new AppError("CONFLICT", "No se pueden adjuntar evidencias en el estado actual");
  }

  const evidenciaId = await addEvidenciaDoc(input.workOrderId, input.meta);
  await appendHistorialAdmin(input.workOrderId, {
    tipo: "EVIDENCIA",
    actor_uid: input.actorUid,
    payload: { evidenciaId, path: input.meta.storage_path },
  });
  return evidenciaId;
}

export async function signTechnician(input: {
  workOrderId: string;
  firma: FirmaDigital;
  actorUid: string;
}): Promise<void> {
  const wo = await requireWorkOrder(input.workOrderId);
  if (wo.estado !== "EN_EJECUCION" && wo.estado !== "ABIERTA") {
    throw new AppError("CONFLICT", "Firma de técnico no permitida en este estado");
  }
  if (input.firma.signer_capacity !== "TECNICO") {
    throw new AppError("VALIDATION", "La firma debe ser de capacidad TECNICO");
  }
  if (input.firma.signer_user_id !== input.actorUid) {
    throw new AppError("FORBIDDEN", "El firmante debe coincidir con el usuario autenticado");
  }

  const patch: Record<string, unknown> = {
    firma_tecnico: input.firma,
    estado: "PENDIENTE_FIRMA_SOLICITANTE",
  };

  if (wo.estado === "ABIERTA") {
    patch.fecha_inicio_ejecucion = FieldValue.serverTimestamp();
  }

  await updateWorkOrderDoc(input.workOrderId, patch);

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "FIRMA_TECNICO",
    actor_uid: input.actorUid,
    payload: { signed_at: "server" },
  });
}

export async function signUsuarioPlanta(input: {
  workOrderId: string;
  firma: FirmaDigital;
  actorUid: string;
}): Promise<void> {
  const wo = await requireWorkOrder(input.workOrderId);
  if (!wo.firma_tecnico) {
    throw new AppError("CONFLICT", "Debe existir firma de técnico antes de la del usuario de planta");
  }
  if (wo.estado !== "PENDIENTE_FIRMA_SOLICITANTE") {
    throw new AppError("CONFLICT", "La firma de planta no corresponde en este estado");
  }
  if (input.firma.signer_capacity !== "USUARIO_PLANTA") {
    throw new AppError("VALIDATION", "La segunda firma debe ser USUARIO_PLANTA");
  }
  if (input.firma.signer_user_id !== input.actorUid) {
    throw new AppError("FORBIDDEN", "El firmante debe coincidir con el usuario autenticado");
  }

  await updateWorkOrderDoc(input.workOrderId, {
    firma_usuario: input.firma,
    estado: "LISTA_PARA_CIERRE",
  });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "FIRMA_USUARIO",
    actor_uid: input.actorUid,
    payload: { signed_at: "server" },
  });
}

export async function createWorkOrderFromForm(input: {
  actorUid: string;
  centro: string;
  asset_id: string;
  especialidad: Especialidad;
  sub_tipo: WorkOrderSubTipo;
  texto_trabajo: string;
  aviso_id?: string;
  aviso_numero?: string;
  fecha_inicio_programada?: AdminTimestamp | null;
  tecnico_asignado_uid?: string;
  tecnico_asignado_nombre?: string;
  frecuencia_plan_mtsa?: "M" | "T" | "S" | "A";
  ubicacion_tecnica?: string;
  denom_ubic_tecnica?: string;
}): Promise<string> {
  const asset = await requireAsset(input.asset_id);
  const n_ot = await nextNotNumber();
  const tipo_trabajo = tipoFromSubtipo(input.sub_tipo);

  let aviso = null as Awaited<ReturnType<typeof getAvisoById>>;
  if (input.aviso_id) {
    aviso = await getAvisoById(input.aviso_id);
    if (!aviso) {
      throw new AppError("NOT_FOUND", "Aviso no encontrado", { details: { aviso_id: input.aviso_id } });
    }
    if (aviso.work_order_id) {
      throw new AppError("CONFLICT", "El aviso ya tiene OT generada", {
        details: { work_order_id: aviso.work_order_id },
      });
    }
  }

  const ubicacion =
    input.ubicacion_tecnica?.trim() || aviso?.ubicacion_tecnica || "—";
  const frecuencia = aviso?.frecuencia ?? "UNICA";
  const aviso_numero = aviso?.n_aviso ?? input.aviso_numero;
  const aviso_id_final = aviso?.id ?? input.aviso_id ?? "";

  const base: Omit<WorkOrder, "id" | "created_at" | "updated_at"> = {
    n_ot,
    aviso_id: aviso_id_final,
    asset_id: asset.id,
    codigo_activo_snapshot: asset.codigo_nuevo,
    ubicacion_tecnica: ubicacion,
    centro: input.centro,
    frecuencia,
    especialidad: input.especialidad,
    tipo_trabajo,
    estado: "ABIERTA",
    texto_trabajo: input.texto_trabajo.trim(),
    firma_tecnico: null,
    firma_usuario: null,
    sub_tipo: input.sub_tipo,
    aviso_numero,
    frecuencia_plan_mtsa: input.frecuencia_plan_mtsa,
    equipo_codigo: asset.codigo_nuevo,
    denom_ubic_tecnica: input.denom_ubic_tecnica?.trim() || undefined,
    fecha_inicio_programada: (
      input.fecha_inicio_programada !== undefined
        ? input.fecha_inicio_programada
        : (aviso?.fecha_programada ?? null)
    ) as WorkOrder["fecha_inicio_programada"],
    tecnico_asignado_uid: input.tecnico_asignado_uid,
    tecnico_asignado_nombre: input.tecnico_asignado_nombre,
  };

  const id = await createWorkOrderDoc(base);

  if (aviso) {
    await updateAviso(aviso.id, {
      estado: "OT_GENERADA",
      work_order_id: id,
    });
  }

  await appendHistorialAdmin(id, {
    tipo: "CREADA",
    actor_uid: input.actorUid,
    payload: { aviso_id: aviso_id_final, n_ot },
  });

  return id;
}

export async function applyWorkOrderVistaStatus(input: {
  workOrderId: string;
  status: WorkOrderVistaStatus;
  actorUid: string;
}): Promise<void> {
  if (input.status === "EN_CURSO") {
    await startExecution({ workOrderId: input.workOrderId, actorUid: input.actorUid });
    return;
  }
  if (input.status === "CANCELADA") {
    await anularWorkOrder({ workOrderId: input.workOrderId, actorUid: input.actorUid });
    return;
  }
  throw new AppError("VALIDATION", "Transición no soportada");
}

export async function anularWorkOrder(input: { workOrderId: string; actorUid: string }): Promise<void> {
  const wo = await getWorkOrderById(input.workOrderId);
  if (!wo) {
    throw new AppError("NOT_FOUND", "Orden de trabajo no encontrada", { details: { workOrderId: input.workOrderId } });
  }
  if (wo.estado === "CERRADA") {
    throw new AppError("CONFLICT", "No se puede anular una OT cerrada");
  }
  if (wo.estado === "ANULADA") {
    return;
  }

  await updateWorkOrderDoc(input.workOrderId, { estado: "ANULADA" });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "ESTADO_CAMBIO",
    actor_uid: input.actorUid,
    payload: { hacia: "ANULADA" },
  });
}

export async function addMaterialOtField(input: {
  workOrderId: string;
  actorUid: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  origen: "ARAUCO" | "EXTERNO";
  observaciones?: string;
  catalogoIdConfirmado?: string;
}): Promise<string> {
  const wo = await requireWorkOrder(input.workOrderId);
  if (wo.estado !== "EN_EJECUCION" && wo.estado !== "ABIERTA") {
    throw new AppError("CONFLICT", "No se pueden agregar materiales en el estado actual");
  }

  let normalizacion: MaterialNormalizacion = "pendiente";
  let catalogo_id: string | undefined;
  let codigo_material: string | undefined;
  let descripcion_match: string | undefined;

  const confirmado = input.catalogoIdConfirmado?.trim();
  if (confirmado) {
    const mat = await getMaterialCatalogItemAdmin(confirmado);
    if (!mat || mat.activo === false) {
      throw new AppError("NOT_FOUND", "Ítem de catálogo inactivo o inexistente");
    }
    normalizacion = "confirmada";
    catalogo_id = mat.id;
    codigo_material = mat.codigo_material;
    descripcion_match = mat.descripcion;
  }

  const denorm = materialOtDenormFromWorkOrder(wo, input.workOrderId);
  const lineId = await addMaterialOtFieldAdmin(input.workOrderId, {
    descripcion: input.descripcion.trim(),
    cantidad: input.cantidad,
    unidad: input.unidad.trim(),
    origen: input.origen,
    observaciones: input.observaciones?.trim(),
    creado_por: input.actorUid,
    schema_version: 1,
    normalizacion,
    catalogo_id,
    codigo_material,
    descripcion_match,
    ...denorm,
  });

  if (confirmado && catalogo_id && codigo_material && descripcion_match) {
    await applySalidaStockPorOtTransaction({
      materialId: catalogo_id,
      codigoMaterial: codigo_material,
      descripcionMaterial: descripcion_match,
      cantidad: input.cantidad,
      unidad: input.unidad.trim(),
      otId: input.workOrderId,
      registradoPorUid: input.actorUid,
    });
  } else {
    const centroCfg = await getCentroConfigMergedCached(wo.centro);
    if (centroCfg.modulos.ia) {
      scheduleMaterialCatalogMatchAfterCreate({
        workOrderId: input.workOrderId,
        lineId,
        textoOriginal: input.descripcion.trim(),
        cantidad: input.cantidad,
        unidad: input.unidad.trim(),
        especialidad: wo.especialidad,
        registradoPorUid: input.actorUid,
      });
    }
  }

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "MATERIAL",
    actor_uid: input.actorUid,
    payload: { lineId, schema: "material_ot_v1" },
  });

  return lineId;
}

export async function updateChecklistItemService(input: {
  workOrderId: string;
  itemId: string;
  completed: boolean;
  actorUid: string;
}): Promise<void> {
  const wo = await requireWorkOrder(input.workOrderId);
  if (wo.estado === "CERRADA" || wo.estado === "ANULADA") {
    throw new AppError("CONFLICT", "No se puede editar el checklist en el estado actual");
  }

  const item = await getChecklistItemDoc(input.workOrderId, input.itemId);
  if (!item) {
    throw new AppError("NOT_FOUND", "Ítem de checklist no encontrado");
  }
  if (item.tipo !== "BOOLEANO") {
    throw new AppError("VALIDATION", "Solo ítems booleanos usan este flujo");
  }

  await updateChecklistItemDoc(input.workOrderId, input.itemId, {
    respuesta_boolean: input.completed,
    cumplido_por_uid: input.completed ? input.actorUid : null,
    cumplido_en: input.completed ? FieldValue.serverTimestamp() : null,
  });
}

export async function closeWorkOrderWithPadSignatures(input: {
  workOrderId: string;
  actorUid: string;
  firma_usuario_pad: string;
  firma_tecnico_pad: string;
  firma_usuario_nombre: string;
  firma_tecnico_nombre: string;
}): Promise<void> {
  const wo = await requireWorkOrder(input.workOrderId);
  if (wo.estado !== "ABIERTA" && wo.estado !== "EN_EJECUCION") {
    throw new AppError("CONFLICT", "Solo se puede cerrar con firmas desde ABIERTA o EN_EJECUCION");
  }
  const cfg = await getCentroConfigMergedCached(wo.centro);
  const needUserSig = cfg.requiere_firma_usuario_cierre;
  const u = input.firma_usuario_pad.trim();
  const t = input.firma_tecnico_pad.trim();
  if (t.length < 100) {
    throw new AppError("VALIDATION", "La firma del técnico es obligatoria");
  }
  if (needUserSig && u.length < 100) {
    throw new AppError("VALIDATION", "La firma del usuario de planta es obligatoria");
  }

  const patch: Record<string, unknown> = {
    estado: "CERRADA",
    fecha_fin_ejecucion: FieldValue.serverTimestamp(),
    firma_tecnico_pad: t,
    firma_tecnico_pad_nombre: input.firma_tecnico_nombre.trim(),
    firmado_at: FieldValue.serverTimestamp(),
    cerrada_por_uid: input.actorUid,
  };
  if (needUserSig) {
    patch.firma_usuario_pad = u;
    patch.firma_usuario_pad_nombre = input.firma_usuario_nombre.trim();
  } else {
    patch.firma_usuario_pad = "";
    patch.firma_usuario_pad_nombre = "";
  }

  await updateWorkOrderDoc(input.workOrderId, patch);

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "CIERRE",
    actor_uid: input.actorUid,
    payload: { modo: needUserSig ? "pad_dual" : "pad_tecnico" },
  });
}

export async function closeWorkOrder(input: {
  workOrderId: string;
  actorUid: string;
  motivo?: string;
}): Promise<void> {
  const wo = await requireWorkOrder(input.workOrderId);
  if (wo.estado !== "LISTA_PARA_CIERRE") {
    throw new AppError("CONFLICT", "La OT debe estar en LISTA_PARA_CIERRE para cerrarse");
  }
  if (!wo.firma_tecnico || !wo.firma_usuario) {
    throw new AppError("CONFLICT", "Cierre bloqueado: faltan firmas obligatorias");
  }

  await updateWorkOrderDoc(input.workOrderId, {
    estado: "CERRADA",
    fecha_fin_ejecucion: FieldValue.serverTimestamp(),
    cerrada_por_uid: input.actorUid,
    motivo_cierre: input.motivo,
  });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "CIERRE" as const,
    actor_uid: input.actorUid,
    payload: { motivo: input.motivo },
  });
}

export async function updateWorkOrderInformeText(input: {
  workOrderId: string;
  texto_trabajo: string;
  actorUid: string;
}): Promise<void> {
  const wo = await requireWorkOrder(input.workOrderId);
  if (wo.estado === "CERRADA" || wo.estado === "ANULADA") {
    throw new AppError("CONFLICT", "No se puede editar el informe en el estado actual");
  }

  await updateWorkOrderDoc(input.workOrderId, {
    texto_trabajo: input.texto_trabajo.trim(),
  });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "INFORME_ACTUALIZADO",
    actor_uid: input.actorUid,
    payload: { longitud: input.texto_trabajo.trim().length },
  });
}

export async function requireWorkOrder(workOrderId: string): Promise<WorkOrder> {
  const wo = await getWorkOrderById(workOrderId);
  if (!wo) {
    throw new AppError("NOT_FOUND", "Orden de trabajo no encontrada", { details: { workOrderId } });
  }
  if (wo.estado === "ANULADA") {
    throw new AppError("CONFLICT", "La OT está anulada");
  }
  return wo;
}
