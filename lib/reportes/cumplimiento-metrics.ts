/**
 * Métricas de cumplimiento preventivo (certificación mensual).
 * Operativo: preventivos CERRADOS en el mes (fecha_fin_ejecucion).
 * Legacy KPI: OT programadas en el mes que no estaban ya cerradas en meses anteriores.
 */

import { mesCalendarioArgentina } from "@/lib/reportes/periodo-reporte";

export type DisciplinaLabel = "AA" | "ELECTRICO" | "GG";

export type SitioLabel =
  | "Esperanza"
  | "Bossetti"
  | "Yporá"
  | "Piray"
  | "Garita"
  | "Otro";

export const SITIOS_REPORTE: SitioLabel[] = [
  "Esperanza",
  "Bossetti",
  "Yporá",
  "Piray",
  "Garita",
  "Otro",
];

export type SitioMetrica = {
  sitio: SitioLabel;
  planificadas: number;
  ejecutadas: number;
  pendientes: number;
  pct: number;
};

export type DisciplinaMetrica = {
  planificadas: number;
  ejecutadas: number;
  pendientes: number;
  pct: number;
  por_sitio: SitioMetrica[];
};

export type TotalesPreventivo = {
  preventivos_planificados: number;
  preventivos_ejecutados: number;
  preventivos_pendientes: number;
  /** ejecutados / programados (0–1) */
  pct_general: number;
  /** AA×50% + Eléctrico×40% + GG×10% — índice contractual, no KPI operativo */
  pct_certificacion: number;
};

export const META_CRITERIOS_REPORTE = {
  programados:
    "OT preventivas con fecha de inicio programada en el mes, excluidas las ya cerradas en meses anteriores.",
  ejecutados:
    "Del mismo universo: OT CERRADA cuya fecha de cierre (fecha_fin_ejecucion) cae en el mes. Si el cierre fue manual con otra fecha, se usa esa fecha registrada en la OT.",
  pendientes: "Programados − ejecutados (mismo universo).",
  pct: "Ejecutados ÷ programados × 100.",
} as const;

/** Acepta Timestamp de Firestore Admin o serialización JSON. */
export function timestampToMillis(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (typeof ts === "object") {
    const o = ts as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof o.toMillis === "function") {
      try {
        const m = o.toMillis();
        if (typeof m === "number" && Number.isFinite(m)) return m;
      } catch {
        /* ignore */
      }
    }
    const sec = typeof o.seconds === "number" ? o.seconds : o._seconds;
    if (typeof sec === "number" && Number.isFinite(sec)) return sec * 1000;
  }
  return null;
}

/**
 * OT ya cerrada en un mes anterior al reporte (p. ej. ejecutada en abril pero reprogramada
 * en junio por el motor de programa). No debe figurar en el mes posterior.
 */
export function otCerradaAntesDelMesReporte(
  estado: unknown,
  fechaFinEjecucion: unknown,
  añoReporte: number,
  mesReporte: number,
): boolean {
  if (estado !== "CERRADA") return false;
  const finMs = timestampToMillis(fechaFinEjecucion);
  if (finMs == null) return false;
  const cal = mesCalendarioArgentina(finMs);
  if (cal.año < añoReporte) return true;
  if (cal.año === añoReporte && cal.mes < mesReporte) return true;
  return false;
}

/** Cierre en [inicioMs, finMs) — fin exclusivo, mismo criterio que el rango del mes. */
export function fechaCierreEnPeriodo(
  fechaFinEjecucion: unknown,
  inicioMs: number,
  finMs: number,
): boolean {
  const ms = timestampToMillis(fechaFinEjecucion);
  if (ms == null) return false;
  return ms >= inicioMs && ms < finMs;
}

/**
 * OT cerrada en el período: estado CERRADA y fecha_fin_ejecucion dentro del mes.
 * La fecha de cierre manual queda guardada en fecha_fin_ejecucion al cerrar o corregir la OT.
 */
export function esOtCerradaEnPeriodo(
  estado: unknown,
  fechaFinEjecucion: unknown,
  inicioMs: number,
  finMs: number,
): boolean {
  if (estado !== "CERRADA") return false;
  return fechaCierreEnPeriodo(fechaFinEjecucion, inicioMs, finMs);
}

/** @deprecated Alias semántico — misma regla que correctivos realizados */
export const esPreventivoEjecutadoEnPeriodo = esOtCerradaEnPeriodo;

