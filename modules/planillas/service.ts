import { AppError } from "@/lib/errors/app-error";
import type { ItemRespuesta, PlanillaRespuesta } from "@/lib/firestore/types";
import { getAssetById } from "@/modules/assets/repository";
import { uploadFirmaDigitalFromDataUrl } from "@/modules/work-orders/firma-storage-admin";
import { planillaItemsOkSinFirmas, validatePlanillaFirmable } from "@/lib/planillas/form-utils";
import { selectTemplate } from "@/lib/planillas/select-template";
import { closeWorkOrderWithPadSignatures, runWorkOrderPadCloseFollowUp } from "@/modules/work-orders/service";
import {
  appendHistorialAdmin,
  createPlanillaRespuestaAdmin,
  findPlanillaAbiertaAdmin,
  getPlanillaRespuestaAdmin,
  getPlanillaTemplateAdmin,
  getWorkOrderById,
  updatePlanillaRespuestaMergeAdmin,
} from "@/modules/work-orders/repository";
import { workOrderFrecuenciaBadge, workOrderSubtipo } from "@/modules/work-orders/types";
import { FieldValue } from "firebase-admin/firestore";

function mergeRecordShallow(
  prev: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!incoming) return { ...(prev ?? {}) };
  return { ...(prev ?? {}), ...incoming };
}

function mergeRespuestasItems(
  prev: PlanillaRespuesta["respuestas"],
  incoming: PlanillaRespuesta["respuestas"] | undefined,
): PlanillaRespuesta["respuestas"] {
  if (!incoming) return { ...prev };
  const out = { ...prev };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined) continue;
    const prevItem = out[k] as ItemRespuesta | undefined;
    out[k] = { ...(prevItem ?? {}), ...(v as ItemRespuesta) } as ItemRespuesta;
  }
  return out;
}

function mergePlanillaPayload(
  existing: PlanillaRespuesta,
  patch: Partial<PlanillaRespuesta>,
): Record<string, unknown> {
  const p = patch as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...p };
  if (p.respuestas && typeof p.respuestas === "object") {
    out.respuestas = mergeRespuestasItems(
      existing.respuestas,
      p.respuestas as PlanillaRespuesta["respuestas"],
    );
  }
  if (p.datosEquipo && typeof p.datosEquipo === "object") {
    out.datosEquipo = mergeRecordShallow(
      (existing.datosEquipo ?? {}) as unknown as Record<string, unknown>,
      p.datosEquipo as Record<string, unknown>,
    );
  }
  if (p.textoLibrePorSeccion && typeof p.textoLibrePorSeccion === "object") {
    out.textoLibrePorSeccion = mergeRecordShallow(
      (existing.textoLibrePorSeccion ?? {}) as unknown as Record<string, unknown>,
      p.textoLibrePorSeccion as Record<string, unknown>,
    );
  }
  if (Array.isArray(p.filasPersonal)) {
    const prev = (Array.isArray(existing.filasPersonal) ? existing.filasPersonal : []) as NonNullable<
      PlanillaRespuesta["filasPersonal"]
    >;
    const inc = p.filasPersonal as PlanillaRespuesta["filasPersonal"];
    const max = Math.max(prev.length, inc?.length ?? 0);
    const rows: PlanillaRespuesta["filasPersonal"] = [];
    for (let i = 0; i < max; i++) {
      rows.push({
        ...(prev[i] ?? {}),
        ...(inc?.[i] ?? {}),
      });
    }
    out.filasPersonal = rows;
  }
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

export async function iniciarPlanillaService(input: {
  workOrderId: string;
  actorUid: string;
}): Promise<{ respuestaId: string; existing: boolean; templateId: string }> {
  const wo = await getWorkOrderById(input.workOrderId);
  if (!wo) throw new AppError("NOT_FOUND", "OT no encontrada");

  const abierta = await findPlanillaAbiertaAdmin(input.workOrderId);
  if (abierta) {
    return { respuestaId: abierta.id, existing: true, templateId: abierta.templateId };
  }

  const asset = await getAssetById(wo.asset_id);
  const templateId = selectTemplate(wo, { especialidadActivo: asset?.especialidad_predeterminada });
  const template = await getPlanillaTemplateAdmin(templateId);
  if (!template) throw new AppError("NOT_FOUND", `Template de planilla no disponible: ${templateId}`);

  const sub = workOrderSubtipo(wo);
  const frec = workOrderFrecuenciaBadge(wo);
  const centroCodigo = wo.equipo_codigo?.trim() || wo.codigo_activo_snapshot?.trim() || "";
  const datosEquipo =
    centroCodigo.trim().length > 0 ? { codigoEquipo: centroCodigo.trim() } : undefined;

  const doc: Omit<PlanillaRespuesta, "id"> = {
    templateId,
    otId: input.workOrderId,
    ...(centroCodigo.trim().length > 0 ? { equipoCodigo: centroCodigo.trim() } : {}),
    ...(datosEquipo ? { datosEquipo } : {}),
    ...(frec ? { frecuencia: frec } : {}),
    intervencion: sub === "correctivo" ? "correctiva" : "preventiva",
    respuestas: {},
    status: "borrador",
    completadoPor: input.actorUid,
    creadoAt: FieldValue.serverTimestamp() as unknown as PlanillaRespuesta["creadoAt"],
  };

  const respuestaId = await createPlanillaRespuestaAdmin(input.workOrderId, doc);
  await appendHistorialAdmin(input.workOrderId, {
    tipo: "PLANILLA_INICIADA",
    payload: { templateId, respuestaId },
    actor_uid: input.actorUid,
  });

  return { respuestaId, existing: false, templateId };
}

