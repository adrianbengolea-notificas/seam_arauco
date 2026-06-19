import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CollectionReference } from "firebase-admin/firestore";
import {
  candidateAvisoDocIds,
  nAvisoStringsForFirestoreInQuery,
} from "@/lib/import/aviso-numero-canonical";
import { tienePermiso, toPermisoRol } from "@/lib/permisos/index";
import { getAvisoById } from "@/modules/notices/repository";
import type { Aviso } from "@/modules/notices/types";
import { coincideOtConNumeroAviso } from "@/modules/work-orders/resolver-ot-por-aviso";
import { numeroAvisoVisible } from "@/modules/work-orders/n-ot-from-aviso";
import type { WorkOrder } from "@/modules/work-orders/types";
import { centrosEfectivosDelUsuario } from "@/modules/users/centros-usuario";
import type { UserProfile } from "@/modules/users/types";

type WorkOrderPick = Pick<
  WorkOrder,
  "id" | "estado" | "updated_at" | "aviso_numero" | "n_ot" | "aviso_id" | "archivada" | "centro" | "tecnico_asignado_uid"
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

function servidorPuedeVerOt(wo: WorkOrderPick, profile: UserProfile, uid: string): boolean {
  const rol = toPermisoRol(profile.rol);
  if (wo.archivada === true && rol !== "superadmin") return false;
  if (tienePermiso(rol, "ot:ver_todas") || rol === "cliente_arauco") return true;
  if (rol === "admin" || rol === "supervisor") return true;
  const centros = centrosEfectivosDelUsuario(profile);
  if (!centros.includes(wo.centro?.trim() ?? "")) return false;
  const asignado = wo.tecnico_asignado_uid?.trim() ?? "";
  return asignado === uid || asignado === "";
}

async function consultaPorCampoCentroAdmin(
  col: CollectionReference,
  centro: string,
  campo: "aviso_numero" | "n_ot",
  valor: string,
  acumulado: Map<string, WorkOrderPick>,
): Promise<void> {
  const snap = await col.where("centro", "==", centro).where(campo, "==", valor).limit(8).get();
  for (const d of snap.docs) {
    if (!acumulado.has(d.id)) {
      acumulado.set(d.id, { id: d.id, ...(d.data() as Omit<WorkOrderPick, "id">) });
    }
  }
}

async function idsOtDesdeAvisoDoc(aviso: Aviso): Promise<string[]> {
  const ids: string[] = [];
  const wo = aviso.work_order_id?.trim();
  const ult = aviso.ultima_ejecucion_ot_id?.trim();
  if (wo) ids.push(wo);
  if (ult && ult !== wo) ids.push(ult);
  return ids;
}

async function buscarAvisosPorNumero(avisoNumero: string): Promise<Aviso[]> {
  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.avisos);
  const numeros = variantesNumeroAviso(avisoNumero);
  const porId = new Map<string, Aviso>();
  for (const n of numeros) {
    const snap = await col.where("n_aviso", "==", n).limit(8).get();
    for (const d of snap.docs) {
      porId.set(d.id, { id: d.id, ...(d.data() as Omit<Aviso, "id">) });
    }
  }
  for (const id of variantesAvisoDocId(undefined, avisoNumero)) {
    const av = await getAvisoById(id);
    if (av) porId.set(av.id, av);
  }
  return [...porId.values()];
}

/**
 * Búsqueda Admin de OT por aviso (incluye archivadas). Devuelve id solo si el usuario puede verla.
 */
export async function buscarWorkOrderIdPorAvisoAdmin(input: {
  avisoDocId?: string;
  avisoNumero?: string;
  centros?: string[];
  profile: UserProfile;
  uid: string;
}): Promise<string | undefined> {
  const avisoNumero = input.avisoNumero?.trim() || undefined;
  const centros = [...new Set((input.centros ?? []).map((c) => c.trim()).filter(Boolean))];
  const numeros = variantesNumeroAviso(avisoNumero);
  const avisoIds = variantesAvisoDocId(input.avisoDocId, avisoNumero);
  if (!avisoIds.length && !numeros.length && !avisoNumero) return undefined;

  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.work_orders);
  const acumulado = new Map<string, WorkOrderPick>();

  if (avisoNumero) {
    const avisos = await buscarAvisosPorNumero(avisoNumero);
    for (const av of avisos) {
      for (const otId of await idsOtDesdeAvisoDoc(av)) {
        const snap = await col.doc(otId).get();
        if (snap.exists) {
          acumulado.set(snap.id, { id: snap.id, ...(snap.data() as Omit<WorkOrderPick, "id">) });
        }
      }
    }
  }

  for (const avisoId of avisoIds) {
    const av = await getAvisoById(avisoId);
    if (av) {
      for (const otId of await idsOtDesdeAvisoDoc(av)) {
        const snap = await col.doc(otId).get();
        if (snap.exists) {
          acumulado.set(snap.id, { id: snap.id, ...(snap.data() as Omit<WorkOrderPick, "id">) });
        }
      }
    }
    const snapId = await col.where("aviso_id", "==", avisoId).limit(8).get();
    for (const d of snapId.docs) {
      acumulado.set(d.id, { id: d.id, ...(d.data() as Omit<WorkOrderPick, "id">) });
    }
  }

  if (centros.length && numeros.length) {
    for (const centro of centros) {
      for (const numero of numeros) {
        await consultaPorCampoCentroAdmin(col, centro, "aviso_numero", numero, acumulado);
        await consultaPorCampoCentroAdmin(col, centro, "n_ot", numero, acumulado);
      }
    }
  }

  const candidatos = [...acumulado.values()].filter((c) => servidorPuedeVerOt(c, input.profile, input.uid));
  const filtrados = avisoNumero
    ? candidatos.filter(
        (c) => coincideOtConNumeroAviso(c, avisoNumero) || avisoIds.includes(c.aviso_id?.trim() ?? ""),
      )
    : candidatos;

  return elegirMejorCandidato(filtrados.length ? filtrados : candidatos);
}
