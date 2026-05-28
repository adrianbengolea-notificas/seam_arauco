import { getAdminDb } from "@/firebase/firebaseAdmin";
import { AppError } from "@/lib/errors/app-error";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { FieldValue } from "firebase-admin/firestore";
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
  setWorkOrderIdEnProgramaSemanaAdmin,
  updateWeeklySlotAdmin,
  replaceWeeklyPlanRowsAdmin,
  updateWeeklyPlanRowAdmin,
} from "@/modules/scheduling/repository";
import type {
  AvisoSlot,
  DiaSemanaPrograma,
  EspecialidadPrograma,
  SlotSemanal,
  WeeklyPlanRow,
} from "@/modules/scheduling/types";
import { toPermisoRol } from "@/lib/permisos/index";
import { usuarioTieneCentro } from "@/modules/users/centros-usuario";
import {
  diaIsoSemanaADiaPrograma,
  diaProgramaADiaIsoSemana,
  getIsoWeekId,
  parseIsoWeekIdFromSemanaParam,
} from "@/modules/scheduling/iso-week";
import type { UserProfileWithUid } from "@/modules/users/repository";
import { getAvisoById, updateAviso } from "@/modules/notices/repository";
import type { Especialidad, TipoAviso } from "@/modules/notices/types";
import { especialidadDominioAPrograma } from "@/modules/scheduling/especialidad-programa";
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
  /** Si el aviso ya está en `programa_semanal`, no agregar chip duplicado `OT-…`. */
  skipProgramaPublicadoSync?: boolean;
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

  if (!input.skipProgramaPublicadoSync) {
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
  return especialidadDominioAPrograma(esp);
}

function localidadProgramaDesdeInput(localidad: string | undefined, aviso: { ubicacion_tecnica: string; centro: string }): string {
  return (localidad?.trim() || aviso.ubicacion_tecnica || aviso.centro || "").trim() || "—";
}

export type UbicacionAvisoEnProgramaPublicado = {
  programaDocId: string;
  weekId: string;
  localidad: string;
  dia: DiaSemanaPrograma;
  especialidad: EspecialidadPrograma;
  slotFecha: SlotSemanal["fecha"] | null;
};

function findAvisoUbicacionEnSlots(
  slots: SlotSemanal[] | undefined,
  avisoNumero: string,
  avisoFirestoreId: string,
): Omit<UbicacionAvisoEnProgramaPublicado, "programaDocId" | "weekId"> | null {
  for (const slot of slots ?? []) {
    for (const a of slot.avisos ?? []) {
      const match =
        a.numero === avisoNumero ||
        Boolean(avisoFirestoreId && a.avisoFirestoreId?.trim() === avisoFirestoreId);
      if (match) {
        return {
          localidad: slot.localidad,
          dia: slot.dia,
          especialidad: slot.especialidad,
          slotFecha: slot.fecha ?? null,
        };
      }
    }
  }
  return null;
}

/** Busca el aviso en la grilla publicada (prioriza `incluido_en_semana`, luego semana de la fecha de la OT). */
export async function resolverUbicacionAvisoEnProgramaPublicado(input: {
  centro: string;
  n_aviso: string;
  avisoFirestoreId: string;
  incluido_en_semana?: string | null;
  fechaReferencia?: { toDate?: () => Date } | null;
}): Promise<UbicacionAvisoEnProgramaPublicado | null> {
  const centro = input.centro.trim();
  if (!centro) return null;
  const candidatos: string[] = [];
  const inc = String(input.incluido_en_semana ?? "").trim();
  if (/^\d{4}-W\d{2}$/.test(inc)) candidatos.push(inc);
  const fr = input.fechaReferencia;
  if (fr != null && typeof fr.toDate === "function") {
    const d = fr.toDate();
    if (!Number.isNaN(d.getTime())) {
      const w = getIsoWeekId(d);
      if (!candidatos.includes(w)) candidatos.push(w);
    }
  }
  const hoy = getIsoWeekId(new Date());
  if (!candidatos.includes(hoy)) candidatos.push(hoy);

  for (const weekId of candidatos) {
    const programaDocId = propuestaSemanaDocId(centro, weekId);
    const programa = await getProgramaSemana(programaDocId);
    const ubic = findAvisoUbicacionEnSlots(programa?.slots, input.n_aviso, input.avisoFirestoreId);
    if (ubic) {
      return { programaDocId, weekId, ...ubic };
    }
  }
  return null;
}

/**
 * Si el aviso ya figura en `programa_semanal`, solo vincula la OT al chip existente (sin duplicar `OT-…`).
 * @returns `true` si se actualizó la grilla publicada.
 */
export async function vincularWorkOrderEnProgramaPublicadoDesdeAviso(input: {
  workOrderId: string;
  avisoId: string;
}): Promise<boolean> {
  const aviso = await getAvisoById(input.avisoId.trim());
  if (!aviso) return false;
  const wo = await getWorkOrderById(input.workOrderId.trim());
  if (!wo) return false;

  const ubic = await resolverUbicacionAvisoEnProgramaPublicado({
    centro: aviso.centro,
    n_aviso: aviso.n_aviso,
    avisoFirestoreId: aviso.id,
    incluido_en_semana: aviso.incluido_en_semana,
    fechaReferencia: wo.fecha_inicio_programada ?? aviso.fecha_programada ?? null,
  });
  if (!ubic) return false;

  return setWorkOrderIdEnProgramaSemanaAdmin({
    programaDocId: ubic.programaDocId,
    localidad: ubic.localidad,
    dia: ubic.dia,
    especialidad: ubic.especialidad,
    avisoNumero: aviso.n_aviso,
    avisoFirestoreId: aviso.id,
    workOrderId: wo.id,
  });
}

