/**
 * Metas y cálculo de certificación contractual (Excel Arauco / certificación mensual).
 * Objetivos por especialidad (sin desglose por sitio).
 */

import type { DisciplinaLabel } from "@/lib/reportes/cumplimiento-metrics";
import {
  inicioSemestreArgentinaMs,
  inicioTrimestreArgentinaMs,
} from "@/lib/reportes/periodo-reporte";

export type TierFrecuencia = "M" | "T" | "S" | "A";

export type ObjetivoEspecialidad = {
  mensual: number;
  trimestral: number;
  semestral: number;
  anual: number;
};

/** Pesos del contrato (Certificación Mayo 26 — filas 4–6). */
export const PESOS_CERTIFICACION_CONTRATO: Record<DisciplinaLabel, number> = {
  AA: 0.5,
  ELECTRICO: 0.4,
  GG: 0.1,
};

/**
 * Objetivos totales por especialidad extraídos del Excel «Certificación Mayo 26»
 * (tablas OBJETIVO filas 37 y 89; GG fila 133).
 */
export const METAS_CERTIFICACION_2026_DEFAULT = {
  año: 2026,
  pesos: PESOS_CERTIFICACION_CONTRATO,
  disciplinas: {
    AA: { mensual: 36, trimestral: 11, semestral: 63, anual: 122 },
    ELECTRICO: { mensual: 46, trimestral: 2, semestral: 6, anual: 119 },
    GG: { mensual: 2.33, trimestral: 1, semestral: 7, anual: 14 },
  },
  notas:
    "Objetivos totales por especialidad (sin sitio). Fuente: certificación Arauco Mayo 2026.",
} as const satisfies MetasCertificacion;

export type MetasCertificacion = {
  año: number;
  pesos: Record<DisciplinaLabel, number>;
  disciplinas: Record<DisciplinaLabel, ObjetivoEspecialidad>;
  notas?: string;
};

export type EjecutadosCertificacion = {
  /** Cierres en el mes, por badge M/T/S/A */
  mes: Record<TierFrecuencia, number>;
  /** Cierres T desde inicio de trimestre hasta fin de mes */
  acumTrim: number;
  acumSem: number;
  acumAnual: number;
  /** Total cerrados en el mes (cualquier frecuencia) */
  totalMes: number;
};

export type CertificacionDisciplinaResult = {
  ejecutados: EjecutadosCertificacion;
  planes: {
    mensual: number;
    trimAcum: number;
    semAcum: number;
    anualAcum: number;
  };
  pct_mensual: number;
  pct_trimestral: number;
  pct_semestral: number;
  pct_anual: number;
  /** Promedio de los 4 niveles (fórmula Excel). */
  pct_especialidad: number;
};

export const META_OPERATIVO =
  "Preventivos cerrados en el mes (fecha_fin_ejecucion), por especialidad. Sin comparación contra OT programadas.";

export const META_CERTIFICACION =
  "Índice contractual: promedio (mensual + trimestral + semestral + anual) por especialidad, ponderado AA×50% + Eléctrico×40% + GG×10%.";

const FREC_MAP: Record<string, TierFrecuencia> = {
  MENSUAL: "M",
  TRIMESTRAL: "T",
  SEMESTRAL: "S",
  ANUAL: "A",
  M: "M",
  T: "T",
  S: "S",
  A: "A",
  "1": "M",
  "2": "T",
  "3": "S",
  "4": "A",
};

export function emptyEjecutadosTier(): Record<TierFrecuencia, number> {
  return { M: 0, T: 0, S: 0, A: 0 };
}

export function emptyEjecutadosCertificacion(): EjecutadosCertificacion {
  return {
    mes: emptyEjecutadosTier(),
    acumTrim: 0,
    acumSem: 0,
    acumAnual: 0,
    totalMes: 0,
  };
}

/** Infiere M/T/S/A desde campos de OT (misma lógica que workOrderFrecuenciaBadge). */
export function tierFrecuenciaDesdeOt(d: {
  frecuencia_plan_mtsa?: string;
  frecuencia?: string;
}): TierFrecuencia | null {
  const mtsa = d.frecuencia_plan_mtsa?.toUpperCase();
  if (mtsa && mtsa in FREC_MAP) return FREC_MAP[mtsa]!;
  const f = String(d.frecuencia ?? "").toUpperCase().trim();
  return FREC_MAP[f] ?? null;
}

