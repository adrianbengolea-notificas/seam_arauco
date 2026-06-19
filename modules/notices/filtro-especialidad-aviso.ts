import { especialidadExplicitaDesdeTexto } from "@/lib/import/normalize-values";
import type { Especialidad } from "@/modules/notices/types";

/** Valores del selector de especialidad en vencimientos (E = eléctrico en dominio). */
export type FiltroEspecialidadUi = "todos" | "AA" | "E" | "GG" | "HG";

/**
 * Especialidad para filtros UI: usa el campo persistido en Firestore.
 * Solo deja que la descripción corrija cuando el persistido es GG pero el texto indica AA explícito.
 */
export function especialidadEfectivaAviso(aviso: {
  especialidad?: Especialidad;
  texto_corto?: string;
}): Especialidad | undefined {
  const desdeTexto = especialidadExplicitaDesdeTexto(aviso.texto_corto);
  if (aviso.especialidad) {
    if (aviso.especialidad === "GG" && desdeTexto === "AA") return "AA";
    return aviso.especialidad;
  }
  return desdeTexto ?? undefined;
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
