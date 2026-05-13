/**
 * Normalización de encabezados Excel SAP (variantes de nombre, typos, columnas vacías).
 */

export const COLUMN_ALIASES: Record<string, string[]> = {
  numero: ["n de aviso", "aviso", "numero aviso", "nro aviso", "n aviso", "aviso sap", "orden"],
  descripcion: ["descripcion", "descripcion aviso", "texto aviso", "descripcion corta"],
  ubicacionTecnica: [
    "ubicacion tecnica",
    "ubicacion tenica",
    "ubicac tecnica",
    "ubi tec",
    "ut",
  ],
  denomUbicTecnica: [
    "denom ubicacion tecnica",
    "denomubictecnica",
    "denominacion ubicacion",
    "denom ubic tecnica",
    "descripcion ubicacion",
    "nombre ubicacion",
  ],
  especialidad: ["especialidad", "esp", "tipo especialidad", "grupo planificacion"],
  frecuencia: [
    "frecuencia",
    "frec",
    "frecuencia mto",
    "frecuencia mantenimiento",
    "freq",
  ],
  tipo: ["tipo", "clase aviso", "cl", "tipo aviso", "clase"],
  status: ["status usuario", "status sistema", "estado", "status", "estado usuario"],
  centro: ["cepl", "centro", "centro planta", "centro costo", "ce coste", "costo"],
  ptoTrbRes: ["ptotrbres", "pto trabajo", "puesto trabajo", "responsable"],
  autAviso: ["aut aviso", "autaviso", "autor aviso", "creado por"],
  fecha: ["fecha", "fecha realizacion", "fecha aviso", "fecha creacion", "fecha real"],
};

/** Normaliza un nombre de columna para comparación flexible. */
export function normalizeHeader(header: string): string {
  let s = String(header ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  s = s.replace(/\u00ba/g, "").replace(/\u00b0/g, "");
  s = s.replace(/n\u00ba\s*/gi, "n ");
  s = s.replace(/n\s*°\s*/gi, "n ");
  s = s.replace(/\s*°\s*/g, " ");

  s = s.replace(/[.\/_\-]/g, "");
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

export type HeaderMapResult = {
  byField: Record<string, string | null>;
  indices: Record<string, number | null>;
};

/**
 * Dado un array de headers del Excel (fila de encabezados), devuelve el mapeo campo → índice / nombre real.
 * Las columnas `Unnamed:*` o vacías no compiten por alias.
 */
export function mapHeaders(excelHeaders: string[]): HeaderMapResult {
  const byField: Record<string, string | null> = {};
  const indices: Record<string, number | null> = {};
  const used = new Set<number>();

  const cols = excelHeaders.map((raw, i) => ({
    raw: String(raw ?? "").trim(),
    norm: normalizeHeader(String(raw ?? "")),
    i,
  }));

  const usable = cols.filter((c) => c.norm !== "" && !c.norm.startsWith("unnamed"));

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const sortedAliases = [...aliases].sort((a, b) => b.length - a.length);
    let found: { raw: string; i: number } | null = null;

    outer: for (const alias of sortedAliases) {
      for (const c of usable) {
        if (used.has(c.i)) continue;
        const exact = c.norm === alias;
        const contains = alias.length >= 4 && c.norm.includes(alias);
        const shortExact = alias.length < 4 && exact;
        if (exact || contains || shortExact) {
          found = { raw: c.raw || alias, i: c.i };
          break outer;
        }
      }
    }
    byField[field] = found ? found.raw : null;
    indices[field] = found ? found.i : null;
    if (found) used.add(found.i);
  }

  return { byField, indices };
}

/** Columnas del Excel sin ningún campo mapeado (excluye vacías y Unnamed). */
export function listUnmappedColumnHeaders(
  excelHeaders: string[],
  indices: Record<string, number | null>,
): string[] {
  const mapped = new Set(
    Object.values(indices).filter((i): i is number => typeof i === "number" && i >= 0),
  );
  const out: string[] = [];
  for (let i = 0; i < excelHeaders.length; i++) {
    if (mapped.has(i)) continue;
    const raw = String(excelHeaders[i] ?? "").trim();
    const norm = normalizeHeader(String(excelHeaders[i] ?? ""));
    if (!raw && !norm) continue;
    if (norm.startsWith("unnamed")) out.push(raw || `Unnamed: ${i}`);
    else if (raw) out.push(raw);
  }
  return out;
}
