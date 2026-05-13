import { getAdminDb } from "@/firebase/firebaseAdmin";
import { AVISOS_COLLECTION, COLLECTIONS } from "@/lib/firestore/collections";
import type { PlanMantenimientoFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import {
  planMantenimientoSeedFromAviso,
  planVencimientoPatchFromAviso,
} from "@/lib/plan-mantenimiento/from-aviso";
import type { Aviso } from "@/modules/notices/types";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { addDays } from "date-fns";

const PLAN = COLLECTIONS.plan_mantenimiento;

export async function listPlanesMantenimientoCentro(centro: string): Promise<PlanMantenimientoFirestore[]> {
  const snap = await getAdminDb().collection(PLAN).where("centro", "==", centro.trim()).get();
  return snap.docs.map(
    (d) => ({ id: d.id, ...(d.data() as Omit<PlanMantenimientoFirestore, "id">) }),
  );
}

export async function getPlanMantenimientoAdmin(planId: string): Promise<PlanMantenimientoFirestore | null> {
  const snap = await getAdminDb().collection(PLAN).doc(planId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<PlanMantenimientoFirestore, "id">) };
}

/** Crea o actualiza planes desde avisos de un centro (id de plan = id de aviso). */
export async function ensurePlansForCentro(centro: string): Promise<{ upserts: number }> {
  const db = getAdminDb();
  const snap = await db.collection(AVISOS_COLLECTION).where("centro", "==", centro.trim()).get();
  const refs = snap.docs.map((d) => db.collection(PLAN).doc(d.id));
  const exists = new Set<string>();
  for (let i = 0; i < refs.length; i += 30) {
    const chunk = refs.slice(i, i + 30);
    const snaps = await db.getAll(...chunk);
    for (const s of snaps) {
      if (s.exists) exists.add(s.id);
    }
  }

  let upserts = 0;
  const batchSize = 400;
  let batch = db.batch();
  let n = 0;

  const flush = async () => {
    if (n === 0) return;
    await batch.commit();
    batch = db.batch();
    n = 0;
  };

  for (const doc of snap.docs) {
    const a = { id: doc.id, ...(doc.data() as Omit<Aviso, "id">) };
    const ref = db.collection(PLAN).doc(a.id);
    if (!exists.has(a.id)) {
      batch.set(ref, planMantenimientoSeedFromAviso(a, "sync_avisos"));
    } else {
      batch.update(ref, {
        ...planVencimientoPatchFromAviso(a),
        centro: a.centro,
      } as Record<string, unknown>);
    }
    upserts++;
    n++;
    if (n >= batchSize) await flush();
  }
  await flush();
  return { upserts };
}

/** Actualiza los meses programados de un plan (solo Admin SDK). */
export async function updatePlanMesesProgramadosAdmin(planId: string, meses: number[]): Promise<void> {
  const ref = getAdminDb().collection(PLAN).doc(planId);
  await ref.update({
    meses_programados: meses.length > 0 ? meses : FieldValue.delete(),
    updated_at: FieldValue.serverTimestamp(),
  } as Record<string, unknown>);
}

/** Planificación preventiva (`semana_asignada`): solo Admin SDK — reglas cliente `plan_mantenimiento` son read-only. */
export async function updatePlanSemanaAsignadaAdmin(planId: string, semanaIso: string | null): Promise<void> {
  const ref = getAdminDb().collection(PLAN).doc(planId);
  const patch: Record<string, unknown> = { updated_at: FieldValue.serverTimestamp() };
  if (semanaIso == null || String(semanaIso).trim() === "") {
    patch.semana_asignada = FieldValue.delete();
  } else {
    patch.semana_asignada = semanaIso.trim();
  }
  await ref.update(patch);
}

export async function setPlanIncluidoOtPendiente(planId: string, otId: string | null): Promise<void> {
  await getAdminDb()
    .collection(PLAN)
    .doc(planId)
    .update({
      incluido_en_ot_pendiente: otId,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
}

/** Tras cerrar la OT vinculada al plan (misma clave que aviso). */
export async function updatePlanMantenimientoAfterClose(input: {
  planId: string;
  otId: string;
  diasCiclo: number;
  /**
   * Fecha real del último mantenimiento (p. ej. cierre histórico / empalme).
   * Si no se informa, se usa el momento del commit en servidor (mismo comportamiento que antes).
   */
  fechaUltimaEjecucion?: Date;
}): Promise<void> {
  const base = input.fechaUltimaEjecucion ?? null;
  const prox = base ? addDays(base, input.diasCiclo) : addDays(new Date(), input.diasCiclo);
  const ultimaPatch =
    base != null
      ? { ultima_ejecucion_fecha: Timestamp.fromDate(base) }
      : { ultima_ejecucion_fecha: FieldValue.serverTimestamp() };
  await getAdminDb()
    .collection(PLAN)
    .doc(input.planId)
    .update({
      ...ultimaPatch,
      ultima_ejecucion_ot_id: input.otId,
      proxima_fecha_objetivo: Timestamp.fromDate(prox),
      estado_vencimiento: "ok",
      dias_para_vencer: input.diasCiclo,
      incluido_en_ot_pendiente: null,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
}
