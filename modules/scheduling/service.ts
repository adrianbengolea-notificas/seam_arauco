import { getAdminDb } from "@/firebase/firebaseAdmin";
import { AppError } from "@/lib/errors/app-error";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import {
  appendAvisoToProgramaSemanaAdmin,
  createWeeklyPlanRowAdmin,
  createWeeklySlotAdmin,
  deleteWeeklyPlanRowAdmin,
  deleteWeeklySlotAdmin,
  ensureProgramaSemanalDocParaSemanaIsoAdmin,
  ensureWeeklyBucketAdmin,
  getProgramaSemana,
  getWeeklyPlanRowAdmin,
  getWeeklySlotAdmin,
  moveAvisoEnProgramaPublicadoTxn,
  removeAvisoFromProgramaSemanaAdmin,
  updateWeeklySlotAdmin,
  replaceWeeklyPlanRowsAdmin,
  updateWeeklyPlanRowAdmin,
} from "@/modules/scheduling/repository";
import type { AvisoSlot, DiaSemanaPrograma, EspecialidadPrograma, WeeklyPlanRow } from "@/modules/scheduling/types";
import { toPermisoRol } from "@/lib/permisos/index";
import { usuarioTieneCentro } from "@/modules/users/centros-usuario";
import { diaIsoSemanaADiaPrograma, parseIsoWeekIdFromSemanaParam } from "@/modules/scheduling/iso-week";
import type { UserProfileWithUid } from "@/modules/users/repository";
import { getAvisoById, updateAviso } from "@/modules/notices/repository";
import type { Especialidad, TipoAviso } from "@/modules/notices/types";
import type { WorkOrder } from "@/modules/work-orders/types";
import { getWorkOrderById } from "@/modules/work-orders/repository";

async function nextOrdenEnDia(weekId: string, dia: number): Promise<number> {
  const snap = await getAdminDb()
    .collection(COLLECTIONS.weekly_schedule)
    .doc(weekId)
    .collection("slots")
    .get();
  let max = -1;
  for (const d of snap.docs) {
    const row = d.data() as { dia_semana?: number; orden_en_dia?: number };
    if (row.dia_semana === dia && typeof row.orden_en_dia === "number") {
      max = Math.max(max, row.orden_en_dia);
    }
  }
  return max + 1;
}

export async function scheduleWorkOrderInWeek(input: {
  weekId: string;
  workOrderId: string;
  dia_semana: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  turno?: "A" | "B" | "C";
}): Promise<string> {
  const wo = await getWorkOrderById(input.workOrderId);
  if (!wo) {
    throw new AppError("NOT_FOUND", "OT no encontrada");
  }
  if (wo.archivada === true) {
    throw new AppError("CONFLICT", "No se programa una OT archivada");
  }
  const centroOt = String(wo.centro ?? "").trim();
  if (!centroOt) {
    throw new AppError("VALIDATION", "La OT no tiene centro definido");
  }
  if (wo.estado === "ANULADA" || wo.estado === "CERRADA") {
    throw new AppError("CONFLICT", "No se programa una OT cerrada o anulada");
  }

  await ensureWeeklyBucketAdmin(input.weekId, centroOt, input.weekId);
  await ensureProgramaSemanalDocParaSemanaIsoAdmin({
    semanaIso: input.weekId.trim(),
    centro: centroOt,
  });
  const orden = await nextOrdenEnDia(input.weekId, input.dia_semana);

  const slotId = await createWeeklySlotAdmin(input.weekId, {
    centro: centroOt,
    work_order_id: wo.id,
    n_ot_snapshot: wo.n_ot,
    asset_id: wo.asset_id,
    ubicacion_tecnica: wo.ubicacion_tecnica,
    especialidad: wo.especialidad,
    dia_semana: input.dia_semana,
    ...(input.turno ? { turno: input.turno } : {}),
    orden_en_dia: orden,
  });

  try {
    await syncOtManualAlProgramaPublicado({
      weekId: input.weekId,
      centro: centroOt,
      wo,
      diaPrograma: diaIsoSemanaADiaPrograma(input.dia_semana),
      turno: input.turno,
    });
  } catch (e) {
    await deleteWeeklySlotAdmin(input.weekId, slotId);
    throw e;
  }

  return slotId;
}