export async function guardarBorradorPlanillaService(input: {
  workOrderId: string;
  respuestaId: string;
  actorUid: string;
  patch: Partial<PlanillaRespuesta>;
}): Promise<void> {
  const existing = await getPlanillaRespuestaAdmin(input.workOrderId, input.respuestaId);
  if (!existing) throw new AppError("NOT_FOUND", "Planilla no encontrada");
  if (existing.status === "firmada") throw new AppError("CONFLICT", "La planilla ya está firmada");

  const template = await getPlanillaTemplateAdmin(existing.templateId);
  if (!template) throw new AppError("NOT_FOUND", "Template no encontrado");

  const mergedData = mergePlanillaPayload(existing, input.patch);
  const merged: PlanillaRespuesta = {
    ...existing,
    ...(mergedData as unknown as PlanillaRespuesta),
  };

  const statusNext = planillaItemsOkSinFirmas(template, merged) ? "completada" : "borrador";

  await updatePlanillaRespuestaMergeAdmin(input.workOrderId, input.respuestaId, {
    ...mergedData,
    status: statusNext,
    completadoPor: input.actorUid,
  });
}

export async function firmarPlanillaService(input: {
  workOrderId: string;
  respuestaId: string;
  actorUid: string;
  isAdmin?: boolean;
  firmas: {
    firmaUsuario: string;
    firmaUsuarioNombre: string;
    firmaUsuarioLegajo: string;
    firmaResponsable: string;
    firmaResponsableNombre: string;
  };
}): Promise<void> {
  const existing = await getPlanillaRespuestaAdmin(input.workOrderId, input.respuestaId);
  if (!existing) throw new AppError("NOT_FOUND", "Planilla no encontrada");
  if (existing.status === "firmada") return;

  const template = await getPlanillaTemplateAdmin(existing.templateId);
  if (!template) throw new AppError("NOT_FOUND", "Template no encontrado");

  const toValidate: PlanillaRespuesta = {
    ...existing,
    ...input.firmas,
  };

  const v = validatePlanillaFirmable(template, toValidate, { isAdmin: input.isAdmin });
  if (!v.ok) throw new AppError("VALIDATION", v.mensaje);

  const pathPrefix = `planilla_${input.respuestaId}`;
  const araucoUp = await uploadFirmaDigitalFromDataUrl({
    workOrderId: input.workOrderId,
    role: "planilla_arauco",
    dataUrl: input.firmas.firmaUsuario,
    pathPrefix,
  });
  const tecnicoUp = await uploadFirmaDigitalFromDataUrl({
    workOrderId: input.workOrderId,
    role: "planilla_tecnico",
    dataUrl: input.firmas.firmaResponsable,
    pathPrefix,
  });

  await updatePlanillaRespuestaMergeAdmin(input.workOrderId, input.respuestaId, {
    firmaUsuario: "",
    firmaUsuarioNombre: input.firmas.firmaUsuarioNombre,
    firmaUsuarioLegajo: input.firmas.firmaUsuarioLegajo,
    firmaUsuarioStoragePath: araucoUp.storage_path,
    firmaUsuarioDownloadUrl: araucoUp.download_url,
    firmaResponsable: "",
    firmaResponsableNombre: input.firmas.firmaResponsableNombre,
    firmaResponsableStoragePath: tecnicoUp.storage_path,
    firmaResponsableDownloadUrl: tecnicoUp.download_url,
    status: "firmada",
    completadoAt: FieldValue.serverTimestamp(),
    firmaUsuarioFecha: FieldValue.serverTimestamp(),
  });

  await appendHistorialAdmin(input.workOrderId, {
    tipo: "PLANILLA_FIRMADA",
    payload: { respuestaId: input.respuestaId, templateId: existing.templateId },
    actor_uid: input.actorUid,
  });

  const wo = await getWorkOrderById(input.workOrderId);
  if (wo && wo.estado !== "CERRADA" && wo.estado !== "ANULADA") {
    await closeWorkOrderWithPadSignatures({
      workOrderId: input.workOrderId,
      actorUid: input.actorUid,
      firma_usuario_pad: input.firmas.firmaUsuario,
      firma_tecnico_pad: input.firmas.firmaResponsable,
      firma_usuario_nombre: input.firmas.firmaUsuarioNombre,
      firma_tecnico_nombre: input.firmas.firmaResponsableNombre,
      preUploadedUsuario: {
        storage_path: araucoUp.storage_path,
        download_url: araucoUp.download_url,
      },
      preUploadedTecnico: {
        storage_path: tecnicoUp.storage_path,
        download_url: tecnicoUp.download_url,
      },
    });
    await runWorkOrderPadCloseFollowUp(input.workOrderId);
  }
}