export const META_CORRECTIVOS_REPORTE = {
  realizados:
    "OT correctiva/emergencia CERRADA con fecha_fin_ejecucion en el mes (incluye cierre manual con fecha distinta).",
  pendientes:
    "OT correctiva creada en el mes que aún no tiene cierre con fecha_fin dentro del mismo mes.",
  total: "Realizados (cierre en el mes) + pendientes (creadas en el mes sin ese cierre).",
  por_especialidad: "Distribución de correctivos realizados (cerrados en el mes).",
} as const;

// ─── Tipos del reporte de cumplimiento (compartidos cliente/servidor) ────────
// Viven acá (y no en la server action) porque un archivo "use server" solo
// puede exportar funciones async: re-exportar tipos/constantes desde la action
// rompía la evaluación del módulo en producción.

export type CorrectivoFila = {
  n_ot: string;
  aviso_numero: string;
  descripcion: string;
  especialidad: string;
  ubicacion: string;
  sitio: SitioLabel;
  planificado: boolean;
  ejecutado: boolean;
  fecha: string | null;
};

export type OTFilaDetalle = {
  n_ot: string;
  aviso_numero: string;
  descripcion: string;
  especialidad: DisciplinaLabel | string;
  frecuencia: string;
  ubicacion: string;
  sitio: SitioLabel;
  estado: string;
  tipo: "preventivo" | "correctivo";
  planificada: boolean;
  ejecutada: boolean;
  fecha_ejecucion: string | null;
  fecha_creacion: string;
};

export type CorrectivosPorEspecialidad = {
  AA: number;
  ELECTRICO: number;
  GG: number;
  otro: number;
};

export type CentroResumen = {
  centro: string;
  disciplinas: Record<DisciplinaLabel, DisciplinaMetrica>;
  correctivos: ReporteCumplimientoData["correctivos"];
  totales: ReporteCumplimientoData["totales"];
  operativo: ReporteCumplimientoData["operativo"];
  certificacion: ReporteCumplimientoData["certificacion"];
};

export type OperativoReporte = {
  ejecutados_por_especialidad: Record<DisciplinaLabel, number>;
  total_ejecutados: number;
  descripcion: string;
};

export type CertificacionReporte = {
  configurada: boolean;
  fuente: "firestore" | "default" | null;
  año: number;
  indice: number;
  pesos: Record<DisciplinaLabel, number>;
  por_especialidad: Record<
    DisciplinaLabel,
    import("@/lib/reportes/certificacion-objetivos").CertificacionDisciplinaResult
  >;
  notas?: string;
};

export type ReporteCumplimientoData = {
  periodo: { mes: number; año: number; label: string };
  centro: string;
  meta: typeof META_CRITERIOS_REPORTE;
  meta_correctivos: typeof META_CORRECTIVOS_REPORTE;
  disciplinas: Record<DisciplinaLabel, DisciplinaMetrica>;
  correctivos: {
    planificados: number;
    no_planificados: number;
    total: number;
    realizados: number;
    pendientes: number;
    /** Legacy: cerrados / total — no es KPI de certificación preventiva */
    pct_cumplimiento: number;
    por_especialidad: CorrectivosPorEspecialidad;
    detalle: CorrectivoFila[];
  };
  ots_detalle: OTFilaDetalle[];
  totales: {
    preventivos_planificados: number;
    preventivos_ejecutados: number;
    preventivos_pendientes: number;
    pct_general: number;
    pct_certificacion: number;
  };
  /** Contadores operativos: preventivos cerrados en el mes por especialidad. */
  operativo: OperativoReporte;
  /** Certificación contractual vs metas por especialidad (si hay metas para el año). */
  certificacion: CertificacionReporte;
  por_centro?: CentroResumen[];
};

export function sitioDesdeUt(ut: string | undefined): SitioLabel {
  if (!ut) return "Otro";
  const prefix = ut.split("-")[0]?.toUpperCase() ?? "";
  if (prefix === "ESPE" || prefix === "ESP") return "Esperanza";
  if (prefix === "BOSS" || prefix === "BOS") return "Bossetti";
  if (prefix === "YPOR" || prefix === "YPO") return "Yporá";
  if (prefix === "PIRA" || prefix === "PIR") return "Piray";
  if (prefix === "GARI" || prefix === "GAR") return "Garita";
  return "Otro";
}

