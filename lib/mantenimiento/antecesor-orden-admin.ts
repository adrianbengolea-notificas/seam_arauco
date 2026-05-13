import { getAdminDb } from "@/firebase/firebaseAdmin";
import { AVISOS_COLLECTION } from "@/modules/notices/repository";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Aviso } from "@/modules/notices/types";
import type { WorkOrder } from "@/modules/work-orders/types";
import { FieldValue } from "firebase-admin/firestore";

const WO_ABIERTA: WorkOrder["estado"][] = [
  "BORRADOR",
  "ABIERTA",
  "EN_EJECUCION",
  "PENDIENTE_FIRMA_SOLICITANTE",
  "LISTA_PARA_CIERRE",
];

function woEstaPendienteCierre(estado: WorkOrder["estado"]): boolean {
  return WO_ABIERTA.includes(estado);
}

type Candidato = {
  work_order_id: string;
  n_ot: string;
  aviso_id: string;
  n_aviso: string;
  created_ms: number;
};

async function buscarCandidatosPorClaveEnWorkOrders(
  clave: string,
  excluirAvisoId: string,
): Promise<Candidato[]> {
  const db = getAdminDb();
  const snap = await db
    .collection(COLLECTIONS.work_orders)
    .where("clave_mantenimiento", "==", clave)
    .limit(40)
    .get();

  const out: Candidato[] = [];
  for (const d of snap.docs) {
    const wo = { id: d.id, ...(d.data() as Omit<WorkOrder, "id">) } as WorkOrder;
    if (wo.archivada === true) continue;
    if (!woEstaPendienteCierre(wo.estado)) continue;
    const aid = (wo.aviso_id ?? "").trim();
    if (!aid || aid === excluirAvisoId) continue;
    const created = wo.created_at;
    const createdMs =
      created && typeof (created as { toMillis?: () => number }).toMillis === "function"
        ? (created as { toMillis: () => number }).toMillis()
        : 0;
    out.push({
      work_order_id: wo.id,
      n_ot: wo.n_ot,
      aviso_id: aid,
      n_aviso: (wo.aviso_numero ?? "").trim() || aid,
      created_ms: createdMs,
    });
  }
  return out;
}

async function buscarCandidatosPorClaveEnAvisos(
  clave: string,
  excluirAvisoId: string,
): Promise<Candidato[]> {
  const db = getAdminDb();
  const snap = await db
    .collection(AVISOS_COLLECTION)
    .where("clave_mantenimiento", "==", clave)
    .limit(60)
    .get();

  const woids: string[] = [];
  const avisoMeta = new Map<string, { n_aviso: string }>();
  for (const d of snap.docs) {
    if (d.id === excluirAvisoId) continue;
    const a = d.data() as Aviso;
    const woid = (a.work_order_id ?? "").trim();
    if (!woid) continue;
    woids.push(woid);
    avisoMeta.set(woid, { n_aviso: a.n_aviso ?? d.id });
  }
  if (!woids.length) return [];

  const db2 = getAdminDb();
  const out: Candidato[] = [];
  const chunk = 10;
  for (let i = 0; i < woids.length; i += chunk) {
    const part = woids.slice(i, i + chunk);
    const snaps = await db2.getAll(...part.map((id) => db2.collection(COLLECTIONS.work_orders).doc(id)));
    for (const s of snaps) {
      if (!s.exists) continue;
      const wo = { id: s.id, ...(s.data() as Omit<WorkOrder, "id">) } as WorkOrder;
      if (!woEstaPendienteCierre(wo.estado)) continue;
      const aid = (wo.aviso_id ?? "").trim();
      if (!aid || aid === excluirAvisoId) continue;
      const meta = avisoMeta.get(wo.id);
      const created = wo.created_at;
      const createdMs =
        created && typeof (created as { toMillis?: () => number }).toMillis === "function"
          ? (created as { toMillis: () => number }).toMillis()
          : 0;
      out.push({
        work_order_id: wo.id,
        n_ot: wo.n_ot,
        aviso_id: aid,
        n_aviso: (meta?.n_aviso ?? (wo.aviso_numero ?? "").trim()) || aid,
        created_ms: createdMs,
      });
    }
  }
  return out;
}

function elegirMasAntiguo(cands: Candidato[]): Candidato | null {
  if (!cands.length) return null;
  return cands.reduce((a, b) => (a.created_ms <= b.created_ms ? a : b));
}

