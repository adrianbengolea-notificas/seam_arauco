import { especialidadExplicitaDesdeTexto } from "@/lib/import/normalize-values";
import type { Especialidad } from "@/modules/notices/types";

/** Valores del selector de especialidad en vencimientos (E = eléctrico en dominio). */
export type FiltroEspecialidadUi = "todos" | "AA" | "E" | "GG" | "HG";

/** Especialidad para filtros UI: prioriza token explícito en descripción SAP sobre el campo persistido. */
export function especialidadEfectivaAviso(aviso: {
  especialidad?: Especialidad;
  texto_corto?: string;
}): Especialidad | undefined {
  return especialidadExplicitaDesdeTexto(aviso.texto_corto) ?? aviso.especialidad;
}

export function avisoPasaFiltroEspecialidadUi(
  aviso: { especialidad?: Especialidad; texto_corto?: string },
  filtro: FiltroEspecialidadUi,
): boolean {
  if (filtro === "todos") return true;
  const especialidad = especialidadEfectivaAviso(aviso);
  if (filtro === "AA") return especialidad === "AA";
  if (filtro === "E") return especialidad === "ELECTRICO";
  if (filtro === "GG") return especialidad === "GG";
  if (filtro === "HG") return especialidad === "HG";
  return true;
}