export function normalizarEsp(esp: string): DisciplinaLabel | string {
  const u = esp?.toUpperCase() ?? "";
  if (u === "AA") return "AA";
  if (u === "ELECTRICO" || u === "ELÉCTRICO" || u === "HG") return "ELECTRICO";
  if (u === "GG" || u === "GENERADOR") return "GG";
  return esp;
}

export function esDisciplina(esp: string): esp is DisciplinaLabel {
  return esp === "AA" || esp === "ELECTRICO" || esp === "GG";
}

export function emptyDisciplina(): DisciplinaMetrica {
  return {
    planificadas: 0,
    ejecutadas: 0,
    pendientes: 0,
    pct: 0,
    por_sitio: SITIOS_REPORTE.map((s) => ({
      sitio: s,
      planificadas: 0,
      ejecutadas: 0,
      pendientes: 0,
      pct: 0,
    })),
  };
}

export function emptyDiscMap(): Record<DisciplinaLabel, DisciplinaMetrica> {
  return {
    AA: emptyDisciplina(),
    ELECTRICO: emptyDisciplina(),
    GG: emptyDisciplina(),
  };
}

function ratioPct(ejecutadas: number, planificadas: number): number {
  if (planificadas <= 0) return 0;
  return Math.round((ejecutadas / planificadas) * 100) / 100;
}

export function finalizarDisciplina(disc: DisciplinaMetrica): void {
  disc.pendientes = Math.max(0, disc.planificadas - disc.ejecutadas);
  disc.pct = ratioPct(disc.ejecutadas, disc.planificadas);
  for (const sp of disc.por_sitio) {
    sp.pendientes = Math.max(0, sp.planificadas - sp.ejecutadas);
    sp.pct = ratioPct(sp.ejecutadas, sp.planificadas);
  }
}

export function finalizarDiscMap(discMap: Record<DisciplinaLabel, DisciplinaMetrica>): void {
  for (const disc of Object.values(discMap)) {
    finalizarDisciplina(disc);
  }
}

export function calcularTotalesPreventivo(
  discMap: Record<DisciplinaLabel, DisciplinaMetrica>,
): TotalesPreventivo {
  const totalPlan =
    discMap.AA.planificadas + discMap.ELECTRICO.planificadas + discMap.GG.planificadas;
  const totalEjec =
    discMap.AA.ejecutadas + discMap.ELECTRICO.ejecutadas + discMap.GG.ejecutadas;
  const pctAA =
    discMap.AA.planificadas > 0 ? discMap.AA.ejecutadas / discMap.AA.planificadas : 0;
  const pctElec =
    discMap.ELECTRICO.planificadas > 0
      ? discMap.ELECTRICO.ejecutadas / discMap.ELECTRICO.planificadas
      : 0;
  const pctGG =
    discMap.GG.planificadas > 0 ? discMap.GG.ejecutadas / discMap.GG.planificadas : 0;
  return {
    preventivos_planificados: totalPlan,
    preventivos_ejecutados: totalEjec,
    preventivos_pendientes: Math.max(0, totalPlan - totalEjec),
    pct_general: ratioPct(totalEjec, totalPlan),
    pct_certificacion: Math.round((pctAA * 0.5 + pctElec * 0.4 + pctGG * 0.1) * 10000) / 10000,
  };
}

export function mergeDiscMap(
  base: Record<DisciplinaLabel, DisciplinaMetrica>,
  other: Record<DisciplinaLabel, DisciplinaMetrica>,
): Record<DisciplinaLabel, DisciplinaMetrica> {
  const discs: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];
  for (const disc of discs) {
    base[disc].planificadas += other[disc].planificadas;
    base[disc].ejecutadas += other[disc].ejecutadas;
    for (const sp of base[disc].por_sitio) {
      const otherSp = other[disc].por_sitio.find((s) => s.sitio === sp.sitio);
      if (otherSp) {
        sp.planificadas += otherSp.planificadas;
        sp.ejecutadas += otherSp.ejecutadas;
      }
    }
  }
  finalizarDiscMap(base);
  return base;
}

export function formulaPctText(ejecutadas: number, planificadas: number): string {
  if (planificadas <= 0) return "—";
  const pct = Math.round((ejecutadas / planificadas) * 1000) / 10;
  return `${ejecutadas} / ${planificadas} = ${pct}%`;
}
