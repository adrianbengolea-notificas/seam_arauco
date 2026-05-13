/**
 * Código de planta / centro operativo derivado del primer segmento de la ubicación técnica
 * (p. ej. ESPE-ESP-CEL-... → PC01). Para seed y migraciones.
 */
const UT_PREFIX_TO_CENTRO: Readonly<Record<string, string>> = {
  ESPE: "PC01",
  PIRA: "PT01",
  BOSS: "PC01",
  YPOR: "PC01",
  GARI: "PC01",
};

export function deriveCentroPlantCodeFromUbicacionTecnica(ut: string): string {
  const t = ut.trim();
  if (!t) return "PC01";
  const first = t.split(/[-_]/)[0]?.toUpperCase() ?? "";
  return UT_PREFIX_TO_CENTRO[first] ?? "PC01";
}
