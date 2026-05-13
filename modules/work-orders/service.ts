import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { AppError } from "@/lib/errors/app-error";
import { limpiarAntecesorAlCerrarOrden } from "@/lib/mantenimiento/antecesor-orden-admin";
import { buildClaveMantenimiento } from "@/lib/mantenimiento/clave-mantenimiento";
import { getPlanMantenimientoAdmin, setPlanIncluidoOtPendiente, updatePlanMantenimientoAfterClose } from "@/lib/plan-mantenimiento/admin";
import { ASSETS_COLLECTION, getAssetById } from "@/modules/assets/repository";
import type { Asset } from "@/modules/assets/types";
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
import type { Aviso, Especialidad, TipoAviso } from "@/modules/notices/types";
import { crearNotificacionSeguro } from "@/lib/notificaciones/crear-notificacion";
import {
  destinatariosClienteArauco,
  destinatariosSupervisoresAdmin,
} from "@/lib/notificaciones/destinatarios";
import {
  avisoFirestoreDocId,
  diasParaVencimientoDesdeProximo,
  diasPorMtsa,
  estadoVencimientoDesdeDias,
  inferMtsaDesdeAviso,
  proximoVencimientoDesdeFecha,
} from "@/lib/vencimientos";
import { getIsoWeekId, isoDiaSemanaDesdeDateLocal } from "@/modules/scheduling/iso-week";
import { scheduleWorkOrderInWeek } from "@/modules/scheduling/service";
import type { EspecialidadPrograma, DiaSemanaPrograma } from "@/modules/scheduling/types";
import { clearWorkOrderIdEnProgramaSemanaAdmin } from "@/modules/scheduling/repository";
import { uploadFirmaDigitalFromDataUrl } from "@/modules/work-orders/firma-storage-admin";
import { allocateNextNotNumberInTransaction } from "@/modules/work-orders/n-ot-counter";
import {
  addChecklistItemsBatch,
  addEvidenciaDoc,
  adminWorkOrderRef,
  appendHistorialAdmin,
  getChecklistItemDoc,
  getWorkOrderById,
  newWorkOrderDocId,
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
import { FieldValue, Timestamp as AdminTimestamp, type Transaction } from "firebase-admin/firestore";
import { startOfDay } from "date-fns";

function tipoFromSubtipo(st: WorkOrderSubTipo): TipoAviso {
  if (st === "correctivo") return "CORRECTIVO";
  return "PREVENTIVO";
}

function avisoRef(avisoId: string) {
  return getAdminDb().collection(COLLECTIONS.avisos).doc(avisoId);
}

/** Disciplinas que pueden no tener equipo en `assets` (id vacío o inexistente). Incluye HG (misma lógica operativa que el eléctrico en programación). */
function disciplinaAceptaActivoOpcional(especialidad: string | undefined): boolean {
  const n = (especialidad ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return n === "ELECTRICO" || n === "ELEC" || n === "HG";
}

/** Eléctrico puede operar sin equipo en maestros; el resto exige activo existente. */
async function resolveAssetForAvisoInTransaction(txn: Transaction, avisoFresh: Aviso): Promise<Asset | null> {
  const aid = (avisoFresh.asset_id ?? "").trim();
  if (disciplinaAceptaActivoOpcional(avisoFresh.especialidad)) {
    if (!aid) return null;
    const asnap = await txn.get(getAdminDb().collection(ASSETS_COLLECTION).doc(aid));
    if (!asnap.exists) return null;
    return { id: asnap.id, ...(asnap.data() as Omit<Asset, "id">) };
  }
  if (!aid) {
    throw new AppError("VALIDATION", "El aviso no tiene activo vinculado", { details: { avisoId: avisoFresh.id } });
  }
  const asnap = await txn.get(getAdminDb().collection(ASSETS_COLLECTION).doc(aid));
  if (!asnap.exists) {
    throw new AppError("NOT_FOUND", "Activo no encontrado", { details: { assetId: aid } });
  }
  return { id: asnap.id, ...(asnap.data() as Omit<Asset, "id">) };
}

export async function createWorkOrderFromAviso(input: {
  avisoId: string;
  actorUid: string;
  checklistPlantilla?: Array<Omit<ChecklistItem, "id" | "cumplido_en" | "cumplido_por_uid">>;
  fecha_inicio_programada?: AdminTimestamp | null;
  tecnico_asignado_uid?: string;
  tecnico_asignado_nombre?: string;
  /** Si true, marca `plan_mantenimiento/{avisoId}.incluido_en_ot_pendiente` y `plan_id` en la OT. */
  sincronizarPlanPendiente?: boolean;
}): Promise<string> {
  const aviso = await requireAviso(input.avisoId);
  if (aviso.work_order_id) {
    throw new AppError("CONFLICT", "El aviso ya tiene OT generada", {
      details: { work_order_id: aviso.work_order_id },
    });
  }

  const ant = aviso.antecesor_orden_abierta;
  if (ant?.work_order_id?.trim()) {
    throw new AppError(
      "CONFLICT",
      `Cerrá primero la OT n.º ${ant.n_ot} (aviso SAP ${ant.n_aviso}) del mismo mantenimiento antes de generar una nueva.`,
      { details: ant },
    );
  }

  const woId = newWorkOrderDocId();
  const refAviso = avisoRef(aviso.id);
  let n_ot = "";

  await getAdminDb().runTransaction(async (txn) => {
    const avisoSnap = await txn.get(refAviso);
    if (!avisoSnap.exists) {
      throw new AppError("NOT_FOUND", "Aviso no encontrado", { details: { avisoId: input.avisoId } });
    }
    const avisoFresh = { id: avisoSnap.id, ...(avisoSnap.data() as Omit<Aviso, "id">) };
    if (avisoFresh.work_order_id) {
      throw new AppError("CONFLICT", "El aviso ya tiene OT generada", {
        details: { work_order_id: avisoFresh.work_order_id },
      });
    }
    const antF = avisoFresh.antecesor_orden_abierta;
    if (antF?.work_order_id?.trim()) {
      throw new AppError(
        "CONFLICT",
        `Cerrá primero la OT n.º ${antF.n_ot} (aviso SAP ${antF.n_aviso}) del mismo mantenimiento antes de generar una nueva.`,
        { details: antF },
      );
    }

    /** Lecturas de activo antes del contador `n_ot`: ese paso ya escribe en Firestore. */
    const asset = await resolveAssetForAvisoInTransaction(txn, avisoFresh);

    const claveMantenimiento =
      avisoFresh.clave_mantenimiento?.trim() ||
      buildClaveMantenimiento({
        ubicacion_tecnica: avisoFresh.ubicacion_tecnica,
        frecuencia: avisoFresh.frecuencia,
        especialidad: avisoFresh.especialidad,
        tipo: avisoFresh.tipo,
      });

    const nNum = await allocateNextNotNumberInTransaction(txn);
    n_ot = nNum.toString().padStart(8, "0");
    const especialidadOt: Especialidad = asset?.especialidad_predeterminada ?? avisoFresh.especialidad;

    const fechaProg = (
      input.fecha_inicio_programada !== undefined
        ? input.fecha_inicio_programada
        : (avisoFresh.fecha_programada ?? null)
    ) as WorkOrder["fecha_inicio_programada"];

    const base: Omit<WorkOrder, "id" | "created_at" | "updated_at"> = {
      n_ot,
      aviso_id: avisoFresh.id,
      archivada: false,
      asset_id: asset?.id ?? "",
      codigo_activo_snapshot: asset?.codigo_nuevo ?? "",
      ubicacion_tecnica: avisoFresh.ubicacion_tecnica,
      centro: avisoFresh.centro,
      frecuencia: avisoFresh.frecuencia,
      especialidad: especialidadOt,
      tipo_trabajo: avisoFresh.tipo,
      clave_mantenimiento: claveMantenimiento,
      estado: "ABIERTA",
      texto_trabajo: avisoFresh.texto_corto,
      ...(avisoFresh.prioridad != null ? { prioridad: avisoFresh.prioridad } : {}),
      fecha_inicio_programada: fechaProg,
      firma_tecnico: null,
      firma_usuario: null,
      ...(input.sincronizarPlanPendiente === true ? { plan_id: avisoFresh.id } : {}),
      ...(input.tecnico_asignado_uid
        ? {
            tecnico_asignado_uid: input.tecnico_asignado_uid,
            tecnico_asignado_nombre: input.tecnico_asignado_nombre ?? "",
          }
        : {}),
    };

    const avisoPatch: Record<string, unknown> = {
      estado: "OT_GENERADA",
      work_order_id: woId,
      updated_at: FieldValue.serverTimestamp(),
    };
    if (!avisoFresh.clave_mantenimiento?.trim()) {
      avisoPatch.clave_mantenimiento = claveMantenimiento;
    }
    /** Alinea `incluido_en_semana` con `fecha_inicio_programada` de la OT; si no hay fecha válida, conserva la semana ya marcada o usa la semana actual. */
    let semanaIsoParaAviso: string | undefined;
    if (fechaProg != null && typeof (fechaProg as { toDate?: () => Date }).toDate === "function") {
      const d = (fechaProg as { toDate: () => Date }).toDate();
      if (!Number.isNaN(d.getTime())) {
        semanaIsoParaAviso = getIsoWeekId(d);
      }
    }
    if (semanaIsoParaAviso == null) {
      const prevIso = String(avisoFresh.incluido_en_semana ?? "").trim();
      if (!/^\d{4}-W\d{2}$/.test(prevIso)) {
        semanaIsoParaAviso = getIsoWeekId(new Date());
      }
    }
    if (semanaIsoParaAviso != null) {
      avisoPatch.incluido_en_semana = semanaIsoParaAviso;
    }
    txn.update(refAviso, avisoPatch as Record<string, unknown>);
    txn.set(adminWorkOrderRef(woId), {
      ...base,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  const id = woId;

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

  if (input.sincronizarPlanPendiente === true) {
    await setPlanIncluidoOtPendiente(aviso.id, id);
  }

  return id;
}

export async function assignTechnician(input: {
  workOrderId: string;
  tecnicoUid: string;
  tecnicoNombre: string;
  actorUid: string;
}): Promise<void> {
  const ref = adminWorkOrderRef(input.workOrderId);
  const uid = input.tecnicoUid.trim();
  let historialPayload: Record<string, unknown> | null = null;

  await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "OT no encontrada", { details: { workOrderId: input.workOrderId } });
    }
    const wo = { id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) };
    if (wo.estado === "ANULADA") {
      throw new AppError("CONFLICT", "La OT está anulada");
    }
    if (wo.estado !== "ABIERTA" && wo.estado !== "EN_EJECUCION") {
      throw new AppError("CONFLICT", "No se puede asignar técnico en el estado actual");
    }

    if (!uid) {
      if (!wo.tecnico_asignado_uid?.trim()) {
        return;
      }
      txn.update(ref, {
        tecnico_asignado_uid: "",
        tecnico_asignado_nombre: "",
        updated_at: FieldValue.serverTimestamp(),
      });
      historialPayload = { desasignado: true };
      return;
    }

    const nombre = input.tecnicoNombre.trim() || uid;
    const prevUid = wo.tecnico_asignado_uid?.trim() ?? "";
    const prevNombre = wo.tecnico_asignado_nombre?.trim() ?? "";
    if (prevUid === uid && (prevNombre || prevUid) === nombre) {
      return;
    }

    txn.update(ref, {
      tecnico_asignado_uid: uid,
      tecnico_asignado_nombre: nombre,
      updated_at: FieldValue.serverTimestamp(),
    });
    historialPayload = { tecnicoUid: uid };
  });

  if (historialPayload) {
    await appendHistorialAdmin(input.workOrderId, {
      tipo: "ASIGNACION",
      actor_uid: input.actorUid,
      payload: historialPayload,
    });
  }
}

export async function startExecution(input: { workOrderId: string; actorUid: string }): Promise<void> {
  const ref = adminWorkOrderRef(input.workOrderId);
  await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "OT no encontrada", { details: { workOrderId: input.workOrderId } });
    }
    const wo = { id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) };
    if (wo.estado === "ANULADA") {
      throw new AppError("CONFLICT", "La OT está anulada");
    }
    if (wo.estado !== "ABIERTA") {
      throw new AppError("CONFLICT", "Solo se puede iniciar ejecución desde ABIERTA");
    }
    txn.update(ref, {
      estado: "EN_EJECUCION",
      fecha_inicio_ejecucion: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
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
  if (input.firma.signer_capacity !== "TECNICO") {
    throw new AppError("VALIDATION", "La firma debe ser de capacidad TECNICO");
  }
  if (input.firma.signer_user_id !== input.actorUid) {
    throw new AppError("FORBIDDEN", "El firmante debe coincidir con el usuario autenticado");
  }
  const dataUrl = input.firma.image_data_url_base64?.trim();
  if (!dataUrl) {
    throw new AppError("VALIDATION", "Firma del técnico requerida");
  }

  const wo0 = await requireWorkOrder(input.workOrderId);
  const centroCfg = await getCentroConfigMergedCached(wo0.centro);
  const needUserSig = Boolean(centroCfg.requiere_firma_usuario_cierre);

  const up = await uploadFirmaDigitalFromDataUrl({
    workOrderId: input.workOrderId,
    role: "tecnico",
    dataUrl,
  });

  const firmaPersist: FirmaDigital = {
    signer_user_id: input.firma.signer_user_id,
    signer_display_name: input.firma.signer_display_name,
    signer_capacity: "TECNICO",
    signed_at: input.firma.signed_at,
    storage_path: up.storage_path,
    download_url: up.download_url,
  };

  const ref = adminWorkOrderRef(input.workOrderId);

  await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "OT no encontrada", { details: { workOrderId: input.workOrderId } });
    }
    const wo = { id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) };
    if (wo.estado === "ANULADA") {
      throw new AppError("CONFLICT", "La OT está anulada");
    }
    if (wo.firma_tecnico) {
      throw new AppError("CONFLICT", "Ya existe firma del técnico registrada");
    }
    if (wo.estado !== "EN_EJECUCION" && wo.estado !== "ABIERTA") {
      throw new AppError("CONFLICT", "Firma de técnico no permitida en este estado");
    }

    const patch: Record<string, unknown> = {
      firma_tecnico: firmaPersist,
      estado: needUserSig ? "PENDIENTE_FIRMA_SOLICITANTE" : "LISTA_PARA_CIERRE",
      updated_at: FieldValue.serverTimestamp(),
    };
    if (wo.estado === "ABIERTA") {
      patch.fecha_inicio_ejecucion = FieldValue.serverTimestamp();
    }
    txn.update(ref, patch);
  });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "FIRMA_TECNICO",
    actor_uid: input.actorUid,
    payload: { signed_at: "server", usuario_planta_requerida: needUserSig },
  });
}