/** Clave estable del ítem en `programa_semanal` (debe coincidir al quitar). */
function numeroOtEnProgramaPublicado(nOt: string | undefined, workOrderId: string): string {
  const n = (nOt ?? "").trim();
  if (n) return `OT-${n}`;
  return `OT-ID-${workOrderId.slice(0, 12)}`;
}

function tipoTrabajoWoAAvisoTipo(tipo: TipoAviso): "preventivo" | "correctivo" {
  return tipo === "CORRECTIVO" || tipo === "EMERGENCIA" ? "correctivo" : "preventivo";
}

function descripcionOtAgendaManual(wo: WorkOrder, turno?: string): string {
  const txt = wo.texto_trabajo?.trim();
  const parts = [
    wo.codigo_activo_snapshot?.trim(),
    `OT ${wo.n_ot}`,
    txt && txt.length > 0 ? (txt.length > 140 ? `${txt.slice(0, 137)}…` : txt) : null,
    turno ? `Turno ${turno}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || `OT ${wo.n_ot}`;
}

async function syncOtManualAlProgramaPublicado(input: {
  weekId: string;
  centro: string;
  wo: WorkOrder;
  diaPrograma: DiaSemanaPrograma;
  turno?: "A" | "B" | "C";
}): Promise<void> {
  const espProg = especialidadAAvisoToPrograma(input.wo.especialidad);
  const loc = (input.wo.ubicacion_tecnica ?? "").trim() || "—";
  const nuevoAviso: AvisoSlot = {
    numero: numeroOtEnProgramaPublicado(input.wo.n_ot, input.wo.id),
    descripcion: descripcionOtAgendaManual(input.wo, input.turno),
    tipo: tipoTrabajoWoAAvisoTipo(input.wo.tipo_trabajo),
    urgente: input.wo.tipo_trabajo === "EMERGENCIA",
    equipoCodigo: input.wo.codigo_activo_snapshot,
    ubicacion: input.wo.ubicacion_tecnica,
    workOrderId: input.wo.id,
  };
  await appendAvisoToProgramaSemanaAdmin({
    semanaId: input.weekId,
    centro: input.centro,
    dia: input.diaPrograma,
    especialidad: espProg,
    localidad: loc,
    nuevoAviso,
  });
}

export async function removeWeekSlot(input: { weekId: string; slotId: string }): Promise<void> {
  const slot = await getWeeklySlotAdmin(input.weekId, input.slotId);
  if (!slot) {
    await deleteWeeklySlotAdmin(input.weekId, input.slotId);
    return;
  }
  const diaProg = diaIsoSemanaADiaPrograma(slot.dia_semana);
  const espProg = especialidadAAvisoToPrograma(slot.especialidad);
  const loc = (slot.ubicacion_tecnica ?? "").trim() || "—";
  const numero = numeroOtEnProgramaPublicado(slot.n_ot_snapshot, slot.work_order_id);
  const programaDocId = propuestaSemanaDocId(slot.centro, input.weekId);

  await removeAvisoFromProgramaSemanaAdmin({
    programaDocId,
    localidad: loc,
    dia: diaProg,
    especialidad: espProg,
    avisoNumero: numero,
  });
  await deleteWeeklySlotAdmin(input.weekId, input.slotId);
}

/**
 * Cambia el día ISO de una OT agendada y sincroniza la celda en `programa_semanal`
 * (misma semana y documento que al agendar manualmente).
 */
export async function moveWeekSlotBetweenDays(input: {
  weekId: string;
  slotId: string;
  dia_semana: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  viewer: UserProfileWithUid;
}): Promise<void> {
  const slot = await getWeeklySlotAdmin(input.weekId, input.slotId);
  if (!slot) {
    throw new AppError("NOT_FOUND", "Entrada no encontrada");
  }
  const rol = toPermisoRol(input.viewer.rol);
  const cOt = String(slot.centro ?? "").trim();
  if (!cOt) {
    throw new AppError("VALIDATION", "La entrada no tiene centro definido");
  }
  if (rol !== "superadmin" && !usuarioTieneCentro(input.viewer, cOt)) {
    throw new AppError("FORBIDDEN", "No podés mover esta entrada");
  }
  if (slot.dia_semana === input.dia_semana) {
    return;
  }

  const oldDia = slot.dia_semana;
  const oldOrden = slot.orden_en_dia;
  const newOrden = await nextOrdenEnDia(input.weekId, input.dia_semana);
  const programaDocId = propuestaSemanaDocId(cOt, input.weekId);
  const loc = (slot.ubicacion_tecnica ?? "").trim() || "—";
  const espProg = especialidadAAvisoToPrograma(slot.especialidad);
  const avisoNumero = numeroOtEnProgramaPublicado(slot.n_ot_snapshot, slot.work_order_id);
  const fromDia = diaIsoSemanaADiaPrograma(oldDia);
  const destDia = diaIsoSemanaADiaPrograma(input.dia_semana);

  await updateWeeklySlotAdmin(input.weekId, input.slotId, {
    dia_semana: input.dia_semana,
    orden_en_dia: newOrden,
  });
  try {
    await moveAvisoEnProgramaPublicadoTxn({
      sourceProgramaDocId: programaDocId,
      destProgramaDocId: programaDocId,
      destSemanaIso: input.weekId.trim(),
      centro: cOt,
      avisoNumero,
      avisoFirestoreId: undefined,
      from: { localidad: loc, dia: fromDia, especialidad: espProg },
      destDia,
    });
  } catch (e) {
    await updateWeeklySlotAdmin(input.weekId, input.slotId, {
      dia_semana: oldDia,
      orden_en_dia: oldOrden,
    });
    throw e;
  }
}

export async function replaceWeeklyPlanRows(input: {
  weekId: string;
  centroEsperado: string;
  rows: Array<Pick<WeeklyPlanRow, "dia_semana" | "localidad" | "especialidad" | "texto" | "orden">>;
}): Promise<void> {
  const body: Array<Omit<WeeklyPlanRow, "id" | "created_at" | "updated_at">> = input.rows.map((r) => ({
    ...r,
    centro: input.centroEsperado,
  }));
  await replaceWeeklyPlanRowsAdmin(input.weekId, input.centroEsperado, body);
}

export async function addWeeklyPlanRow(input: {
  weekId: string;
  centroEsperado: string;
  dia_semana: WeeklyPlanRow["dia_semana"];
  localidad: string;
  especialidad: string;
  texto: string;
}): Promise<string> {
  return createWeeklyPlanRowAdmin(input.weekId, {
    centro: input.centroEsperado,
    dia_semana: input.dia_semana,
    localidad: input.localidad.trim(),
    especialidad: input.especialidad.trim(),
    texto: input.texto.trim(),
  });
}

export async function patchWeeklyPlanRow(input: {
  weekId: string;
  rowId: string;
  centroEsperado: string;
  patch: Partial<Pick<WeeklyPlanRow, "localidad" | "especialidad" | "texto" | "dia_semana">>;
}): Promise<void> {
  const row = await getWeeklyPlanRowAdmin(input.weekId, input.rowId);
  if (!row) {
    throw new AppError("NOT_FOUND", "Fila de plan no encontrada");
  }
  if (row.centro !== input.centroEsperado) {
    throw new AppError("FORBIDDEN", "La fila pertenece a otro centro");
  }
  await updateWeeklyPlanRowAdmin(input.weekId, input.rowId, input.patch);
}

export async function removeWeeklyPlanRow(input: {
  weekId: string;
  rowId: string;
  centroEsperado: string;
}): Promise<void> {
  const row = await getWeeklyPlanRowAdmin(input.weekId, input.rowId);
  if (!row) {
    throw new AppError("NOT_FOUND", "Fila de plan no encontrada");
  }
  if (row.centro !== input.centroEsperado) {
    throw new AppError("FORBIDDEN", "La fila pertenece a otro centro");
  }
  await deleteWeeklyPlanRowAdmin(input.weekId, input.rowId);
}

function especialidadAAvisoToPrograma(esp: Especialidad): EspecialidadPrograma {
  if (esp === "ELECTRICO" || esp === "HG") return "Electrico";
  if (esp === "AA") return "Aire";
  return "GG";
}

/** Publica un aviso en `programa_semanal` y marca `incluido_en_semana`. */
export async function addAvisoToPublishedPrograma(input: {
  semanaId: string;
  avisoFirestoreId: string;
  dia: DiaSemanaPrograma;
  localidad?: string;
  session: UserProfileWithUid;
}): Promise<void> {
  const aviso = await getAvisoById(input.avisoFirestoreId);
  if (!aviso) {
    throw new AppError("NOT_FOUND", "Aviso no encontrado");
  }
  const rol = toPermisoRol(input.session.rol);
  if (rol !== "superadmin" && !usuarioTieneCentro(input.session, aviso.centro)) {
    throw new AppError("FORBIDDEN", "El aviso pertenece a otro centro");
  }
  if (aviso.incluido_en_semana === input.semanaId) {
    throw new AppError("CONFLICT", "Este aviso ya figura incluido en esta semana");
  }
  const espProg = especialidadAAvisoToPrograma(aviso.especialidad);
  const loc =
    (input.localidad?.trim() || aviso.ubicacion_tecnica || aviso.centro || "").trim() || "—";
  const nuevoAviso: AvisoSlot = {
    numero: aviso.n_aviso,
    descripcion: aviso.texto_corto || aviso.n_aviso,
    tipo:
      aviso.tipo === "CORRECTIVO" || aviso.tipo === "EMERGENCIA" ? "correctivo" : "preventivo",
    urgente: aviso.urgente === true,
    ubicacion: aviso.ubicacion_tecnica,
    avisoFirestoreId: aviso.id,
    ...(aviso.antecesor_orden_abierta?.work_order_id?.trim()
      ? { ordenPreviaPendiente: true }
      : {}),
  };
  await appendAvisoToProgramaSemanaAdmin({
    semanaId: input.semanaId,
    centro: aviso.centro,
    dia: input.dia,
    especialidad: espProg,
    localidad: loc,
    nuevoAviso,
  });
  await updateAviso(aviso.id, {
    incluido_en_semana: input.semanaId,
  });
}

/** Muestra un aviso en otra celda del programa publicado (otro día y/u otra semana). */
export async function moveAvisoInPublishedPrograma(input: {
  session: UserProfileWithUid;
  sourceProgramaDocId: string;
  destProgramaDocId: string;
  avisoNumero: string;
  avisoFirestoreId?: string | null;
  from: {
    localidad: string;
    dia: DiaSemanaPrograma;
    especialidad: EspecialidadPrograma;
  };
  destDia: DiaSemanaPrograma;
}): Promise<void> {
  const programa = await getProgramaSemana(input.sourceProgramaDocId);
  if (!programa) {
    throw new AppError("NOT_FOUND", "Programa no encontrado");
  }
  const rol = toPermisoRol(input.session.rol);
  if (rol !== "superadmin" && !usuarioTieneCentro(input.session, programa.centro)) {
    throw new AppError("FORBIDDEN", "No podés cambiar este programa semanal.");
  }

  const destIso = parseIsoWeekIdFromSemanaParam(input.destProgramaDocId);
  const sourceIso = parseIsoWeekIdFromSemanaParam(input.sourceProgramaDocId);
  if (!destIso || !sourceIso) {
    throw new AppError("VALIDATION", "Semana ISO no válida en el documento de programa.");
  }

  const destProg = await getProgramaSemana(input.destProgramaDocId);
  if (
    destProg?.centro &&
    destProg.centro.trim() !== programa.centro.trim()
  ) {
    throw new AppError("FORBIDDEN", "La semana destino es de otro centro.");
  }

  if (
    input.sourceProgramaDocId === input.destProgramaDocId &&
    destIso === sourceIso &&
    input.destDia === input.from.dia
  ) {
    throw new AppError("VALIDATION", "Elegí otro día u otra semana para mover el aviso.");
  }

  await moveAvisoEnProgramaPublicadoTxn({
    sourceProgramaDocId: input.sourceProgramaDocId,
    destProgramaDocId: input.destProgramaDocId,
    destSemanaIso: destIso,
    centro: programa.centro.trim(),
    avisoNumero: input.avisoNumero.trim(),
    avisoFirestoreId: input.avisoFirestoreId,
    from: input.from,
    destDia: input.destDia,
  });
}
