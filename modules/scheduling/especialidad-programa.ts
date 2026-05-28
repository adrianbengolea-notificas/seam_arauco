import type { Especialidad } from "@/modules/notices/types";
import { ESPECIALIDADES_PROGRAMA, type EspecialidadPrograma } from "@/modules/scheduling/types";

export { ESPECIALIDADES_PROGRAMA };

/** Orden de columnas / filtros en la grilla del programa publicado. */
export const ESPECIALIDADES_PROGRAMA_ORDEN: readonly EspecialidadPrograma[] = ESPECIALIDADES_PROGRAMA;

export const ETIQUETA_ESPECIALIDAD_DOMINIO: Record<Especialidad, string> = {
  AA: "Aire (AA)",
  ELECTRICO: "Eléctrico",
  GG: "GG",
  HG: "Hidrogrúa (HG)",
};

export const ETIQUETA_ESPECIALIDAD_PROGRAMA: Record<EspecialidadPrograma, string> = {
  Aire: "Aire (AA)",
  Electrico: "Eléctrico",
  GG: "GG",
  HG: "Hidrogrúa (HG)",
};

export function etiquetaEspecialidadDominio(esp: Especialidad): string {
  return ETIQUETA_ESPECIALIDAD_DOMINIO[esp];
}

/** Especialidades en el filtro del programa (HG no filtra: es esporádica; se ve con «Todos»). */
export const ESPECIALIDADES_PROGRAMA_FILTRO: readonly EspecialidadPrograma[] =
  ESPECIALIDADES_PROGRAMA_ORDEN.filter((e) => e !== "HG");

export function etiquetaEspecialidadPrograma(esp: EspecialidadPrograma): string {
  return ETIQUETA_ESPECIALIDAD_PROGRAMA[esp];
}

/** Mapeo dominio OT/aviso → columnas de la grilla del programa publicado. */
export function especialidadDominioAPrograma(esp: Especialidad): EspecialidadPrograma {
  if (esp === "AA") return "Aire";
  if (esp === "ELECTRICO") return "Electrico";
  if (esp === "HG") return "HG";
  return "GG";
}

export function especialidadesPerfilAPrograma(
  especialidades: Especialidad[] | undefined,
): EspecialidadPrograma[] {
  const raw = especialidades ?? [];
  const out = new Set<EspecialidadPrograma>();
  for (const e of raw) {
    out.add(especialidadDominioAPrograma(e));
  }
  return [...out];
}

/**
 * HG es visible para todos los técnicos en programa (OT esporádicas, sin disciplina exclusiva).
 * Respeta el orden estándar de columnas.
 */
export function especialidadesProgramaVisiblesTecnico(
  especialidadesPerfil: Especialidad[] | undefined,
): EspecialidadPrograma[] {
  const mapped = especialidadesPerfilAPrograma(especialidadesPerfil);
  const out = new Set<EspecialidadPrograma>(mapped);
  out.add("HG");
  if (out.size === 0) return [...ESPECIALIDADES_PROGRAMA_ORDEN];
  return ESPECIALIDADES_PROGRAMA_ORDEN.filter((e) => out.has(e));
}

/** Perfil del técnico + HG para descubrir semanas con OT HG en el selector. */
export function especialidadesOtSemanasTecnico(
  especialidadesPerfil: Especialidad[] | undefined,
): Especialidad[] {
  const out = new Set<Especialidad>(especialidadesPerfil ?? []);
  out.add("HG");
  return [...out];
}