export async function signUsuarioPlanta(input: {
  workOrderId: string;
  firma: FirmaDigital;
  actorUid: string;
}): Promise<void> {
  if (input.firma.signer_capacity !== "USUARIO_PLANTA") {
    throw new AppError("VALIDATION", "La segunda firma debe ser USUARIO_PLANTA");
  }
  if (input.firma.signer_user_id !== input.actorUid) {
    throw new AppError("FORBIDDEN", "El firmante debe coincidir con el usuario autenticado");
  }
  const dataUrl = input.firma.image_data_url_base64?.trim();
  if (!dataUrl) {
    throw new AppError("VALIDATION", "Firma del usuario de planta requerida");
  }

  const wo0 = await requireWorkOrder(input.workOrderId);
  const centroCfg = await getCentroConfigMergedCached(wo0.centro);
  if (!centroCfg.requiere_firma_usuario_cierre) {
    throw new AppError(
      "CONFLICT",
      "Este centro no exige firma de usuario de planta; la orden ya puede cerrarse tras la firma del técnico.",
    );
  }

  const up = await uploadFirmaDigitalFromDataUrl({
    workOrderId: input.workOrderId,
    role: "usuario_planta",
    dataUrl,
  });

  const firmaPersist: FirmaDigital = {
    signer_user_id: input.firma.signer_user_id,
    signer_display_name: input.firma.signer_display_name,
    signer_capacity: "USUARIO_PLANTA",
    signed_at: input.firma.signed_at,
    storage_path: up.storage_path,
    download_url: up.download_url,
  };

  const ref = adminWorkOrderRef(input.workOrderId);
  await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "OT no encontrada", { details: { workOrderId: input.workOrderId } });
    }
    const wo = { id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) };
    if (wo.estado === "ANULADA") {
      throw new AppError("CONFLICT", "La OT está anulada");
    }
    if (!wo.firma_tecnico) {
      throw new AppError("CONFLICT", "Debe existir firma de técnico antes de la del usuario de planta");
    }
    if (wo.firma_usuario) {
      throw new AppError("CONFLICT", "Ya existe firma del usuario de planta registrada");
    }
    if (wo.estado !== "PENDIENTE_FIRMA_SOLICITANTE") {
      throw new AppError("CONFLICT", "La firma de planta no corresponde en este estado");
    }
    txn.update(ref, {
      firma_usuario: firmaPersist,
      estado: "LISTA_PARA_CIERRE",
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "FIRMA_USUARIO",
    actor_uid: input.actorUid,
    payload: { signed_at: "server" },
  });
}

