/** Id de documento `propuestas_semana` (alineado con el cron `motor-ot-diario`). */
export function propuestaSemanaDocId(centro: string, semanaIso: string): string {
  return `${centro.trim()}_${semanaIso.trim()}`.replace(/[/\s]+/g, "_");
}

/**
 * Identificador estable para un ítem de propuesta (checkbox / server actions).
 * Si el documento no guardaba `id` (datos viejos), usa clave derivada del índice para no colapsar todos en `undefined`.
 */
export function stablePropuestaItemId(
  propuestaDocId: string,
  itemId: string | undefined,
  index: number,
): string {
  const t = typeof itemId === "string" ? itemId.trim() : "";
  if (t) return t;
  return `__noid__${propuestaDocId}__${index}`;
}
