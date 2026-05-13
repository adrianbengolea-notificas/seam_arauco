const PREFIJOS = ["ESPERANZA", "YPORA", "BOSETTI", "PIRAY", "CELULOSA"] as const;

/** Extrae una etiqueta de localidad desde la ubicación técnica (heurística planta). */
export function extractLocalidadFromUbicacionTecnica(ubicacionTecnica: string): string {
  const u = (ubicacionTecnica ?? "").toUpperCase();
  for (const p of PREFIJOS) {
    if (u.includes(p)) return p;
  }
  const trimmed = (ubicacionTecnica ?? "").trim();
  return trimmed ? trimmed.slice(0, 24) : "—";
}
