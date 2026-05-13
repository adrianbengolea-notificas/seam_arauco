import type { WorkOrder } from "@/modules/work-orders/types";
import type { TipoAviso } from "@/modules/notices/types";

/** Acepta Timestamp de Firestore, caché JSON `{ seconds, nanoseconds }`, fechas o epoch ms. */
function firestoreLikeToMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.toMillis === "function") {
      try {
        const m = (o.toMillis as () => number)();
        if (typeof m === "number" && Number.isFinite(m)) return m;
      } catch {
        /* ignore */
      }
    }
    if (typeof o.toDate === "function") {
      try {
        const d = (o.toDate as () => Date)();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime();
      } catch {
        /* ignore */
      }
    }
    const sec =
      (typeof o.seconds === "number" ? o.seconds : undefined) ??
      (typeof o._seconds === "number" ? o._seconds : undefined);
    const nano =
      (typeof o.nanoseconds === "number" ? o.nanoseconds : undefined) ??
      (typeof o._nanoseconds === "number" ? o._nanoseconds : undefined) ??
      0;
    if (typeof sec === "number" && Number.isFinite(sec)) {
      return sec * 1000 + Math.floor(nano / 1_000_000);
    }
  }
  return null;
}

export type PreventivoBucket = { programados: number; cerradosATiempo: number };

/**
 * Cumplimiento de preventivos en una ventana (OTs filtradas por tipo_trabajo === PREVENTIVO).
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
    const finMs = firestoreLikeToMillis(fin);
    const progMs = firestoreLikeToMillis(prog);
    if (finMs == null || progMs == null) continue;
    const vencimiento = progMs + toleranciaMs;
    if (finMs <= vencimiento) {
      cerradosATiempo += 1;
    }
  }

  return { programados, cerradosATiempo };
}

export type CorrectivoPorEquipo = Record<string, number>;

/**
 * Activo sintético «Eléctrico general» (`EE-GRAL`, id `ee-gral-{centro}`): agrupa OT sin UT en catálogo.
 * No debe dominar rankings del dashboard frente a equipos reales.
 */
export function esActivoSinteticoElectricoGeneral(codigoActivo: string, assetId: string): boolean {
  if (codigoActivo.trim().toUpperCase() === "EE-GRAL") return true;
  return assetId.trim().toLowerCase().startsWith("ee-gral-");
}

export type CorrectivoEquipoFila = {
  /** Código de activo mostrado en listados (misma clave que el ranking histórico). */
  codigo: string;
  count: number;
  /** `assets/{id}` — para resolver denominación en el maestro. */
  asset_id: string;
};

/**
 * Filas de ranking por activo (correctivo + emergencia). Sin recorte: el caller hace `slice` si hace falta.
 */
export function correctivosPorEquipoFilas(
  rows: WorkOrder[],
  opts?: { tipos?: TipoAviso[] },
): CorrectivoEquipoFila[] {
  const tipos = new Set(opts?.tipos ?? ["CORRECTIVO", "EMERGENCIA"]);
  const acc = new Map<string, { count: number; asset_id: string }>();
  for (const r of rows) {
    if (!tipos.has(r.tipo_trabajo)) continue;
    if (esActivoSinteticoElectricoGeneral(r.codigo_activo_snapshot ?? "", r.asset_id)) continue;
    const key = (r.codigo_activo_snapshot || r.asset_id || "").trim() || "—";
    const cur = acc.get(key);
    if (cur) {
      cur.count += 1;
    } else {
      acc.set(key, { count: 1, asset_id: r.asset_id });
    }
  }
  return [...acc.entries()]
    .map(([codigo, v]) => ({ codigo, count: v.count, asset_id: v.asset_id }))
    .sort((a, b) => b.count - a.count);
}

export function correctivosPorEquipo(
  rows: WorkOrder[],
  opts?: { tipos?: TipoAviso[] },
): CorrectivoPorEquipo {
  const map: CorrectivoPorEquipo = {};
  for (const f of correctivosPorEquipoFilas(rows, opts)) {
    map[f.codigo] = f.count;
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
    if (esActivoSinteticoElectricoGeneral(r.codigo_activo_snapshot ?? "", r.asset_id)) continue;
    const t = firestoreLikeToMillis(r.created_at) ?? 0;
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