/** Alta manual: ubica la OT en la semana ISO (`weekly_schedule` + grilla publicada cuando aplique). */
async function autoProgramarOtManualEnSemanaIso(workOrderId: string): Promise<void> {
  const wo = await getWorkOrderById(workOrderId);
  if (!wo) return;

  const fp = wo.fecha_inicio_programada;
  let fechaAgenda: Date;
  if (fp != null && typeof (fp as AdminTimestamp).toDate === "function") {
    const d = (fp as AdminTimestamp).toDate();
    fechaAgenda = Number.isNaN(d.getTime()) ? new Date() : d;
  } else {
    fechaAgenda = new Date();
  }

  const sinFechaPersistida = fp == null;

  if (sinFechaPersistida) {
    await updateWorkOrderDoc(workOrderId, {
      fecha_inicio_programada: AdminTimestamp.fromDate(startOfDay(fechaAgenda)),
    });
  }

  try {
    await scheduleWorkOrderInWeek({
      weekId: getIsoWeekId(fechaAgenda),
      workOrderId,
      dia_semana: isoDiaSemanaDesdeDateLocal(fechaAgenda),
    });
  } catch (e) {
    console.error("[OT manual] No se pudo agendar en programa semanal:", e);
  }
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
  activo_fuera_catalogo?: boolean;
  activo_manual_descripcion?: string;
}): Promise<string> {
  const cIn = input.centro.trim();
  if (!cIn) {
    throw new AppError("VALIDATION", "Centro requerido");
  }
  const fueraCatalogoCorrectivo =
    input.sub_tipo === "correctivo" && input.activo_fuera_catalogo === true;
  const manualActivoTxt = fueraCatalogoCorrectivo ? (input.activo_manual_descripcion ?? "").trim() : "";
  const assetIdTrim = fueraCatalogoCorrectivo ? "" : input.asset_id.trim();
  let asset: Asset | null = null;
  if (fueraCatalogoCorrectivo) {
    if (manualActivoTxt.length < 3) {
      throw new AppError("VALIDATION", "Describí el equipo o lugar (manual) para el correctivo fuera del listado.");
    }
    asset = null;
  } else if (disciplinaAceptaActivoOpcional(input.especialidad)) {
    if (assetIdTrim) {
      asset = await getAssetById(assetIdTrim);
    }
  } else if (assetIdTrim) {
    asset = await requireAsset(input.asset_id);
  } else {
    throw new AppError("VALIDATION", "Seleccioná un equipo / activo.");
  }
  if (asset && asset.centro.trim() !== cIn) {
    throw new AppError(
      "FORBIDDEN",
      `El activo no pertenece al centro indicado: la orden usa centro ${cIn} y el equipo en base tiene centro ${asset.centro.trim() || "—"}. Alineá el centro del formulario con el del activo o corregí el maestro.`,
    );
  }
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

  if (input.sub_tipo === "preventivo") {
    const idTrim = input.aviso_id?.trim() ?? "";
    const numTrim = input.aviso_numero?.trim() ?? "";
    if (!idTrim && !numTrim) {
      throw new AppError(
        "VALIDATION",
        "Una OT preventiva requiere aviso vinculado (ID) o número de aviso.",
      );
    }
  }

  const denomUbicTrim = input.denom_ubic_tecnica?.trim();
  const avisoManualTrim = input.aviso_numero?.trim() ?? "";

  const woId = newWorkOrderDocId();
  let n_ot = "";
  let aviso_id_final = "";

  await getAdminDb().runTransaction(async (txn) => {
    let avisoFresh: Aviso | null = null;
    if (aviso) {
      const ar = avisoRef(aviso.id);
      const asnap = await txn.get(ar);
      if (!asnap.exists) {
        throw new AppError("NOT_FOUND", "Aviso no encontrado", { details: { aviso_id: aviso.id } });
      }
      avisoFresh = { id: asnap.id, ...(asnap.data() as Omit<Aviso, "id">) };
      if (avisoFresh.work_order_id) {
        throw new AppError("CONFLICT", "El aviso ya tiene OT generada", {
          details: { work_order_id: avisoFresh.work_order_id },
        });
      }
    }

    const nNum = await allocateNextNotNumberInTransaction(txn);
    n_ot = nNum.toString().padStart(8, "0");

    if (aviso && avisoFresh) {
      txn.update(avisoRef(aviso.id), {
        estado: "OT_GENERADA",
        work_order_id: woId,
        updated_at: FieldValue.serverTimestamp(),
      } as Record<string, unknown>);
    }

    aviso_id_final = avisoFresh?.id ?? input.aviso_id ?? "";
    const ubicacion =
      input.ubicacion_tecnica?.trim() || avisoFresh?.ubicacion_tecnica || "—";
    const frecuencia = avisoFresh?.frecuencia ?? "UNICA";
    const aviso_numero = avisoFresh?.n_aviso ?? input.aviso_numero;
    const provisorioFlag =
      input.sub_tipo === "correctivo" && !avisoFresh && !avisoManualTrim;

    const base: Omit<WorkOrder, "id" | "created_at" | "updated_at"> = {
      n_ot,
      aviso_id: aviso_id_final,
      archivada: false,
      asset_id: asset?.id ?? "",
      codigo_activo_snapshot: fueraCatalogoCorrectivo ? manualActivoTxt : asset?.codigo_nuevo ?? "",
      ubicacion_tecnica: ubicacion,
      centro: cIn,
      frecuencia,
      especialidad: input.especialidad,
      tipo_trabajo,
      estado: "ABIERTA",
      texto_trabajo: input.texto_trabajo.trim(),
      firma_tecnico: null,
      firma_usuario: null,
      sub_tipo: input.sub_tipo,
      ...(fueraCatalogoCorrectivo ? { activo_fuera_catalogo: true } : {}),
      ...(asset ? { equipo_codigo: asset.codigo_nuevo } : {}),
      fecha_inicio_programada: (
        input.fecha_inicio_programada !== undefined
          ? input.fecha_inicio_programada
          : (avisoFresh?.fecha_programada ?? null)
      ) as WorkOrder["fecha_inicio_programada"],
      ...(aviso_numero !== undefined && aviso_numero !== null ? { aviso_numero } : {}),
      ...(input.frecuencia_plan_mtsa ? { frecuencia_plan_mtsa: input.frecuencia_plan_mtsa } : {}),
      ...(denomUbicTrim ? { denom_ubic_tecnica: denomUbicTrim } : {}),
      ...(input.tecnico_asignado_uid
        ? {
            tecnico_asignado_uid: input.tecnico_asignado_uid,
            tecnico_asignado_nombre: input.tecnico_asignado_nombre ?? "",
          }
        : {}),
      ...(provisorioFlag ? { provisorio_sin_aviso_sap: true } : {}),
    };

    txn.set(adminWorkOrderRef(woId), {
      ...base,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  const id = woId;

  await appendHistorialAdmin(id, {
    tipo: "CREADA",
    actor_uid: input.actorUid,
    payload: { aviso_id: aviso_id_final, n_ot },
  });

  await autoProgramarOtManualEnSemanaIso(id);

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
  const ref = adminWorkOrderRef(input.workOrderId);
  let mutated = false;
  await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "OT no encontrada", { details: { workOrderId: input.workOrderId } });
    }
    const wo = { id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) };
    if (wo.archivada === true) {
      throw new AppError("CONFLICT", "No se puede anular una OT archivada");
    }
    if (wo.estado === "CERRADA") {
      throw new AppError("CONFLICT", "No se puede anular una OT cerrada");
    }
    if (wo.estado === "ANULADA") {
      return;
    }
    mutated = true;
    txn.update(ref, { estado: "ANULADA", updated_at: FieldValue.serverTimestamp() });
  });

  if (!mutated) {
    return;
  }

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "ESTADO_CAMBIO",
    actor_uid: input.actorUid,
    payload: { hacia: "ANULADA" },
  });
}

