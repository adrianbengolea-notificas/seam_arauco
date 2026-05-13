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
      batch.update(ref, planVencimientoPatchFromAviso(a) as Record<string, unknown>);
    }
    upserts++;
    n++;
    if (n >= batchSize) await flush();
  }
  await flush();
  return { upserts };
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

/** Tras cerrar OT vinculada al plan (misma clave que aviso). */
export async function updatePlanMantenimientoAfterClose(input: {
  planId: string;
  otId: string;
  diasCiclo: number;
}): Promise<void> {
  const hoy = new Date();
  const prox = addDays(hoy, input.diasCiclo);
  await getAdminDb()
    .collection(PLAN)
    .doc(input.planId)
    .update({
      ultima_ejecucion_fecha: FieldValue.serverTimestamp(),
      ultima_ejecucion_ot_id: input.otId,
      proxima_fecha_objetivo: Timestamp.fromDate(prox),
      estado_vencimiento: "ok",
      dias_para_vencer: input.diasCiclo,
      incluido_en_ot_pendiente: null,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
}
