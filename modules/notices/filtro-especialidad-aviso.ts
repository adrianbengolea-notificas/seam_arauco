import type { Especialidad } from "@/modules/notices/types";

/** Valores del selector de especialidad en vencimientos (E = eléctrico en dominio). */
export type FiltroEspecialidadUi = "todos" | "AA" | "E" | "GG" | "HG";

export function avisoPasaFiltroEspecialidadUi(
  especialidad: Especialidad | undefined,
  filtro: FiltroEspecialidadUi,
): boolean {
  if (filtro === "todos") return true;
  if (filtro === "AA") return especialidad === "AA";
  if (filtro === "E") return especialidad === "ELECTRICO";
  if (filtro === "GG") return especialidad === "GG";
  if (filtro === "HG") return especialidad === "HG";
  return true;
}
