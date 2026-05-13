import { getAdminDb } from "@/firebase/firebaseAdmin";
import { AppError } from "@/lib/errors/app-error";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import { parseIsoWeekToBounds } from "@/modules/scheduling/iso-week";
import type {
  AvisoSlot,
  DiaSemanaPrograma,
  EspecialidadPrograma,
  ProgramaSemana,
  SlotSemanal,
  WeeklyPlanRow,
  WeeklyScheduleSlot,
} from "@/modules/scheduling/types";
import { parseIsoWeekIdFromSemanaParam } from "@/modules/scheduling/iso-week";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

const DIA_PROGRAMA_OFFSET: Record<DiaSemanaPrograma, number> = {
  lunes: 0,
  martes: 1,
  miercoles: 2,
  jueves: 3,
  viernes: 4,
  sabado: 5,
  domingo: 6,
};

function fechaBaseSlotSemanal(weekStart: Date, dia: DiaSemanaPrograma): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + DIA_PROGRAMA_OFFSET[dia]);
  d.setHours(12, 0, 0, 0);
  return d;
}

const SLOTS_SUB = "slots";
const PLAN_ROWS_SUB = "plan_rows";

export async function ensureWeeklyBucketAdmin(weekId: string, centro: string, semanaIso: string): Promise<void> {
  const ref = getAdminDb().collection(COLLECTIONS.weekly_schedule).doc(weekId);
  const snap = await ref.get();
  const patch = {
    semana_iso: semanaIso,
    centro,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (!snap.exists) {
    await ref.set({
      ...patch,
      created_at: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.set(patch, { merge: true });
  }
}

export async function createWeeklySlotAdmin(
  weekId: string,
  data: Omit<WeeklyScheduleSlot, "id" | "created_at">,
): Promise<string> {
  const colRef = getAdminDb()
    .collection(COLLECTIONS.weekly_schedule)
    .doc(weekId)
    .collection(SLOTS_SUB);
  const docRef = await colRef.add({
    ...data,
    created_at: FieldValue.serverTimestamp(),
  });
  await getAdminDb().collection(COLLECTIONS.weekly_schedule).doc(weekId).set(
    { updated_at: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return docRef.id;
}

export async function deleteWeeklySlotAdmin(weekId: string, slotId: string): Promise<void> {
  await getAdminDb()
    .collection(COLLECTIONS.weekly_schedule)
    .doc(weekId)
    .collection(SLOTS_SUB)
    .doc(slotId)
    .delete();
  await getAdminDb().collection(COLLECTIONS.weekly_schedule).doc(weekId).set(
    { updated_at: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

export async function updateWeeklySlotAdmin(
  weekId: string,
  slotId: string,
  patch: Partial<Pick<WeeklyScheduleSlot, "dia_semana" | "orden_en_dia" | "turno">>,
): Promise<void> {
  const ref = getAdminDb()
    .collection(COLLECTIONS.weekly_schedule)
    .doc(weekId)
    .collection(SLOTS_SUB)
    .doc(slotId);
  await ref.update({
    ...patch,
    updated_at: FieldValue.serverTimestamp(),
  } as Record<string, unknown>);
  await getAdminDb().collection(COLLECTIONS.weekly_schedule).doc(weekId).set(
    { updated_at: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

export async function replaceWeeklyPlanRowsAdmin(
  weekId: string,
  centro: string,
  rows: Array<Omit<WeeklyPlanRow, "id" | "created_at" | "updated_at">>,
): Promise<void> {
  const db = getAdminDb();
  const docRef = db.collection(COLLECTIONS.weekly_schedule).doc(weekId);
  const colRef = docRef.collection(PLAN_ROWS_SUB);
  const existing = await colRef.get();

  let batch = db.batch();
  let ops = 0;
  const commitIfNeeded = async () => {
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  for (const d of existing.docs) {
    batch.delete(d.ref);
    ops++;
    await commitIfNeeded();
  }

  const now = FieldValue.serverTimestamp();
  for (const r of rows) {
    const ref = colRef.doc();
    batch.set(ref, {
      ...r,
      centro,
      created_at: now,
      updated_at: now,
    });
    ops++;
    await commitIfNeeded();
  }

  if (ops > 0) await batch.commit();

  await ensureWeeklyBucketAdmin(weekId, centro, weekId);
}

async function nextPlanRowOrden(weekId: string, dia: number): Promise<number> {
  const snap = await getAdminDb()
    .collection(COLLECTIONS.weekly_schedule)
    .doc(weekId)
    .collection(PLAN_ROWS_SUB)
    .get();
  let max = -1;
  for (const d of snap.docs) {
    const row = d.data() as { dia_semana?: number; orden?: number };
    if (row.dia_semana === dia && typeof row.orden === "number") {
      max = Math.max(max, row.orden);
    }
  }
  return max + 1;
}

export async function createWeeklyPlanRowAdmin(
  weekId: string,
  data: Omit<WeeklyPlanRow, "id" | "created_at" | "updated_at" | "orden">,
): Promise<string> {
  const orden = await nextPlanRowOrden(weekId, data.dia_semana);
  const colRef = getAdminDb()
    .collection(COLLECTIONS.weekly_schedule)
    .doc(weekId)
    .collection(PLAN_ROWS_SUB);
  const docRef = await colRef.add({
    ...data,
    orden,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  await ensureWeeklyBucketAdmin(weekId, data.centro, weekId);
  return docRef.id;
}

async function touchWeeklyBucketDoc(weekId: string): Promise<void> {
  await getAdminDb().collection(COLLECTIONS.weekly_schedule).doc(weekId).set(
    { updated_at: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

export async function updateWeeklyPlanRowAdmin(
  weekId: string,
  rowId: string,
  patch: Partial<Pick<WeeklyPlanRow, "localidad" | "especialidad" | "texto" | "dia_semana">>,
): Promise<void> {
  await getAdminDb()
    .collection(COLLECTIONS.weekly_schedule)
    .doc(weekId)
    .collection(PLAN_ROWS_SUB)
    .doc(rowId)
    .set(
      {
        ...patch,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  await touchWeeklyBucketDoc(weekId);
}

export async function deleteWeeklyPlanRowAdmin(weekId: string, rowId: string): Promise<void> {
  await getAdminDb()
    .collection(COLLECTIONS.weekly_schedule)
    .doc(weekId)
    .collection(PLAN_ROWS_SUB)
    .doc(rowId)
    .delete();
  await touchWeeklyBucketDoc(weekId);
}

export async function getWeeklyPlanRowAdmin(
  weekId: string,
  rowId: string,
): Promise<WeeklyPlanRow | null> {
  const snap = await getAdminDb()
    .collection(COLLECTIONS.weekly_schedule)
    .doc(weekId)
    .collection(PLAN_ROWS_SUB)
    .doc(rowId)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() as Omit<WeeklyPlanRow, "id">;
  return { id: snap.id, ...data } as WeeklyPlanRow;
}

export async function getProgramaSemana(semanaId: string): Promise<ProgramaSemana | null> {
  const ref = getAdminDb().collection(COLLECTIONS.programa_semanal).doc(semanaId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const d = snap.data() as Omit<ProgramaSemana, "id">;
  return { id: snap.id, ...d, slots: d.slots ?? [] };
}

export async function upsertProgramaSemana(data: ProgramaSemana): Promise<void> {
  const ref = getAdminDb().collection(COLLECTIONS.programa_semanal).doc(data.id);
  const snap = await ref.get();
  const { id: _docId, createdAt: _createdAtIgnored, ...fields } = data;
  void _docId;
  void _createdAtIgnored;
  if (!snap.exists) {
    await ref.set({
      ...fields,
      createdAt: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.set(fields, { merge: true });
  }
}

/**
 * Crea `programa_semanal/{centro}_{YYYY-Www}` con metadatos mínimos si aún no existe.
 * Idempotente. Sirve para agendar OT antes de que exista plan cargado desde motor / Excel.
 */
export async function ensureProgramaSemanalDocParaSemanaIsoAdmin(input: {
  semanaIso: string;
  centro: string;
}): Promise<void> {
  const semanaIso = input.semanaIso.trim();
  const centro = input.centro.trim();
  if (!/^\d{4}-W\d{2}$/.test(semanaIso) || !centro) {
    throw new AppError("VALIDATION", "Semana ISO o centro inválido para programa semanal", {
      details: { semanaIso, centro },
    });
  }

  const db = getAdminDb();
  const docId = propuestaSemanaDocId(centro, semanaIso);
  const ref = db.collection(COLLECTIONS.programa_semanal).doc(docId);
  const snap = await ref.get();
  if (snap.exists) return;

  const { start, end } = parseIsoWeekToBounds(semanaIso);
  const weekPart = semanaIso.split("-W")[1] ?? "";
  const semanaLabel = `Semana ${parseInt(weekPart, 10) || weekPart} — ${start.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  })} al ${end.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}`;

  await ref.set({
    centro,
    fechaInicio: Timestamp.fromDate(start),
    fechaFin: Timestamp.fromDate(end),
    semanaLabel,
    slots: [],
    createdAt: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
}

/**
 * Inserta un aviso en la grilla publicada `programa_semanal` (slot = localidad × día × especialidad).
 * Si el documento de la semana no existe, se crea con metadatos mínimos.
 */
export async function appendAvisoToProgramaSemanaAdmin(input: {
  semanaId: string;
  centro: string;
  dia: DiaSemanaPrograma;
  especialidad: EspecialidadPrograma;
  localidad: string;
  nuevoAviso: AvisoSlot;
}): Promise<void> {
  const db = getAdminDb();
  const docId = propuestaSemanaDocId(input.centro, input.semanaId);
  const ref = db.collection(COLLECTIONS.programa_semanal).doc(docId);
  const snap = await ref.get();
  const { start, end } = parseIsoWeekToBounds(input.semanaId);
  const loc = input.localidad.trim() || "—";
  const fecha = Timestamp.fromDate(fechaBaseSlotSemanal(start, input.dia));

  const raw = snap.exists ? (snap.data() as Record<string, unknown>) : {};
  let slots: SlotSemanal[] = ((raw.slots as SlotSemanal[] | undefined) ?? []) as SlotSemanal[];

  const idx = slots.findIndex(
    (s) => s.localidad === loc && s.dia === input.dia && s.especialidad === input.especialidad,
  );

  if (idx >= 0) {
    const cur = slots[idx]!;
    const avisos = [...(cur.avisos ?? [])];
    if (avisos.some((a) => a.numero === input.nuevoAviso.numero)) {
      return;
    }
    avisos.push(input.nuevoAviso);
    const next = [...slots];
    next[idx] = {
      ...cur,
      avisos,
      fecha: (cur.fecha ?? fecha) as SlotSemanal["fecha"],
    };
    slots = next;
  } else {
    const nuevo: SlotSemanal = {
      localidad: loc,
      especialidad: input.especialidad,
      dia: input.dia,
      fecha: fecha as unknown as SlotSemanal["fecha"],
      avisos: [input.nuevoAviso],
    };
    slots = [...slots, nuevo];
  }

  const weekPart = input.semanaId.split("-W")[1] ?? "";
  const semanaLabel = `Semana ${parseInt(weekPart, 10) || weekPart} — ${start.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  })} al ${end.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}`;
  const patch: Record<string, unknown> = {
    slots,
    semanaLabel,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (!snap.exists) {
    patch.fechaInicio = Timestamp.fromDate(start);
    patch.fechaFin = Timestamp.fromDate(end);
    patch.centro = input.centro;
    patch.createdAt = FieldValue.serverTimestamp();
  }

  await ref.set(patch, { merge: true });
}

export async function getWeeklySlotAdmin(
  weekId: string,
  slotId: string,
): Promise<(WeeklyScheduleSlot & { id: string }) | null> {
  const snap = await getAdminDb()
    .collection(COLLECTIONS.weekly_schedule)
    .doc(weekId)
    .collection(SLOTS_SUB)
    .doc(slotId)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() as Omit<WeeklyScheduleSlot, "id">;
  return { id: snap.id, ...data } as WeeklyScheduleSlot & { id: string };
}

/** Quita un ítem de aviso u OT de la grilla publicada (misma clave que al agregar por `numero`). */
export async function removeAvisoFromProgramaSemanaAdmin(input: {
  programaDocId: string;
  localidad: string;
  dia: DiaSemanaPrograma;
  especialidad: EspecialidadPrograma;
  avisoNumero: string;
  avisoFirestoreId?: string | null;
}): Promise<void> {
  const ref = getAdminDb().collection(COLLECTIONS.programa_semanal).doc(input.programaDocId.trim());
  await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return;
    const raw = snap.data() as Record<string, unknown>;
    const slots = cloneSlotsShallow(((raw.slots as SlotSemanal[]) ?? []) as SlotSemanal[]);
    const { slots: nextSlots, removed } = removeAvisoFromSlotsClone(
      slots,
      input.localidad,
      input.dia,
      input.especialidad,
      input.avisoNumero,
      input.avisoFirestoreId,
    );
    if (!removed) return;
    txn.update(ref, {
      slots: nextSlots,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
  });
}

/**
 * Quita el vínculo `workOrderId` del aviso en la celda publicada (el aviso permanece en el programa).
 */
export async function clearWorkOrderIdEnProgramaSemanaAdmin(input: {
  programaDocId: string;
  localidad: string;
  dia: DiaSemanaPrograma;
  especialidad: EspecialidadPrograma;
  avisoNumero: string;
  avisoFirestoreId?: string | null;
  workOrderId: string;
}): Promise<void> {
  const woId = input.workOrderId.trim();
  if (!woId) return;
  const ref = getAdminDb().collection(COLLECTIONS.programa_semanal).doc(input.programaDocId.trim());
  await getAdminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return;
    const raw = snap.data() as Record<string, unknown>;
    const slots = cloneSlotsShallow(((raw.slots as SlotSemanal[]) ?? []) as SlotSemanal[]);
    const loc = normLocalidadPrograma(input.localidad);
    const idx = findSlotIndexByKey(slots, loc, input.dia, input.especialidad);
    if (idx < 0) return;
    const cur = slots[idx]!;
    const avisos = [...(cur.avisos ?? [])];
    let changed = false;
    for (let i = 0; i < avisos.length; i++) {
      const a = avisos[i]!;
      if (a.numero !== input.avisoNumero) continue;
      const fid = a.avisoFirestoreId?.trim();
      const want = input.avisoFirestoreId?.trim();
      if (want && fid && fid !== want) continue;
      /** Misma regla que `removeAvisoFromSlotsClone`: el slot puede no tener doc id aún. */
      const curWo = a.workOrderId?.trim();
      if (curWo !== woId) continue;
      const { workOrderId: _drop, ...rest } = a;
      avisos[i] = rest;
      changed = true;
      break;
    }
    if (!changed) return;
    const nextSlots = [...slots];
    nextSlots[idx] = { ...cur, avisos };
    txn.update(ref, {
      slots: nextSlots,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
  });
}

function normLocalidadPrograma(loc: string | undefined): string {
  return (loc?.trim() || "").trim() || "—";
}

function cloneSlotsShallow(slots: SlotSemanal[]): SlotSemanal[] {
  return slots.map((s) => ({
    ...s,
    avisos: [...(s.avisos ?? [])],
  }));
}

function slotKeyMatch(s: SlotSemanal, localidad: string, dia: DiaSemanaPrograma, esp: EspecialidadPrograma): boolean {
  return normLocalidadPrograma(s.localidad) === localidad && s.dia === dia && s.especialidad === esp;
}

function findSlotIndexByKey(
  slots: SlotSemanal[],
  localidad: string,
  dia: DiaSemanaPrograma,
  esp: EspecialidadPrograma,
): number {
  return slots.findIndex((s) => slotKeyMatch(s, localidad, dia, esp));
}

/**
 * Quita un aviso de la grilla copiada y devuelve el objeto; opcionalmente exige coincidencia con `avisoFirestoreId`.
 */
function removeAvisoFromSlotsClone(
  slots: SlotSemanal[],
  localidadRaw: string,
  dia: DiaSemanaPrograma,
  esp: EspecialidadPrograma,
  avisoNumero: string,
  avisoFirestoreId?: string | null,
): { slots: SlotSemanal[]; removed: AvisoSlot | null } {
  const loc = normLocalidadPrograma(localidadRaw);
  const idx = findSlotIndexByKey(slots, loc, dia, esp);
  if (idx < 0) {
    return { slots, removed: null };
  }
  const cur = slots[idx]!;
  const avisos = [...(cur.avisos ?? [])];
  const matchIdx = avisos.findIndex((a) => {
    if (a.numero !== avisoNumero) return false;
    const fid = a.avisoFirestoreId?.trim();
    const want = avisoFirestoreId?.trim();
    if (want && fid && fid !== want) return false;
    /** El slot a veces no tiene `avisoFirestoreId`; el cliente sí: alineamos por número SAP. */
    return true;
  });
  if (matchIdx < 0) return { slots, removed: null };

  const [removed] = avisos.splice(matchIdx, 1);
  if (!removed) return { slots, removed: null };

  let nextSlots: SlotSemanal[];
  if (avisos.length === 0) {
    nextSlots = [...slots.slice(0, idx), ...slots.slice(idx + 1)];
  } else {
    nextSlots = [...slots];
    nextSlots[idx] = {
      ...cur,
      avisos,
    };
  }
  return { slots: nextSlots, removed };
}

function mergeAvisoIntoSlots(
  slots: SlotSemanal[],
  localidadRaw: string,
  destDia: DiaSemanaPrograma,
  especialidad: EspecialidadPrograma,
  nuevoAviso: AvisoSlot,
  weekBounds: { start: Date },
  forbidDuplicateNumero: boolean,
): SlotSemanal[] {
  const loc = normLocalidadPrograma(localidadRaw);
  const fecha = Timestamp.fromDate(fechaBaseSlotSemanal(weekBounds.start, destDia));
  const idx = findSlotIndexByKey(slots, loc, destDia, especialidad);

  if (idx >= 0) {
    const cur = slots[idx]!;
    const avisos = [...(cur.avisos ?? [])];
    if (forbidDuplicateNumero && avisos.some((a) => a.numero === nuevoAviso.numero)) {
      throw new AppError("CONFLICT", "El aviso ya figura en el día / semana destino");
    }
    if (avisos.some((a) => a.numero === nuevoAviso.numero)) {
      return slots;
    }
    avisos.push(nuevoAviso);
    const next = [...slots];
    next[idx] = {
      ...cur,
      avisos,
      fecha: (cur.fecha ?? fecha) as SlotSemanal["fecha"],
    };
    return next;
  }

  const nuevoSlot: SlotSemanal = {
    localidad: loc,
    especialidad,
    dia: destDia,
    fecha: fecha as unknown as SlotSemanal["fecha"],
    avisos: [nuevoAviso],
  };
  return [...slots, nuevoSlot];
}

function semanaLabelDesdeIso(semanaIso: string, start: Date, end: Date): string {
  const weekPart = semanaIso.split("-W")[1] ?? "";
  return `Semana ${parseInt(weekPart, 10) || weekPart} — ${start.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  })} al ${end.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}`;
}

/** ISO `YYYY-Www` extraído del id documento (`2026-W15` o `PC01_2026-W15`). */
function isoWeekDesdeProgramaSemanalDocId(docId: string): string {
  return parseIsoWeekIdFromSemanaParam(docId) ?? "";
}

/**
 * Mueve un aviso en `programa_semanal`: otra celda (otro día y/u otra semana).
 * Actualiza `incluido_en_semana` del documento del aviso al cambiar de semana ISO (si existe doc en `avisos`).
 */
export async function moveAvisoEnProgramaPublicadoTxn(input: {
  sourceProgramaDocId: string;
  destProgramaDocId: string;
  destSemanaIso: string;
  centro: string;
  avisoNumero: string;
  avisoFirestoreId?: string | null;
  from: {
    localidad: string;
    dia: DiaSemanaPrograma;
    especialidad: EspecialidadPrograma;
  };
  destDia: DiaSemanaPrograma;
}): Promise<void> {
  const sameDoc = input.sourceProgramaDocId === input.destProgramaDocId;
  const destBounds = parseIsoWeekToBounds(input.destSemanaIso);

  await getAdminDb().runTransaction(async (txn) => {
    const db = getAdminDb();
    const srcRef = db.collection(COLLECTIONS.programa_semanal).doc(input.sourceProgramaDocId);
    const dstRef = db.collection(COLLECTIONS.programa_semanal).doc(input.destProgramaDocId);

    const srcSnap = await txn.get(srcRef);
    if (!srcSnap.exists) {
      throw new AppError("NOT_FOUND", "Programa de origen no encontrado");
    }
    const dstSnap = sameDoc ? srcSnap : await txn.get(dstRef);

    const srcData = srcSnap.data() as Record<string, unknown>;
    const centroProg = typeof srcData.centro === "string" ? srcData.centro.trim() : "";
    if (centroProg && centroProg !== input.centro.trim()) {
      throw new AppError("FORBIDDEN", "El programa publicado pertenece a otro centro");
    }

    const sourceWeekIsoGuess = isoWeekDesdeProgramaSemanalDocId(input.sourceProgramaDocId);

    const sourceSlotsClone = cloneSlotsShallow(((srcData.slots as SlotSemanal[] | undefined) ?? []) as SlotSemanal[]);

    const { slots: slotsAfterRemove, removed } = removeAvisoFromSlotsClone(
      sourceSlotsClone,
      input.from.localidad,
      input.from.dia,
      input.from.especialidad,
      input.avisoNumero,
      input.avisoFirestoreId,
    );
    if (!removed) {
      throw new AppError(
        "VALIDATION",
        "No se encontró el aviso en la celda de origen. Actualizá la página.",
      );
    }

    let destSlotsBase: SlotSemanal[];
    if (sameDoc) {
      destSlotsBase = cloneSlotsShallow(slotsAfterRemove);
    } else {
      destSlotsBase = dstSnap.exists
        ? cloneSlotsShallow(((dstSnap.data() as Record<string, unknown>).slots as SlotSemanal[] | undefined) ?? [])
        : [];
      const rawDst = dstSnap.exists ? (dstSnap.data() as Record<string, unknown>) : {};
      const centroDst = typeof rawDst.centro === "string" ? rawDst.centro.trim() : "";

      if (dstSnap.exists && centroDst && centroDst !== input.centro.trim()) {
        throw new AppError("CONFLICT", "La semana destino pertenece a otra planta");
      }
      const centroSrc =
        typeof srcData.centro === "string" ? (srcData.centro as string).trim() : "";
      if (dstSnap.exists && centroDst && centroSrc && centroDst !== centroSrc) {
        throw new AppError("CONFLICT", "Inconsistencia de centro entre programas semanales");
      }
    }

    let finalDestSlots: SlotSemanal[];
    try {
      finalDestSlots = mergeAvisoIntoSlots(
        destSlotsBase,
        input.from.localidad,
        input.destDia,
        input.from.especialidad,
        removed,
        destBounds,
        true,
      );
    } catch (e) {
      if (e instanceof AppError && e.code === "CONFLICT") {
        throw new AppError(
          "VALIDATION",
          "Ese aviso ya figura en el día / semana destino.",
        );
      }
      throw e;
    }

    const fid = removed.avisoFirestoreId?.trim();
    const cruzaSemanas = Boolean(sourceWeekIsoGuess && sourceWeekIsoGuess !== input.destSemanaIso);
    if (cruzaSemanas && fid) {
      txn.update(db.collection(COLLECTIONS.avisos).doc(fid), {
        incluido_en_semana: input.destSemanaIso,
        updated_at: FieldValue.serverTimestamp(),
      } as Record<string, unknown>);
    }

    if (sameDoc) {
      txn.update(srcRef, {
        slots: finalDestSlots,
        updated_at: FieldValue.serverTimestamp(),
      } as Record<string, unknown>);
      return;
    }

    txn.set(
      srcRef,
      {
        slots: slotsAfterRemove,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const { start: dStart, end: dEnd } = destBounds;
    const patchDest: Record<string, unknown> = {
      slots: finalDestSlots,
      semanaLabel: semanaLabelDesdeIso(input.destSemanaIso, dStart, dEnd),
      updated_at: FieldValue.serverTimestamp(),
    };
    if (!dstSnap.exists) {
      patchDest.fechaInicio = Timestamp.fromDate(dStart);
      patchDest.fechaFin = Timestamp.fromDate(dEnd);
      patchDest.centro = input.centro;
      patchDest.createdAt = FieldValue.serverTimestamp();
    }

    txn.set(dstRef, patchDest, { merge: true });
  });
}
