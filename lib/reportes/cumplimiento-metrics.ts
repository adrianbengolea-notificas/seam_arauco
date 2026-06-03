/**
 * Métricas de cumplimiento preventivo (certificación mensual).
 * Universo único: OT tipo PREVENTIVO con fecha_inicio_programada en el período.
 */

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
    "OT preventivas con fecha de inicio programada dentro del mes seleccionado (no incluye correctivos ni emergencias).",
  ejecutados:
    "Del mismo universo: OT CERRADA cuya fecha de cierre (fecha_fin_ejecucion) cae en el mes. Si el cierre fue manual con otra fecha, se usa esa fecha registrada en la OT.",
  pendientes: "Programados − ejecutados (mismo universo).",
  pct: "Ejecutados ÷ programados × 100.",
} as const;

/** Acepta Timestamp de Firestore Admin o serialización JSON. */
export function timestampToMillis(ts: unknown): number | null {
  if (ts == null) return null;
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