/**
 * Marca la OT como archivada (soft-delete). Solo invocar tras validar superadmin en la acción.
 * Limpia vínculo en `avisos` y opcionalmente el `workOrderId` en la celda del programa publicado.
 */
export async function archiveWorkOrderSuperadmin(input: {
  workOrderId: string;
  actorUid: string;
  programa?: {
    programaDocId: string;
    localidad: string;
    dia: DiaSemanaPrograma;
    especialidad: EspecialidadPrograma;
    avisoNumero: string;
    avisoFirestoreId?: string | null;
  };
}): Promise<void> {
  const ref = adminWorkOrderRef(input.workOrderId);
  await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "OT no encontrada", { details: { workOrderId: input.workOrderId } });
    }
    const wo = { id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) };
    if (wo.archivada === true) {
      return;
    }
    txn.update(ref, {
      archivada: true,
      archivada_at: FieldValue.serverTimestamp(),
      archivada_por_uid: input.actorUid,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
  });

  const woAfter = await getWorkOrderById(input.workOrderId);
  if (!woAfter || woAfter.archivada !== true) {
    return;
  }

  const aid = (woAfter.aviso_id ?? "").trim();
  if (aid) {
    const av = await getAvisoById(aid);
    if (av?.work_order_id?.trim() === input.workOrderId.trim()) {
      await getAdminDb()
        .collection(COLLECTIONS.avisos)
        .doc(aid)
        .update({
          work_order_id: FieldValue.delete(),
          estado: "ABIERTO",
          updated_at: FieldValue.serverTimestamp(),
        } as Record<string, unknown>);
    }
  }

  const p = input.programa;
  if (p?.programaDocId?.trim()) {
    await clearWorkOrderIdEnProgramaSemanaAdmin({
      programaDocId: p.programaDocId.trim(),
      localidad: p.localidad,
      dia: p.dia,
      especialidad: p.especialidad,
      avisoNumero: p.avisoNumero.trim(),
      avisoFirestoreId: p.avisoFirestoreId,
      workOrderId: input.workOrderId,
    });
  }

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "ARCHIVADA",
    actor_uid: input.actorUid,
    payload: {},
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
  /** Reutiliza la misma subida (p. ej. planilla) para no duplicar objetos en Storage. */
  preUploadedTecnico?: { storage_path: string; download_url: string };
  preUploadedUsuario?: { storage_path: string; download_url: string };
}): Promise<void> {
  const wo0 = await requireWorkOrder(input.workOrderId);
  if (
    wo0.estado !== "ABIERTA" &&
    wo0.estado !== "EN_EJECUCION" &&
    wo0.estado !== "LISTA_PARA_CIERRE"
  ) {
    throw new AppError(
      "CONFLICT",
      "Solo se puede cerrar con firmas desde ABIERTA, EN_EJECUCION o LISTA_PARA_CIERRE",
    );
  }
  const centroCfg = await getCentroConfigMergedCached(wo0.centro);
  const needUserSig = Boolean(centroCfg.requiere_firma_usuario_cierre);
  const u = input.firma_usuario_pad.trim();
  const t = input.firma_tecnico_pad.trim();
  if (t.length < 100) {
    throw new AppError("VALIDATION", "La firma del técnico es obligatoria");
  }
  if (needUserSig && u.length < 100) {
    throw new AppError("VALIDATION", "La firma por Arauco es obligatoria");
  }

  const tUp =
    input.preUploadedTecnico ??
    (await uploadFirmaDigitalFromDataUrl({
      workOrderId: input.workOrderId,
      role: "pad_tecnico",
      dataUrl: t,
    }));
  const uUp =
    needUserSig && u.length >= 100
      ? (input.preUploadedUsuario ??
        (await uploadFirmaDigitalFromDataUrl({
          workOrderId: input.workOrderId,
          role: "pad_usuario",
          dataUrl: u,
        })))
      : null;

  const patch: Record<string, unknown> = {
    estado: "CERRADA",
    fecha_fin_ejecucion: FieldValue.serverTimestamp(),
    firma_tecnico_pad: "",
    firma_tecnico_pad_nombre: input.firma_tecnico_nombre.trim(),
    firma_tecnico_pad_storage_path: tUp.storage_path,
    firma_tecnico_pad_download_url: tUp.download_url,
    firmado_at: FieldValue.serverTimestamp(),
    cerrada_por_uid: input.actorUid,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (needUserSig && uUp) {
    patch.firma_usuario_pad = "";
    patch.firma_usuario_pad_nombre = input.firma_usuario_nombre.trim();
    patch.firma_usuario_pad_storage_path = uUp.storage_path;
    patch.firma_usuario_pad_download_url = uUp.download_url;
  } else {
    patch.firma_usuario_pad = "";
    patch.firma_usuario_pad_nombre = "";
    patch.firma_usuario_pad_storage_path = FieldValue.delete();
    patch.firma_usuario_pad_download_url = FieldValue.delete();
  }

  const ref = adminWorkOrderRef(input.workOrderId);
  await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "OT no encontrada", { details: { workOrderId: input.workOrderId } });
    }
    const wo = { id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) };
    if (wo.estado === "ANULADA") {
      throw new AppError("CONFLICT", "La OT está anulada");
    }
    if (wo.estado === "CERRADA") {
      throw new AppError("CONFLICT", "La OT ya está cerrada");
    }
    if (
      wo.estado !== "ABIERTA" &&
      wo.estado !== "EN_EJECUCION" &&
      wo.estado !== "LISTA_PARA_CIERRE"
    ) {
      throw new AppError(
        "CONFLICT",
        "Solo se puede cerrar con firmas desde ABIERTA, EN_EJECUCION o LISTA_PARA_CIERRE",
      );
    }
    txn.update(ref, patch);
  });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "CIERRE",
    actor_uid: input.actorUid,
    payload: { modo: needUserSig ? "pad_dual" : "pad_tecnico" },
  });

  await limpiarAntecesorAlCerrarOrden(input.workOrderId);
}