/** Plan acumulado lineal dentro del período (trimestre 3m, semestre 6m, año 12m). */
export function planAcumuladoEnPeriodo(
  metaPeriodo: number,
  mes: number,
  mesesEnPeriodo: number,
): number {
  if (metaPeriodo <= 0 || mesesEnPeriodo <= 0) return 0;
  const pos = ((mes - 1) % mesesEnPeriodo) + 1;
  return (metaPeriodo / mesesEnPeriodo) * pos;
}

export function inicioTrimestreMs(año: number, mes: number): number {
  return inicioTrimestreArgentinaMs(año, mes);
}

export function inicioSemestreMs(año: number, mes: number): number {
  return inicioSemestreArgentinaMs(año, mes);
}

function ratioCert(ejecutados: number, plan: number): number {
  if (plan <= 0) return ejecutados > 0 ? 1 : 0;
  return ejecutados / plan;
}

export function calcularCertificacionDisciplina(
  meta: ObjetivoEspecialidad,
  ejecutados: EjecutadosCertificacion,
  mes: number,
): CertificacionDisciplinaResult {
  const planTrim = planAcumuladoEnPeriodo(meta.trimestral, mes, 3);
  const planSem = planAcumuladoEnPeriodo(meta.semestral, mes, 6);
  const planAnual = planAcumuladoEnPeriodo(meta.anual, mes, 12);

  const pct_mensual = ratioCert(ejecutados.mes.M, meta.mensual);
  const pct_trimestral = ratioCert(ejecutados.acumTrim, planTrim);
  const pct_semestral = ratioCert(ejecutados.acumSem, planSem);
  const pct_anual = ratioCert(ejecutados.acumAnual, planAnual);
  const pct_especialidad =
    Math.round(((pct_mensual + pct_trimestral + pct_semestral + pct_anual) / 4) * 10000) / 10000;

  return {
    ejecutados,
    planes: {
      mensual: meta.mensual,
      trimAcum: planTrim,
      semAcum: planSem,
      anualAcum: planAnual,
    },
    pct_mensual,
    pct_trimestral,
    pct_semestral,
    pct_anual,
    pct_especialidad,
  };
}

export function calcularIndiceCertificacion(
  porDisciplina: Record<DisciplinaLabel, CertificacionDisciplinaResult>,
  pesos: Record<DisciplinaLabel, number> = PESOS_CERTIFICACION_CONTRATO,
): number {
  const discs: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];
  let sum = 0;
  for (const d of discs) {
    sum += porDisciplina[d].pct_especialidad * pesos[d];
  }
  return Math.round(sum * 10000) / 10000;
}

export function metasCertificacionParaAño(año: number): MetasCertificacion | null {
  if (año === METAS_CERTIFICACION_2026_DEFAULT.año) {
    return {
      año: METAS_CERTIFICACION_2026_DEFAULT.año,
      pesos: { ...METAS_CERTIFICACION_2026_DEFAULT.pesos },
      disciplinas: {
        AA: { ...METAS_CERTIFICACION_2026_DEFAULT.disciplinas.AA },
        ELECTRICO: { ...METAS_CERTIFICACION_2026_DEFAULT.disciplinas.ELECTRICO },
        GG: { ...METAS_CERTIFICACION_2026_DEFAULT.disciplinas.GG },
      },
      notas: METAS_CERTIFICACION_2026_DEFAULT.notas,
    };
  }
  return null;
}

export function acumularEjecutadosCertificacion(
  base: Record<DisciplinaLabel, EjecutadosCertificacion>,
  disc: DisciplinaLabel,
  patch: Partial<EjecutadosCertificacion>,
): void {
  const t = base[disc];
  if (patch.mes) {
    for (const k of ["M", "T", "S", "A"] as TierFrecuencia[]) {
      t.mes[k] += patch.mes[k];
    }
  }
  t.acumTrim += patch.acumTrim ?? 0;
  t.acumSem += patch.acumSem ?? 0;
  t.acumAnual += patch.acumAnual ?? 0;
  t.totalMes += patch.totalMes ?? 0;
}
