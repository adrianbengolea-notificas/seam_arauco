/**
 * Límites de mes/trimestre para reportes operativos y certificación.
 * Siempre calendario Argentina (America/Argentina/Buenos_Aires).
 */

export const TZ_REPORTE = "America/Argentina/Buenos_Aires";

/** Argentina usa UTC−3 fijo (sin DST desde 2009). Medianoche local = 03:00 UTC. */
export function inicioMesArgentinaMs(año: number, mes: number): number {
  return Date.UTC(año, mes - 1, 1, 3, 0, 0, 0);
}

export function inicioMesSiguienteArgentinaMs(año: number, mes: number): number {
  if (mes >= 12) return Date.UTC(año + 1, 0, 1, 3, 0, 0, 0);
  return Date.UTC(año, mes, 1, 3, 0, 0, 0);
}

export function rangeMesReporte(año: number, mes: number): { inicioMs: number; finMs: number } {
  return {
    inicioMs: inicioMesArgentinaMs(año, mes),
    finMs: inicioMesSiguienteArgentinaMs(año, mes),
  };
}

export function mesCalendarioArgentina(ms: number): { año: number; mes: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_REPORTE,
    year: "numeric",
    month: "numeric",
  });
  const parts = dtf.formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return { año: Number(y), mes: Number(m) };
}

/** True si el instante cae en el mes calendario AR [año-mes]. */
export function msEnMesReporte(ms: number, año: number, mes: number): boolean {
  const cal = mesCalendarioArgentina(ms);
  return cal.año === año && cal.mes === mes;
}

export function inicioTrimestreArgentinaMs(año: number, mes: number): number {
  const mesInicio = Math.floor((mes - 1) / 3) * 3 + 1;
  return inicioMesArgentinaMs(año, mesInicio);
}

export function inicioSemestreArgentinaMs(año: number, mes: number): number {
  const mesInicio = mes <= 6 ? 1 : 7;
  return inicioMesArgentinaMs(año, mesInicio);
}

export function inicioAnioArgentinaMs(año: number): number {
  return inicioMesArgentinaMs(año, 1);
}

export function formatFechaReporteAR(ms: number): string {
  return new Date(ms).toLocaleDateString("es-AR", {
    timeZone: TZ_REPORTE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
