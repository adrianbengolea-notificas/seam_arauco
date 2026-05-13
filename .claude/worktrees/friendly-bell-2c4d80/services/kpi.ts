import type { WorkOrder } from "@/modules/work-orders/types";
import type { TipoAviso } from "@/modules/notices/types";

export type PreventivoBucket = { programados: number; cerradosATiempo: number };

/**
 * Cumplimiento de preventivos en una ventana (OT filtradas por tipo_trabajo === PREVENTIVO).
 * `cerradosATiempo` requiere `fecha_fin_ejecucion` y `fecha_inicio_programada` en los datos.
 */
export function cumplimientoPreventivos(rows: WorkOrder[]): PreventivoBucket {
  const preventivos = rows.filter((r) => r.tipo_trabajo === "PREVENTIVO");
  const programados = preventivos.length;
  let cerradosATiempo = 0;

  const toleranciaMs = 7 * 86400000;
  for (const r of preventivos) {
    if (r.estado !== "CERRADA") continue;
    const fin = r.fecha_fin_ejecucion;
    const prog = r.fecha_inicio_programada;
    if (!fin || !prog) continue;
    const finMs = fin.toMillis();
    const progMs = prog.toMillis();
    const vencimiento = progMs + toleranciaMs;
    if (finMs <= vencimiento) {
      cerradosATiempo += 1;
    }
  }

  return { programados, cerradosATiempo };
}

export type CorrectivoPorEquipo = Record<string, number>;

export function correctivosPorEquipo(
  rows: WorkOrder[],
  opts?: { tipos?: TipoAviso[] },
): CorrectivoPorEquipo {
  const tipos = new Set(opts?.tipos ?? ["CORRECTIVO", "EMERGENCIA"]);
  const map: CorrectivoPorEquipo = {};
  for (const r of rows) {
    if (!tipos.has(r.tipo_trabajo)) continue;
    const key = r.codigo_activo_snapshot || r.asset_id;
    map[key] = (map[key] ?? 0) + 1;
  }
  return map;
}

export type Reincidencia = {
  asset_id: string;
  codigo_activo_snapshot: string;
  eventos: number;
  ventana_dias: number;
};

/**
 * Heurística simple: N correctivos en ventana deslizante por activo.
 */
export function detectarReincidencias(
  rows: WorkOrder[],
  opts: { ventanaDias: number; umbral: number; ahoraMs?: number },
): Reincidencia[] {
  const ahora = opts.ahoraMs ?? Date.now();
  const desde = ahora - opts.ventanaDias * 86400000;
  const byAsset = new Map<string, WorkOrder[]>();

  for (const r of rows) {
    if (r.tipo_trabajo !== "CORRECTIVO" && r.tipo_trabajo !== "EMERGENCIA") continue;
    const t = r.created_at?.toMillis?.() ?? 0;
    if (t < desde) continue;
    const list = byAsset.get(r.asset_id) ?? [];
    list.push(r);
    byAsset.set(r.asset_id, list);
  }

  const out: Reincidencia[] = [];
  for (const [asset_id, list] of byAsset) {
    if (list.length < opts.umbral) continue;
    const first = list[0]!;
    out.push({
      asset_id,
      codigo_activo_snapshot: first.codigo_activo_snapshot,
      eventos: list.length,
      ventana_dias: opts.ventanaDias,
    });
  }
  return out.sort((a, b) => b.eventos - a.eventos);
}
