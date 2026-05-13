import { isCentroInKnownList } from "@/lib/config/app-config";

/**
 * Derivación de centro a partir del prefijo de la ubicación técnica.
 * Usado como FALLBACK cuando no hay código de equipo disponible (ej. importación de avisos).
 *
 * BOSS puede tener equipos PF01 y PM02 — cuando hay código de equipo, usar
 * `deriveCentroFromEquipmentCode` primero (más preciso).
 */
const UT_PREFIX_TO_CENTRO: Readonly<Record<string, string>> = {
  ESPE: "PC01",
  PIRA: "PT01",
  BOSS: "PF01",
  YPOR: "PF01",
  GARI: "PF01",
};

export function deriveCentroPlantCodeFromUbicacionTecnica(ut: string): string {
  const t = ut.trim();
  if (!t) return "PC01";
  const first = t.split(/[-_]/)[0]?.toUpperCase() ?? "";
  return UT_PREFIX_TO_CENTRO[first] ?? "PC01";
}

/**
 * Derivación de centro a partir del prefijo del código de equipo SAP.
 * Esta es la fuente más confiable: el código de equipo lleva embebido el centro
 * tal como lo define SAP (PC01xxx → PC01, PF01xxx → PF01, etc.).
 *
 * Retorna `null` si el código no coincide con ningún prefijo conocido.
 */
const EQUIP_PREFIX_TO_CENTRO: Readonly<Record<string, string>> = {
  PC01: "PC01",
  PF01: "PF01",
  PM02: "PM02",
  PT01: "PT01",
};

export function deriveCentroFromEquipmentCode(codigo: string): string | null {
  const t = codigo.trim().toUpperCase();
  for (const [prefix, centro] of Object.entries(EQUIP_PREFIX_TO_CENTRO)) {
    if (t.startsWith(prefix)) return centro;
  }
  return null;
}

/**
 * Normaliza un código de centro para importación:
 * 1. Si `raw` ya es un centro reconocido (en KNOWN_CENTROS), lo usa.
 * 2. Si se provee `codigo` (código de equipo), deriva del prefijo del código — fuente más precisa.
 * 3. Fallback: deriva del prefijo de la ubicación técnica `ut`.
 *
 * @param raw   - Valor de centro tal como viene del Excel / SAP (puede estar vacío o ser código legacy)
 * @param ut    - Ubicación técnica de la misma fila
 * @param codigo - Código de equipo / activo (opcional, más preciso que UT)
 */
export function normalizeCentro(raw: string, ut: string, codigo?: string): string {
  const t = raw.trim();
  if (t && isCentroInKnownList(t)) return t;
  if (codigo) {
    const fromCode = deriveCentroFromEquipmentCode(codigo);
    if (fromCode) return fromCode;
  }
  return deriveCentroPlantCodeFromUbicacionTecnica(ut);
}
