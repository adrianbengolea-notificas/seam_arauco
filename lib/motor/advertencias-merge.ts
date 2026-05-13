import { MOTOR_PROPUESTA_MAX_ADVERTENCIAS } from "@/lib/config/limits";

/** Une advertencias previas con las nuevas y mantiene solo las últimas N (documento acotado). */
export function mergeAdvertenciasAcotadas(prev: unknown, nuevas: string[]): string[] {
  const p = Array.isArray(prev) ? prev.filter((x): x is string => typeof x === "string") : [];
  return [...p, ...nuevas].slice(-MOTOR_PROPUESTA_MAX_ADVERTENCIAS);
}
