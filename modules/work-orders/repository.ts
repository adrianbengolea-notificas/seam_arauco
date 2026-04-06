import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS, WORK_ORDER_SUB } from "@/lib/firestore/collections";
import type { PlanillaRespuesta, PlanillaTemplate } from "@/lib/firestore/types";
import type {
  ChecklistItem,
  EvidenciaOT,
  WorkOrder,
  WorkOrderHistorialEvent,
} from "@/modules/work-orders/types";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";

export const WORK_ORDERS_COLLECTION = COLLECTIONS.work_orders;

function woRef(workOrderId: string) {
  return getAdminDb().collection(WORK_ORDERS_COLLECTION).doc(workOrderId);
}

export async function createWorkOrderDoc(
  data: Omit<WorkOrder, "id" | "created_at" | "updated_at">,
): Promise<string> {
  const ref = await getAdminDb().collection(WORK_ORDERS_COLLECTION).add({
    ...data,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function getWorkOrderById(workOrderId: string): Promise<WorkOrder | null> {
  const snap = await woRef(workOrderId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) };
}

export async function updateWorkOrderDoc(
  workOrderId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await woRef(workOrderId).update({
    ...patch,
    updated_at: FieldValue.serverTimestamp(),
  });
}

export async function appendHistorialAdmin(
  workOrderId: string,
  event: Omit<WorkOrderHistorialEvent, "id" | "created_at">,
): Promise<string> {
  const ref = await woRef(workOrderId).collection(WORK_ORDER_SUB.historial).add({
    ...event,
    created_at: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function listHistorialAdmin(workOrderId: string): Promise<WorkOrderHistorialEvent[]> {
  const snap = await woRef(workOrderId)
    .collection(WORK_ORDER_SUB.historial)
    .orderBy("created_at", "asc")
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkOrderHistorialEvent, "id">) }));
}

/** Export masivo: por centro y rango de `created_at` (filtro de especialidad en memoria). */
export async function listWorkOrdersForExportAdmin(input: {
  centro: string;
  createdFrom: Timestamp;
  createdTo: Timestamp;
  limit?: number;
}): Promise<WorkOrder[]> {
  const cap = Math.min(input.limit ?? 2000, 5000);
  const snap = await getAdminDb()
    .collection(WORK_ORDERS_COLLECTION)
    .where("centro", "==", input.centro.trim())
    .where("created_at", ">=", input.createdFrom)
    .where("created_at", "<=", input.createdTo)
    .orderBy("created_at", "asc")
    .limit(cap)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkOrder, "id">) }));
}

export async function addChecklistItemsBatch(
  workOrderId: string,
  items: Array<Omit<ChecklistItem, "id">>,
): Promise<void> {
  const batch = getAdminDb().batch();
  const col = woRef(workOrderId).collection(WORK_ORDER_SUB.checklist);
  for (const item of items) {
    const docRef = col.doc();
    batch.set(docRef, item);
  }
  await batch.commit();
}

export async function addEvidenciaDoc(
  workOrderId: string,
  row: Omit<EvidenciaOT, "id" | "created_at">,
): Promise<string> {
  const ref = await woRef(workOrderId).collection(WORK_ORDER_SUB.evidencias).add({
    ...row,
    created_at: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function updateChecklistItemDoc(
  workOrderId: string,
  itemId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await woRef(workOrderId).collection(WORK_ORDER_SUB.checklist).doc(itemId).update(patch);
}

export async function getChecklistItemDoc(
  workOrderId: string,
  itemId: string,
): Promise<ChecklistItem | null> {
  const snap = await woRef(workOrderId).collection(WORK_ORDER_SUB.checklist).doc(itemId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<ChecklistItem, "id">) };
}

export async function updateMaterialOtLineAdmin(
  workOrderId: string,
  lineId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await woRef(workOrderId).collection(WORK_ORDER_SUB.materiales_ot).doc(lineId).set(patch, { merge: true });
}

export async function getMaterialOtLineAdmin(
  workOrderId: string,
  lineId: string,
): Promise<Record<string, unknown> | null> {
  const snap = await woRef(workOrderId).collection(WORK_ORDER_SUB.materiales_ot).doc(lineId).get();
  if (!snap.exists) return null;
  return snap.data() ?? null;
}

// ─── Planillas (Admin SDK) ───────────────────────────────────────────────────

export async function getPlanillaTemplateAdmin(templateId: string): Promise<PlanillaTemplate | null> {
  const snap = await getAdminDb().collection(COLLECTIONS.planilla_templates).doc(templateId).get();
  if (!snap.exists) return null;
  return snap.data() as PlanillaTemplate;
}

export async function upsertPlanillaTemplateAdmin(template: PlanillaTemplate): Promise<void> {
  await getAdminDb().collection(COLLECTIONS.planilla_templates).doc(template.id).set(template, { merge: true });
}

const planillaCol = (workOrderId: string) =>
  woRef(workOrderId).collection(WORK_ORDER_SUB.planilla_respuestas);

export async function findPlanillaAbiertaAdmin(workOrderId: string): Promise<PlanillaRespuesta | null> {
  const snap = await planillaCol(workOrderId)
    .where("status", "in", ["borrador", "completada"])
    .limit(5)
    .get();
  if (snap.empty) return null;
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PlanillaRespuesta, "id">) }));
  rows.sort((a, b) => {
    const tb = (b.creadoAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    const ta = (a.creadoAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return rows[0] ?? null;
}

export async function createPlanillaRespuestaAdmin(
  workOrderId: string,
  data: Omit<PlanillaRespuesta, "id">,
): Promise<string> {
  const ref = await planillaCol(workOrderId).add(data as Record<string, unknown>);
  return ref.id;
}

export async function updatePlanillaRespuestaMergeAdmin(
  workOrderId: string,
  respuestaId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await planillaCol(workOrderId).doc(respuestaId).set(patch, { merge: true });
}

export async function getPlanillaRespuestaAdmin(
  workOrderId: string,
  respuestaId: string,
): Promise<PlanillaRespuesta | null> {
  const snap = await planillaCol(workOrderId).doc(respuestaId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<PlanillaRespuesta, "id">) };
}

export async function getLatestPlanillaRespuestaAdmin(workOrderId: string): Promise<PlanillaRespuesta | null> {
  const snap = await planillaCol(workOrderId).orderBy("creadoAt", "desc").limit(1).get();
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return { id: d.id, ...(d.data() as Omit<PlanillaRespuesta, "id">) };
}

export async function getSignedPlanillaRespuestaAdmin(workOrderId: string): Promise<PlanillaRespuesta | null> {
  const snap = await planillaCol(workOrderId).where("status", "==", "firmada").limit(25).get();
  if (snap.empty) return null;
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PlanillaRespuesta, "id">) }));
  rows.sort((a, b) => {
    const tb =
      (b.completadoAt as { toMillis?: () => number })?.toMillis?.() ??
      (b.creadoAt as { toMillis?: () => number })?.toMillis?.() ??
      0;
    const ta =
      (a.completadoAt as { toMillis?: () => number })?.toMillis?.() ??
      (a.creadoAt as { toMillis?: () => number })?.toMillis?.() ??
      0;
    return tb - ta;
  });
  return rows[0] ?? null;
}
