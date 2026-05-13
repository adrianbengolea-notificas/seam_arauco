/**
 * Normalización de número SAP / ID de documento `avisos/{id}` para evitar duplicados
 * cuando el Excel varía formato (11375283 vs 11/375283 vs ceros a la izquierda).
 */

export function avisoDocId(numeroRaw: string): string {
  return String(numeroRaw)
    .replace(/\//g, "-")
    .replace(/\s+/g, "")
    .trim();
}

/** Comparación estable del mismo aviso lógico (clave para cruzar con Firestore). */
export function normalizeNAvisoCompare(raw: string): string {
  const t = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!t) return "";
  const digits = t.replace(/\//g, "").replace(/-/g, "");
  if (/^\d+$/.test(digits)) {
    return digits.replace(/^0+/, "") || "0";
  }
  return t.toLowerCase();
}

/** ID documento preferido cuando el aviso es totalmente numérico (sin letras). */
export function preferredNumericAvisoId(numeroRaw: string): string | null {
  const t = String(numeroRaw ?? "").trim().replace(/\s+/g, "");
  const digits = t.replace(/\//g, "").replace(/-/g, "");
  if (!/^\d+$/.test(digits)) return null;
  return digits.replace(/^0+/, "") || "0";
}

/** Variantes de ID de documento a comprobar en Firestore para una fila. */
export function candidateAvisoDocIds(numeroRaw: string): string[] {
  const t = String(numeroRaw ?? "").trim().replace(/\s+/g, "");
  const out = new Set<string>();
  if (!t) return [];
  out.add(avisoDocId(t));
  const slashDash = t.replace(/\//g, "-");
  if (slashDash !== t) out.add(avisoDocId(slashDash));
  const digitsOnly = t.replace(/\//g, "").replace(/-/g, "");
  if (/^\d+$/.test(digitsOnly)) {
    const nz = digitsOnly.replace(/^0+/, "") || "0";
    out.add(nz);
    if (digitsOnly !== nz) out.add(digitsOnly);
    out.add(avisoDocId(digitsOnly));
  }
  return [...out].filter((x) => x.length > 0);
}

/** Cadenas literales posibles de `n_aviso` en Firestore para una fila (consultas `in`). */
export function nAvisoStringsForFirestoreInQuery(numeroRaw: string): string[] {
  const t = String(numeroRaw ?? "").trim();
  const s = new Set<string>();
  if (t) s.add(t);
  const pref = preferredNumericAvisoId(t);
  if (pref) s.add(pref);
  if (t.includes("/")) {
    const d = t.replace(/\//g, "");
    if (/^\d+$/.test(d)) s.add(d);
  }
  const digits = t.replace(/\//g, "").replace(/-/g, "");
  if (/^\d+$/.test(digits)) {
    s.add(digits);
    const nz = digits.replace(/^0+/, "") || "0";
    if (nz !== digits) s.add(nz);
  }
  return [...s].filter((x) => x.length > 0);
}
