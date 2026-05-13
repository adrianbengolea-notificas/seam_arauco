import { createHash } from "node:crypto";
import type { Especialidad, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";

function normalizeUt(s: string): string {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/**
 * Clave estable para el mismo “hueco” de mantenimiento aunque SAP cambie el número de aviso.
 * UT + frecuencia + especialidad + tipo (no usa descripción: SAP la reformula).
 */
export function buildClaveMantenimiento(input: {
  ubicacion_tecnica: string;
  frecuencia: FrecuenciaMantenimiento;
  especialidad: Especialidad;
  tipo: TipoAviso;
}): string {
  const raw = [
    normalizeUt(input.ubicacion_tecnica),
    input.frecuencia,
    input.especialidad,
    input.tipo,
  ].join("|");
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
}
