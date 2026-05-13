import { getAdminDb } from "@/firebase/firebaseAdmin";

import { COLLECTIONS } from "@/lib/firestore/collections";

import { tienePermiso, type Rol } from "@/lib/permisos/index";

import type { WorkOrder, WorkOrderEstado } from "@/modules/work-orders/types";

import type { DocumentData } from "firebase-admin/firestore";



/** Filas serializables para el combo de agenda (sin Timestamps). */

export type WorkOrderAgendaSearchRow = Pick<

  WorkOrder,

  "id" | "n_ot" | "estado" | "codigo_activo_snapshot" | "texto_trabajo" | "ubicacion_tecnica" | "centro"

> & { aviso_numero?: string };



const NO_AGENDAR: WorkOrderEstado[] = ["CERRADA", "ANULADA", "BORRADOR"];



function esAgendable(estado: string): boolean {

  return !NO_AGENDAR.includes(estado as WorkOrderEstado);

}



function viewerVeOrden(wo: WorkOrder, viewerUid: string, viewerRol: Rol): boolean {

  const soloPropias =

    tienePermiso(viewerRol, "ot:ver_propias") && !tienePermiso(viewerRol, "ot:ver_todas");

  if (!soloPropias) return true;

  const t = wo.tecnico_asignado_uid?.trim() ?? "";

  return t === viewerUid || t === "";

}



function toRow(wo: WorkOrder): WorkOrderAgendaSearchRow {

  return {

    id: wo.id,

    n_ot: wo.n_ot,

    estado: wo.estado,

    codigo_activo_snapshot: wo.codigo_activo_snapshot,

    texto_trabajo: wo.texto_trabajo,

    ubicacion_tecnica: wo.ubicacion_tecnica,

    centro: wo.centro,

    aviso_numero: wo.aviso_numero,

  };

}



function noArchivada(wo: Pick<WorkOrder, "archivada">): boolean {

  return wo.archivada !== true;

}



function docAOrden(id: string, data: DocumentData): WorkOrder {

  return { id, ...data } as WorkOrder;

}



function coincideTextoLibre(wo: WorkOrder, lower: string): boolean {

  if (!lower) return true;

  const hay = [

    wo.n_ot,

    wo.codigo_activo_snapshot,

    wo.estado,

    wo.texto_trabajo,

    wo.aviso_numero ?? "",

    wo.id,

    wo.ubicacion_tecnica,

  ]

    .join(" ")

    .toLowerCase();

  return lower

    .split(/\s+/)

    .filter(Boolean)

    .every((t) => hay.includes(t));

}



function uniqCentros(centros: string[]): string[] {

  const seen = new Set<string>();

  for (const c of centros) {

    const t = c.trim();

    if (t) seen.add(t);

  }

  return [...seen].sort((a, b) => a.localeCompare(b));

}



/** Trocea para `where("centro","in", …)` (tope Firestore 10). */

function chunkIn<T>(items: T[], size: number): T[][] {

  const out: T[][] = [];

  for (let i = 0; i < items.length; i += size) {

    out.push(items.slice(i, i + size));

  }

  return out;

}



function ordenUpdatedDesc(a: WorkOrder, b: WorkOrder): number {

  const ta =

    a.updated_at && typeof (a.updated_at as { toMillis?: () => number }).toMillis === "function"

      ? (a.updated_at as { toMillis: () => number }).toMillis()

      : 0;

  const tb =

    b.updated_at && typeof (b.updated_at as { toMillis?: () => number }).toMillis === "function"

      ? (b.updated_at as { toMillis: () => number }).toMillis()

      : 0;

  return tb - ta;

}



/**

 * Búsqueda server-side para agendar en el programa: evita el tope ~300 del listado en cliente

 * y aplica la misma visibilidad técnico/supervisor que en listados.

 *

 * `centros`: lista deduplicada de plantas donde buscar (ya validada por permisos en la acción).

 */

export async function searchWorkOrdersForWeeklyAgendaAdmin(opts: {

  centros: string[];

  query: string;

  viewerUid: string;

  viewerRol: Rol;

}): Promise<WorkOrderAgendaSearchRow[]> {

  const { query, viewerUid, viewerRol } = opts;

  const centros = uniqCentros(opts.centros);

  const db = getAdminDb();

  const col = db.collection(COLLECTIONS.work_orders);

  const maxScanBase = 900;

  const maxOut = 60;



  if (centros.length === 0) {

    return [];

  }



  const maxScan =

    centros.length <= 1 ? maxScanBase : Math.max(150, Math.floor(maxScanBase / centros.length));



  const q = query.trim();

  const lower = q.toLowerCase();



  if (/^\d{1,12}$/.test(q)) {

    const variants = [...new Set([q, q.padStart(8, "0")])];

    const rows: WorkOrderAgendaSearchRow[] = [];

    for (const nOt of variants) {

      for (const batch of chunkIn(centros, 10)) {

        const snap = await col.where("centro", "in", batch).where("n_ot", "==", nOt).limit(20).get();

        for (const d of snap.docs) {

          const wo = docAOrden(d.id, d.data());

          if (!noArchivada(wo)) continue;

          if (!esAgendable(wo.estado)) continue;

          if (!viewerVeOrden(wo, viewerUid, viewerRol)) continue;

          rows.push(toRow(wo));

        }

      }

    }

    if (rows.length) {

      const byId = new Map(rows.map((r) => [r.id, r]));

      return [...byId.values()].slice(0, maxOut);

    }

  }



  if (q.length >= 3) {

    const rows: WorkOrderAgendaSearchRow[] = [];

    for (const batch of chunkIn(centros, 10)) {

      const snapAviso = await col

        .where("centro", "in", batch)

        .where("aviso_numero", "==", q)

        .limit(25)

        .get();

      for (const d of snapAviso.docs) {

        const wo = docAOrden(d.id, d.data());

        if (!noArchivada(wo)) continue;

        if (!esAgendable(wo.estado)) continue;

        if (!viewerVeOrden(wo, viewerUid, viewerRol)) continue;

        rows.push(toRow(wo));

      }

    }

    if (rows.length) {

      const byId = new Map(rows.map((r) => [r.id, r]));

      return [...byId.values()].slice(0, maxOut);

    }

  }



  const scans = await Promise.all(

    centros.map(async (centro) => {

      const snap = await col

        .where("centro", "==", centro)

        .orderBy("updated_at", "desc")

        .limit(maxScan)

        .get();

      const acc: WorkOrder[] = [];

      for (const d of snap.docs) {

        const wo = docAOrden(d.id, d.data());

        if (!noArchivada(wo)) continue;

        if (!esAgendable(wo.estado)) continue;

        if (!viewerVeOrden(wo, viewerUid, viewerRol)) continue;

        if (!coincideTextoLibre(wo, lower)) continue;

        acc.push(wo);

      }

      return acc;

    }),

  );



  const merged = scans.flat();

  merged.sort(ordenUpdatedDesc);

  const seen = new Set<string>();

  const accRows: WorkOrderAgendaSearchRow[] = [];

  for (const wo of merged) {

    if (seen.has(wo.id)) continue;

    seen.add(wo.id);

    accRows.push(toRow(wo));

    if (accRows.length >= maxOut) break;

  }

  return accRows;

}

