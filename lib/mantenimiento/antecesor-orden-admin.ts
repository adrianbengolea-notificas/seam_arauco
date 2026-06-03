import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import { clearOrdenPreviaPendienteEnProgramaSemanaAdmin } from "@/modules/scheduling/repository";
import { AVISOS_COLLECTION, getAvisoById } from "@/modules/notices/repository";
import type { Aviso } from "@/modules/notices/types";
import { appendHistorialAdmin } from "@/modules/work-orders/repository";
import type { WorkOrder } from "@/modules/work-orders/types";
import { FieldValue, Timestamp as AdminTimestamp } from "firebase-admin/firestore";

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
      if (wo.archivada === true) continue;
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
          const wo = wsn.data() as { estado?: WorkOrder["estado"]; archivada?: boolean };
          if (wo.archivada === true) return null;
          const st = wo.estado;
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

async function quitarOrdenPreviaPendienteEnProgramaPorAviso(aviso: Pick<Aviso, "id" | "n_aviso" | "centro" | "incluido_en_semana">): Promise<void> {
  const sem = aviso.incluido_en_semana?.trim();
  const centro = aviso.centro?.trim();
  if (!sem || !centro) return;
  await clearOrdenPreviaPendienteEnProgramaSemanaAdmin({
    programaDocId: propuestaSemanaDocId(centro, sem),
    avisoFirestoreId: aviso.id,
    avisoNumero: aviso.n_aviso,
  });
}

function fechaFinDesdeWorkOrder(wo: WorkOrder): Date | undefined {
  const fp = wo.fecha_fin_ejecucion;
  if (fp != null && typeof (fp as { toDate?: () => Date }).toDate === "function") {
    const d = (fp as { toDate: () => Date }).toDate();
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

async function cerrarOrdenAntecesoraSupersedida(input: {
  antecesorWorkOrderId: string;
  ordenSucesoraId: string;
  ordenSucesoraNOt: string;
  ordenSucesoraNAviso?: string;
  fechaEjecucion?: Date;
  actorUid?: string;
}): Promise<string | undefined> {
  const antWoId = input.antecesorWorkOrderId.trim();
  if (!antWoId) return undefined;

  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.work_orders).doc(antWoId);
  const snap = await ref.get();
  if (!snap.exists) return undefined;

  const wo = { id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) } as WorkOrder;
  if (wo.archivada === true) return undefined;

  const reemplazada = {
    work_order_id: input.ordenSucesoraId.trim(),
    n_ot: input.ordenSucesoraNOt.trim() || input.ordenSucesoraId.trim(),
    ...(input.ordenSucesoraNAviso?.trim() ? { n_aviso: input.ordenSucesoraNAviso.trim() } : {}),
  };

  const nSucesora = reemplazada.n_ot;
  const motivo = `Cerrada automáticamente: el mantenimiento se completó en la orden n.º ${nSucesora}${
    reemplazada.n_aviso ? ` (aviso SAP ${reemplazada.n_aviso})` : ""
  }.`;

  if (wo.estado !== "CERRADA" && wo.estado !== "ANULADA") {
    const fe =
      input.fechaEjecucion ??
      fechaFinDesdeWorkOrder(wo) ??
      new Date();
    await ref.set(
      {
        estado: "CERRADA",
        fecha_fin_ejecucion: AdminTimestamp.fromDate(fe),
        reemplazada_por_ot_cerrada: reemplazada,
        alerta_cerrar_para_aviso_sap: FieldValue.delete(),
        cierre_modo: "supersedida_por_ot_sucesora",
        cierre_motivo: motivo,
        updated_at: FieldValue.serverTimestamp(),
      } as Record<string, unknown>,
      { merge: true },
    );

    await appendHistorialAdmin(antWoId, {
      tipo: "CIERRE",
      actor_uid: input.actorUid?.trim() || "sistema",
      payload: {
        modo: "supersedida_por_ot_sucesora",
        ordenSucesoraId: input.ordenSucesoraId.trim(),
        ordenSucesoraNOt: nSucesora,
        ...(reemplazada.n_aviso ? { ordenSucesoraNAviso: reemplazada.n_aviso } : {}),
        motivo,
      },
    });
  } else {
    await ref.set(
      {
        reemplazada_por_ot_cerrada: reemplazada,
        alerta_cerrar_para_aviso_sap: FieldValue.delete(),
        updated_at: FieldValue.serverTimestamp(),
      } as Record<string, unknown>,
      { merge: true },
    );
  }

  const aid = (wo.aviso_id ?? "").trim();
  if (aid) {
    const av = await getAvisoById(aid);
    if (av?.work_order_id?.trim() === antWoId) {
      await db
        .collection(AVISOS_COLLECTION)
        .doc(aid)
        .set(
          {
            work_order_id: FieldValue.delete(),
            updated_at: FieldValue.serverTimestamp(),
          } as Record<string, unknown>,
          { merge: true },
        );
    }
  }

  await limpiarAntecesorAlCerrarOrden(antWoId);
  return aid || undefined;
}