export type WorkOrderPadCloseFollowUpOptions = {
  /** Fecha real del trabajo: aviso/plan usan esta base en lugar de “ahora” (cierre histórico). */
  fechaEjecucionReferencia?: Date;
  notificacion?: "firmada" | "empalme_documentado";
};

/** Efectos posteriores al cierre con pads (aviso, plan de mantenimiento, notificaciones). Idempotente si el aviso ya está cerrado. */
export async function runWorkOrderPadCloseFollowUp(
  workOrderId: string,
  opts?: WorkOrderPadCloseFollowUpOptions,
): Promise<void> {
  const wo = await getWorkOrderById(workOrderId);
  if (!wo || wo.estado !== "CERRADA") return;

  const fechaEjecucion = opts?.fechaEjecucionReferencia;
  const avisoKey = wo.aviso_id?.trim() || (wo.aviso_numero ? avisoFirestoreDocId(wo.aviso_numero) : "");
  const aviso = avisoKey ? await getAvisoById(avisoKey) : null;
  if (avisoKey && aviso) {
    const mtsa = inferMtsaDesdeAviso(aviso);
    const fechaBaseParaProximo = fechaEjecucion ?? new Date();
    const proximo = proximoVencimientoDesdeFecha(fechaBaseParaProximo, mtsa);
    const hoy = new Date();
    const dias = diasParaVencimientoDesdeProximo(proximo, hoy);
    await updateAviso(aviso.id, {
      estado: "CERRADO" as Aviso["estado"],
      ultima_ejecucion_ot_id: wo.id,
      ultima_ejecucion_fecha: (
        fechaEjecucion != null
          ? AdminTimestamp.fromDate(fechaEjecucion)
          : AdminTimestamp.now()
      ) as unknown as Aviso["ultima_ejecucion_fecha"],
      proximo_vencimiento: AdminTimestamp.fromDate(proximo) as unknown as Aviso["proximo_vencimiento"],
      dias_para_vencimiento: dias,
      estado_vencimiento: estadoVencimientoDesdeDias(dias),
    });
  }
  const planKey = (wo.plan_id?.trim() || avisoKey).trim();
  if (planKey) {
    const plan = await getPlanMantenimientoAdmin(planKey);
    if (plan) {
      const ciclo =
        typeof plan.dias_ciclo === "number" && plan.dias_ciclo > 0
          ? plan.dias_ciclo
          : aviso
            ? diasPorMtsa(inferMtsaDesdeAviso(aviso))
            : 30;
      await updatePlanMantenimientoAfterClose({
        planId: plan.id,
        otId: wo.id,
        diasCiclo: ciclo,
        ...(fechaEjecucion ? { fechaUltimaEjecucion: fechaEjecucion } : {}),
      });
    }
  }
  const dest = [
    ...(await destinatariosClienteArauco(wo.centro)),
    ...(await destinatariosSupervisoresAdmin(wo.centro)),
  ];
  const esEmpalme = opts?.notificacion === "empalme_documentado";
  crearNotificacionSeguro(dest, {
    tipo: "ot_cerrada_firmada",
    titulo: esEmpalme
      ? `OT n.º ${wo.n_ot} registrada (empalme documentado)`
      : `OT n.º ${wo.n_ot} cerrada y firmada`,
    cuerpo: wo.texto_trabajo.trim().slice(0, 280),
    otId: wo.id,
  });
}

function inicioDiaLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Cierre histórico (empalme): trabajo ya ejecutado fuera del CMMS; solo superadmin. */
export async function closeWorkOrderHistorico(input: {
  workOrderId: string;
  fechaEjecucion: Date;
  motivo: string;
  evidenciaUrl?: string;
  tecnicoNombre?: string;
  actorUid: string;
  actorDisplayName: string;
}): Promise<void> {
  const motivo = input.motivo.trim();
  if (motivo.length < 10) {
    throw new AppError("VALIDATION", "El motivo debe tener al menos 10 caracteres");
  }
  const hoy = inicioDiaLocal(new Date());
  const fe = inicioDiaLocal(input.fechaEjecucion);
  if (fe.getTime() > hoy.getTime()) {
    throw new AppError("VALIDATION", "La fecha de ejecución no puede ser futura");
  }

  const ref = adminWorkOrderRef(input.workOrderId);
  await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "OT no encontrada", { details: { workOrderId: input.workOrderId } });
    }
    const wo = { id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) };
    if (wo.estado === "ANULADA") {
      throw new AppError("CONFLICT", "La OT está anulada");
    }
    if (wo.estado === "CERRADA") {
      throw new AppError("CONFLICT", "La OT ya está cerrada");
    }
    const permitidos: WorkOrder["estado"][] = ["BORRADOR", "ABIERTA", "EN_EJECUCION"];
    if (!permitidos.includes(wo.estado)) {
      throw new AppError(
        "CONFLICT",
        "El cierre histórico solo aplica a órdenes en borrador, abiertas o en ejecución",
      );
    }

    const patch: Record<string, unknown> = {
      estado: "CERRADA",
      fecha_fin_ejecucion: AdminTimestamp.fromDate(input.fechaEjecucion),
      cierre_modo: "empalme_documentado",
      cierre_motivo: motivo,
      cerrada_por_uid: input.actorUid,
      cerrada_por_nombre: input.actorDisplayName.trim(),
      updated_at: FieldValue.serverTimestamp(),
    };
    const ev = input.evidenciaUrl?.trim();
    if (ev) patch.cierre_evidencia_url = ev;
    const tn = input.tecnicoNombre?.trim();
    if (tn) patch.cierre_tecnico_nombre = tn;
    txn.update(ref, patch);
  });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "CIERRE_HISTORICO",
    actor_uid: input.actorUid,
    payload: {
      motivo,
      fechaEjecucion: input.fechaEjecucion.toISOString(),
      evidenciaUrl: input.evidenciaUrl?.trim() || undefined,
      tecnicoNombre: input.tecnicoNombre?.trim() || undefined,
      actorDisplayName: input.actorDisplayName.trim(),
    },
  });

  await limpiarAntecesorAlCerrarOrden(input.workOrderId);
  await runWorkOrderPadCloseFollowUp(input.workOrderId, {
    fechaEjecucionReferencia: input.fechaEjecucion,
    notificacion: "empalme_documentado",
  });
}

