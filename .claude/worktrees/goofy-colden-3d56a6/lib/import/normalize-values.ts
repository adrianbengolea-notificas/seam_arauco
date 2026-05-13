import type { Especialidad } from "@/modules/notices/types";

const ESPECIALIDAD_MAP: Record<string, "A" | "E" | "GG" | "HG"> = {
  a: "A",
  aa: "A",
  aire: "A",
  "aire acondicionado": "A",
  "aire compresor": "A",
  compresor: "A",
  e: "E",
  elec: "E",
  electrico: "E",
  "ssgg-01": "E",
  gg: "GG",
  "grupo generador": "GG",
  generador: "GG",
  "ssgg-02": "GG",
  hg: "HG",
  hidrogrua: "HG",
  hid: "HG",
};

export function normalizeImportKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.\/_\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const warnedEspecialidad = new Set<string>();

/**
 * Normaliza especialidad desde texto SAP a claves internas de importación (A/E/GG/HG).
 * En Firestore se convierten a AA / ELECTRICO / GG / HG.
 */
export function normalizeEspecialidad(raw: string | null | undefined): "A" | "E" | "GG" | "HG" | null {
  const key = normalizeImportKey(raw);
  if (!key) return null;
  if (ESPECIALIDAD_MAP[key]) return ESPECIALIDAD_MAP[key];
  for (const [k, v] of Object.entries(ESPECIALIDAD_MAP)) {
    if (k.length >= 4 && (key.includes(k) || k.includes(key))) return v;
  }
  if (!warnedEspecialidad.has(key)) {
    warnedEspecialidad.add(key);
    console.warn(`[import] Especialidad SAP no reconocida: "${raw ?? ""}" (normalizado: "${key}")`);
  }
  return null;
}

/** Convierte código de importación a dominio de avisos (Firestore). */
export function especialidadImportToDominio(code: "A" | "E" | "GG" | "HG"): Especialidad {
  switch (code) {
    case "A":
      return "AA";
    case "E":
      return "ELECTRICO";
    case "GG":
      return "GG";
    case "HG":
      return "HG";
    default:
      return "AA";
  }
}

const FRECUENCIA_MAP: Record<string, "M" | "T" | "S" | "A"> = {
  m: "M",
  men: "M",
  mensual: "M",
  monthly: "M",
  t: "T",
  tri: "T",
  trimestral: "T",
  quarterly: "T",
  s: "S",
  sem: "S",
  semestral: "S",
  a: "A",
  anu: "A",
  anual: "A",
  annual: "A",
};

export function normalizeFrecuencia(raw: string | null | undefined): "M" | "T" | "S" | "A" | null {
  const key = normalizeImportKey(raw);
  if (!key) return null;
  if (FRECUENCIA_MAP[key]) return FRECUENCIA_MAP[key];
  for (const [k, v] of Object.entries(FRECUENCIA_MAP)) {
    if (k.length >= 4 && key.includes(k)) return v;
  }
  return null;
}

/** Número de aviso: acepta float Excel (11364944.0) y strings. */
export function normalizeNumeroAviso(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = String(Math.round(raw));
    if (n === "NaN" || n.length < 5) return null;
    return n;
  }
  const s = String(raw).trim().replace(/\s+/g, "");
  if (!s) return null;
  const asNum = Number(s.replace(/,/g, "."));
  if (!Number.isNaN(asNum) && String(asNum).includes("e") === false) {
    const rounded = String(Math.round(asNum));
    if (rounded !== "NaN" && rounded.length >= 5) return rounded;
  }
  if (s.length < 5) return null;
  return s;
}

/** Serial numérico típico de Excel (días desde 1899-12-30 UTC). */
function excelSerialToDate(serial: number): Date | null {
  if (typeof serial !== "number" || !Number.isFinite(serial) || serial <= 0) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial * 86400000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normalizeFecha(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 20000 && raw < 60000) return excelSerialToDate(raw);
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const t = String(raw).trim();
  if (!t) return null;
  const iso = Date.parse(t);
  if (!Number.isNaN(iso)) return new Date(iso);
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const day = +m[1];
    const month = +m[2];
    let year = +m[3];
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const asNum = Number(t);
  if (!Number.isNaN(asNum) && asNum > 20000) return excelSerialToDate(asNum);
  return null;
}

/** Inferencia S/A desde descripción (listados SAP sin columna frecuencia). */
export function inferFrecuenciaMTSADescripcion(descripcion: string): "S" | "A" {
  const n = normalizeImportKey(descripcion).replace(/\s+/g, " ");
  if (n.includes("semestral")) return "S";
  if (n.includes("anual") && !n.includes("semest")) return "A";
  if (n.includes("verificar elementos")) return "S";
  if (n.includes("tablero") || n.includes("ccm")) return "A";
  return "S";
}

/** Heurística legada (listado semestral/anual): especialidad cuando la celda viene vacía o rara. */
export function inferEspecialidadDesdeDescripcionYPto(descripcion: string, ptoTrbRes: string): "A" | "E" | "GG" | "HG" {
  const d = normalizeImportKey(descripcion);
  const p = normalizeImportKey(ptoTrbRes);
  if (
    d.includes(" aa ") ||
    d.startsWith("aa ") ||
    d.includes("aire acond") ||
    (d.includes("mtto") && d.includes("aa"))
  ) {
    return "A";
  }
  if (p.includes("aa") && (p.includes("pc01") || p.includes("ad"))) return "A";
  if (
    d.includes("tablero") ||
    d.includes("proteccion") ||
    d.includes("ccm") ||
    d.includes("bomb") ||
    d.includes("rotul")
  ) {
    return "E";
  }
  return "E";
}