function buildAvisoSlotDesdeAviso(aviso: {
  id: string;
  n_aviso: string;
  texto_corto: string;
  tipo: TipoAviso;
  urgente?: boolean;
  ubicacion_tecnica: string;
  antecesor_orden_abierta?: { work_order_id?: string | null } | null;
}): AvisoSlot {
  return {
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
}

/** Publica un aviso en `programa_semanal` y marca `incluido_en_semana`. Si ya estaba en la semana, lo mueve al día indicado. */
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
  const espProg = especialidadAAvisoToPrograma(aviso.especialidad);
  const loc = localidadProgramaDesdeInput(input.localidad, aviso);
  const programaDocId = propuestaSemanaDocId(aviso.centro, input.semanaId);
  const programa = await getProgramaSemana(programaDocId);
  const ubicEnGrilla = findAvisoUbicacionEnSlots(programa?.slots, aviso.n_aviso, aviso.id);

  if (ubicEnGrilla) {
    const mismaCelda =
      ubicEnGrilla.dia === input.dia &&
      (ubicEnGrilla.localidad.trim() || "—") === loc &&
      ubicEnGrilla.especialidad === espProg;
    if (mismaCelda) {
      await updateAviso(aviso.id, { incluido_en_semana: input.semanaId });
      return;
    }
    await moveAvisoInPublishedPrograma({
      session: input.session,
      sourceProgramaDocId: programaDocId,
      destProgramaDocId: programaDocId,
      avisoNumero: aviso.n_aviso,
      avisoFirestoreId: aviso.id,
      from: ubicEnGrilla,
      destDia: input.dia,
    });
    return;
  }

  const nuevoAviso = buildAvisoSlotDesdeAviso(aviso);
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

/**
 * Quita un aviso/tarea de la grilla publicada `programa_semanal` sin borrar el documento en `avisos`.
 * Limpia `incluido_en_semana` cuando corresponde y desagenda la OT en `weekly_schedule` si existía slot.
 */
export async function removeAvisoFromPublishedPrograma(input: {
  session: UserProfileWithUid;
  programaDocId: string;
  avisoNumero: string;
  avisoFirestoreId?: string | null;
  workOrderId?: string | null;
  from: {
    localidad: string;
    dia: DiaSemanaPrograma;
    especialidad: EspecialidadPrograma;
  };
}): Promise<void> {
  const programa = await getProgramaSemana(input.programaDocId.trim());
  if (!programa) {
    throw new AppError("NOT_FOUND", "Programa no encontrado");
  }
  const rol = toPermisoRol(input.session.rol);
  if (rol !== "superadmin") {
    throw new AppError("FORBIDDEN", "Solo el súper administrador puede quitar tareas del programa semanal");
  }

  const semanaIso = parseIsoWeekIdFromSemanaParam(input.programaDocId);
  const avisoNumero = input.avisoNumero.trim();
  const avisoFirestoreId = input.avisoFirestoreId?.trim() || undefined;
  const workOrderId = input.workOrderId?.trim() || undefined;

  const locFrom = (input.from.localidad ?? "").trim() || "—";
  let encontrado = false;
  for (const slot of programa.slots ?? []) {
    if (slot.dia !== input.from.dia || slot.especialidad !== input.from.especialidad) continue;
    const slotLoc = (slot.localidad?.trim() || "—");
    if (slotLoc !== locFrom) continue;
    for (const a of slot.avisos ?? []) {
      if (a.numero !== avisoNumero) continue;
      const fid = a.avisoFirestoreId?.trim();
      const want = avisoFirestoreId;
      if (want && fid && fid !== want) continue;
      encontrado = true;
      break;
    }
    if (encontrado) break;
  }
  if (!encontrado) {
    throw new AppError(
      "VALIDATION",
      "No se encontró la tarea en esa celda del programa. Actualizá la página.",
    );
  }

  await removeAvisoFromProgramaSemanaAdmin({
    programaDocId: input.programaDocId.trim(),
    localidad: input.from.localidad,
    dia: input.from.dia,
    especialidad: input.from.especialidad,
    avisoNumero,
    avisoFirestoreId,
  });

  if (avisoFirestoreId) {
    const aviso = await getAvisoById(avisoFirestoreId);
    if (aviso && (!semanaIso || String(aviso.incluido_en_semana ?? "").trim() === semanaIso)) {
      await getAdminDb()
        .collection(COLLECTIONS.avisos)
        .doc(avisoFirestoreId)
        .update({
          incluido_en_semana: FieldValue.delete(),
          updated_at: FieldValue.serverTimestamp(),
        } as Record<string, unknown>);
    }
  }

  if (semanaIso && workOrderId) {
    const snap = await getAdminDb()
      .collection(COLLECTIONS.weekly_schedule)
      .doc(semanaIso)
      .collection("slots")
      .where("work_order_id", "==", workOrderId)
      .get();
    for (const doc of snap.docs) {
      await deleteWeeklySlotAdmin(semanaIso, doc.id);
    }
  }
}