/**
 * Al cerrar la OT del aviso nuevo: cierra la orden anterior, limpia antecesor en aviso/programa
 * (invocar antes de borrar `antecesor_orden_abierta` del aviso del número nuevo).
 */
export async function registrarAntecesorSupersedidoAlCerrarOrdenSucesora(input: {
  ordenCerradaId: string;
  ordenCerradaNOt: string;
  avisoId: string;
  ordenCerradaNAviso?: string;
  fechaEjecucion?: Date;
  actorUid?: string;
}): Promise<string | undefined> {
  const avisoId = input.avisoId.trim();
  const ordenCerradaId = input.ordenCerradaId.trim();
  if (!avisoId || !ordenCerradaId) return undefined;

  const aviso = await getAvisoById(avisoId);
  if (!aviso) return undefined;

  const antWoId = aviso.antecesor_orden_abierta?.work_order_id?.trim();
  let antAvisoId: string | undefined;
  if (antWoId) {
    antAvisoId = await cerrarOrdenAntecesoraSupersedida({
      antecesorWorkOrderId: antWoId,
      ordenSucesoraId: ordenCerradaId,
      ordenSucesoraNOt: input.ordenCerradaNOt,
      ordenSucesoraNAviso: input.ordenCerradaNAviso,
      fechaEjecucion: input.fechaEjecucion,
      actorUid: input.actorUid,
    });
  }

  await quitarOrdenPreviaPendienteEnProgramaPorAviso({
    id: aviso.id,
    n_aviso: aviso.n_aviso ?? aviso.id,
    centro: aviso.centro ?? "",
    incluido_en_semana: aviso.incluido_en_semana,
  });

  return antAvisoId;
}

/** Al cerrar o archivar una orden, quita el bloqueo en avisos más nuevos que apuntaban a esa orden. */
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

    for (const d of snap.docs) {
      const data = d.data() as Aviso;
      await quitarOrdenPreviaPendienteEnProgramaPorAviso({
        id: d.id,
        n_aviso: data.n_aviso ?? d.id,
        centro: data.centro ?? "",
        incluido_en_semana: data.incluido_en_semana,
      });
    }
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

const WO_ANTECESOR_YA_RESUELTO: WorkOrder["estado"][] = ["CERRADA", "ANULADA"];

/**
 * Repara avisos que siguen apuntando a una OT antecesora ya cerrada/anulada/archivada
 * (p. ej. cierre fuera del flujo normal que no invocó `limpiarAntecesorAlCerrarOrden`).
 */
export async function reconcileAntecesoresObsoletosAdmin(opts?: {
  centro?: string;
  /** Si se indica, solo revisa avisos cuyo antecesor es esta OT o esta OT como cerrada. */
  workOrderId?: string;
  /** Si se indica, solo revisa este aviso (nuevo SAP) y su antecesor. */
  avisoId?: string;
  dryRun?: boolean;
}): Promise<{ ordenesProcesadas: number; avisosAfectados: number }> {
  const db = getAdminDb();
  const centro = opts?.centro?.trim();
  const dryRun = opts?.dryRun === true;
  const woIds = new Set<string>();

  if (opts?.workOrderId?.trim()) {
    woIds.add(opts.workOrderId.trim());
  }

  if (opts?.avisoId?.trim()) {
    const av = await getAvisoById(opts.avisoId.trim());
    const antWo = av?.antecesor_orden_abierta?.work_order_id?.trim();
    if (antWo) woIds.add(antWo);
  }

  if (!woIds.size) {
    let q = db.collection(COLLECTIONS.work_orders).where("estado", "in", WO_ANTECESOR_YA_RESUELTO);
    if (centro) q = q.where("centro", "==", centro);
    const snap = await q.limit(4000).get();
    for (const d of snap.docs) {
      const wo = d.data() as { archivada?: boolean };
      if (wo.archivada === true) continue;
      woIds.add(d.id);
    }
  }

  let avisosAfectados = 0;
  for (const woId of woIds) {
    const antes = await db
      .collection(AVISOS_COLLECTION)
      .where("antecesor_orden_abierta.work_order_id", "==", woId)
      .limit(80)
      .get();
    avisosAfectados += antes.size;
    if (!dryRun && antes.size > 0) {
      await limpiarAntecesorAlCerrarOrden(woId);
    }
  }

  return { ordenesProcesadas: woIds.size, avisosAfectados };
}
