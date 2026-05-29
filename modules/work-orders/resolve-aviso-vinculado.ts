import { getAdminDb } from "@/firebase/firebaseAdmin";
import { candidateAvisoDocIds } from "@/lib/import/aviso-numero-canonical";
import { AVISOS_COLLECTION, getAvisoById } from "@/modules/notices/repository";
import type { Aviso } from "@/modules/notices/types";
import type { WorkOrder } from "@/modules/work-orders/types";

/** IDs de documento Firestore a probar para localizar el aviso de una OT. */
export function avisoDocIdsToTryForWorkOrder(
  wo: Pick<WorkOrder, "aviso_id" | "aviso_numero" | "n_ot">,
): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  add(wo.aviso_id ?? "");
  for (const raw of [wo.aviso_numero, wo.n_ot]) {
    if (!raw) continue;
    for (const c of candidateAvisoDocIds(String(raw))) add(c);
  }
  return out;
}

function avisoVinculadoAOrden(aviso: Aviso, workOrderId: string): boolean {
  const woid = (aviso.work_order_id ?? "").trim();
  return !woid || woid === workOrderId;
}

/**
 * Resuelve el aviso SAP vinculado a una OT: `aviso_id`, variantes del número y consulta por `work_order_id`.
 */
export async function resolveAvisoVinculadoAWorkOrder(
  wo: Pick<WorkOrder, "id" | "aviso_id" | "aviso_numero" | "n_ot">,
): Promise<Aviso | null> {
  for (const candId of avisoDocIdsToTryForWorkOrder(wo)) {
    const a = await getAvisoById(candId);
    if (a && avisoVinculadoAOrden(a, wo.id)) return a;
  }

  const snap = await getAdminDb()
    .collection(AVISOS_COLLECTION)
    .where("work_order_id", "==", wo.id)
    .limit(10)
    .get();

  if (snap.empty) return null;

  const avisos = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Aviso, "id">) }));
  const abierto = avisos.find((a) => a.estado !== "CERRADO" && a.estado !== "ANULADO");
  return abierto ?? avisos[0] ?? null;
}
