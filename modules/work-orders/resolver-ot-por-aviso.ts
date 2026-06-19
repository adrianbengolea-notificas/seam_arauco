import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  candidateAvisoDocIds,
  nAvisoStringsForFirestoreInQuery,
} from "@/lib/import/aviso-numero-canonical";
import { numeroAvisoVisible } from "@/modules/work-orders/n-ot-from-aviso";
import type { WorkOrder } from "@/modules/work-orders/types";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from "firebase/firestore";

type WorkOrderPick = Pick<
  WorkOrder,
  "id" | "estado" | "updated_at" | "aviso_numero" | "n_ot" | "aviso_id" | "archivada"
>;

function variantesNumeroAviso(avisoNumero: string | undefined): string[] {
  const raw = avisoNumero?.trim() ?? "";
  if (!raw) return [];
  const s = new Set<string>();
  for (const v of nAvisoStringsForFirestoreInQuery(raw)) s.add(v);
  const visible = numeroAvisoVisible(raw);
  if (visible) s.add(visible);
  return [...s].filter(Boolean);
}

function variantesAvisoDocId(avisoDocId: string | undefined, avisoNumero: string | undefined): string[] {
  const s = new Set<string>();
  const doc = avisoDocId?.trim();
  if (doc) s.add(doc);
  for (const v of variantesNumeroAviso(avisoNumero)) {
    for (const c of candidateAvisoDocIds(v)) s.add(c);
  }
  return [...s].filter(Boolean);
}

export function coincideOtConNumeroAviso(wo: WorkOrderPick, avisoNumero: string): boolean {
  const variants = new Set(variantesNumeroAviso(avisoNumero));
  const av = numeroAvisoVisible(wo.aviso_numero);
  const ot = numeroAvisoVisible(wo.n_ot);
  if (av && variants.has(av)) return true;
  if (ot && variants.has(ot)) return true;
  const rawAv = wo.aviso_numero?.trim();
  const rawOt = wo.n_ot?.trim();
  if (rawAv && variants.has(rawAv)) return true;
  if (rawOt && variants.has(rawOt)) return true;
  return false;
}

function elegirMejorCandidato(rows: WorkOrderPick[]): string | undefined {
  if (!rows.length) return undefined;
  const ordenadas = [...rows].sort((a, b) => {
    const aCerrada = a.estado === "CERRADA" ? 1 : 0;
    const bCerrada = b.estado === "CERRADA" ? 1 : 0;
    if (bCerrada !== aCerrada) return bCerrada - aCerrada;
    const ta = a.updated_at?.toMillis?.() ?? 0;
    const tb = b.updated_at?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return ordenadas[0]?.id?.trim() || undefined;
}

async function consultaPorCampoCentro(
  db: Firestore,
  centro: string,
  campo: "aviso_numero" | "n_ot",
  valor: string,
  acumulado: Map<string, WorkOrderPick>,
): Promise<void> {
  const qRef = query(
    collection(db, COLLECTIONS.work_orders),
    where("centro", "==", centro),
    where(campo, "==", valor),
    limit(8),
  );
  const snap = await getDocs(qRef);
  for (const d of snap.docs) {
    if (!acumulado.has(d.id)) {
      acumulado.set(d.id, { id: d.id, ...(d.data() as Omit<WorkOrderPick, "id">) });
    }
  }
}

/**
 * Busca la OT vinculada a un aviso aunque el vínculo en `avisos` esté roto o la OT esté archivada.
 * Incluye búsqueda por `aviso_id`, `aviso_numero` y `n_ot` en uno o varios centros.
 */
export async function buscarWorkOrderIdPorAvisoEnFirestore(
  db: Firestore,
  input: {
    avisoDocId?: string;
    avisoNumero?: string;
    centros?: string[];
  },
): Promise<string | undefined> {
  const avisoNumero = input.avisoNumero?.trim() || undefined;
  const centros = [...new Set((input.centros ?? []).map((c) => c.trim()).filter(Boolean))];
  const numeros = variantesNumeroAviso(avisoNumero);
  const avisoIds = variantesAvisoDocId(input.avisoDocId, avisoNumero);
  if (!avisoIds.length && !numeros.length) return undefined;

  const acumulado = new Map<string, WorkOrderPick>();

  for (const avisoId of avisoIds) {
    const qPorId = query(
      collection(db, COLLECTIONS.work_orders),
      where("aviso_id", "==", avisoId),
      limit(8),
    );
    const snapId = await getDocs(qPorId);
    for (const d of snapId.docs) {
      acumulado.set(d.id, { id: d.id, ...(d.data() as Omit<WorkOrderPick, "id">) });
    }
  }

  if (centros.length && numeros.length) {
    for (const centro of centros) {
      for (const numero of numeros) {
        await consultaPorCampoCentro(db, centro, "aviso_numero", numero, acumulado);
        await consultaPorCampoCentro(db, centro, "n_ot", numero, acumulado);
      }
    }
  }

  const candidatos = [...acumulado.values()];
  const filtrados = avisoNumero
    ? candidatos.filter((c) => coincideOtConNumeroAviso(c, avisoNumero) || avisoIds.includes(c.aviso_id?.trim() ?? ""))
    : candidatos;

  return elegirMejorCandidato(filtrados.length ? filtrados : candidatos);
}