/**
 * Tras importar avisos preventivos con `clave_mantenimiento`, marca en el documento nuevo si hay
 * otra OT del mismo mantenimiento aún abierta (número de aviso SAP distinto).
 */
export async function reconcileAntecesorTrasImportar(input: {
  avisoIds: string[];
  clavePorAvisoId: Map<string, string>;
}): Promise<void> {
  const db = getAdminDb();
  const col = db.collection(AVISOS_COLLECTION);

  for (const avisoId of input.avisoIds) {
    const clave = input.clavePorAvisoId.get(avisoId);
    if (!clave) continue;

    const snap = await col.doc(avisoId).get();
    if (!snap.exists) continue;
    const tipo = (snap.data()?.tipo as string | undefined) ?? "";
    if (tipo !== "PREVENTIVO") continue;

    const desdeWo = await buscarCandidatosPorClaveEnWorkOrders(clave, avisoId);
    const desdeAv = await buscarCandidatosPorClaveEnAvisos(clave, avisoId);
    const porWo = new Map<string, Candidato>();
    for (const c of [...desdeWo, ...desdeAv]) {
      const prev = porWo.get(c.work_order_id);
      if (!prev || c.created_ms < prev.created_ms) porWo.set(c.work_order_id, c);
    }
    const elegido = elegirMasAntiguo([...porWo.values()]);

    const nNuevo = String(snap.data()?.n_aviso ?? "").trim() || avisoId;

    const elegidoVivo = elegido
      ? await (async () => {
          const wsn = await db.collection(COLLECTIONS.work_orders).doc(elegido.work_order_id).get();
          if (!wsn.exists) return null;
          const st = (wsn.data() as { estado?: WorkOrder["estado"] }).estado;
          return st && woEstaPendienteCierre(st) ? elegido : null;
        })()
      : null;

    if (!elegidoVivo) {
      await col.doc(avisoId).set(
        {
          antecesor_orden_abierta: FieldValue.delete(),
          updated_at: FieldValue.serverTimestamp(),
        } as Record<string, unknown>,
        { merge: true },
      );
      const staleWo = await db
        .collection(COLLECTIONS.work_orders)
        .where("alerta_cerrar_para_aviso_sap.aviso_id", "==", avisoId)
        .limit(5)
        .get();
      for (const w of staleWo.docs) {
        await w.ref.set(
          {
            alerta_cerrar_para_aviso_sap: FieldValue.delete(),
            updated_at: FieldValue.serverTimestamp(),
          } as Record<string, unknown>,
          { merge: true },
        );
      }
      continue;
    }

    await col.doc(avisoId).set(
      {
        antecesor_orden_abierta: {
          aviso_id: elegidoVivo.aviso_id,
          n_aviso: elegidoVivo.n_aviso,
          work_order_id: elegidoVivo.work_order_id,
          n_ot: elegidoVivo.n_ot,
        },
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await db
      .collection(COLLECTIONS.work_orders)
      .doc(elegidoVivo.work_order_id)
      .set(
        {
          alerta_cerrar_para_aviso_sap: { aviso_id: avisoId, n_aviso: nNuevo },
          updated_at: FieldValue.serverTimestamp(),
        } as Record<string, unknown>,
        { merge: true },
      );
  }
}

/** Al cerrar una orden, quita el bloqueo en avisos más nuevos que apuntaban a esa orden. */
export async function limpiarAntecesorAlCerrarOrden(workOrderId: string): Promise<void> {
  const db = getAdminDb();
  const snap = await db
    .collection(AVISOS_COLLECTION)
    .where("antecesor_orden_abierta.work_order_id", "==", workOrderId)
    .limit(80)
    .get();

  if (!snap.empty) {
    let batch = db.batch();
    let n = 0;
    const commitIfNeeded = async () => {
      if (n >= 450) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    };

    for (const d of snap.docs) {
      batch.set(
        d.ref,
        {
          antecesor_orden_abierta: FieldValue.delete(),
          updated_at: FieldValue.serverTimestamp(),
        } as Record<string, unknown>,
        { merge: true },
      );
      n++;
      await commitIfNeeded();
    }
    if (n > 0) await batch.commit();
  }

  await db
    .collection(COLLECTIONS.work_orders)
    .doc(workOrderId)
    .set(
      {
        alerta_cerrar_para_aviso_sap: FieldValue.delete(),
        updated_at: FieldValue.serverTimestamp(),
      } as Record<string, unknown>,
      { merge: true },
    );
}