export async function closeWorkOrder(input: {
  workOrderId: string;
  actorUid: string;
  motivo?: string;
}): Promise<void> {
  const wo0 = await requireWorkOrder(input.workOrderId);
  const centroCfg = await getCentroConfigMergedCached(wo0.centro);
  const needUserSig = Boolean(centroCfg.requiere_firma_usuario_cierre);

  const ref = adminWorkOrderRef(input.workOrderId);
  await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "OT no encontrada", { details: { workOrderId: input.workOrderId } });
    }
    const wo = { id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) };
    if (wo.estado === "ANULADA") {
      throw new AppError("CONFLICT", "La OT está anulada");
    }
    if (wo.estado !== "LISTA_PARA_CIERRE") {
      throw new AppError("CONFLICT", "La OT debe estar en LISTA_PARA_CIERRE para cerrarse");
    }
    if (!wo.firma_tecnico) {
      throw new AppError("CONFLICT", "Cierre bloqueado: falta la firma del técnico");
    }
    if (needUserSig && !wo.firma_usuario) {
      throw new AppError("CONFLICT", "Cierre bloqueado: falta la firma del usuario de planta");
    }
    txn.update(ref, {
      estado: "CERRADA",
      fecha_fin_ejecucion: FieldValue.serverTimestamp(),
      cerrada_por_uid: input.actorUid,
      motivo_cierre: input.motivo,
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "CIERRE" as const,
    actor_uid: input.actorUid,
    payload: { motivo: input.motivo },
  });

  await limpiarAntecesorAlCerrarOrden(input.workOrderId);
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
    throw new AppError("NOT_FOUND", "OT no encontrada", { details: { workOrderId } });
  }
  if (wo.archivada === true) {
    throw new AppError("NOT_FOUND", "OT no encontrada", { details: { workOrderId } });
  }
  if (wo.estado === "ANULADA") {
    throw new AppError("CONFLICT", "La OT está anulada");
  }
  return wo;
}
