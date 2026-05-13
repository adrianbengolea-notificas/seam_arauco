/** Id de documento `propuestas_semana` (alineado con el cron `motor-ot-diario`). */
export function propuestaSemanaDocId(centro: string, semanaIso: string): string {
  return `${centro.trim()}_${semanaIso.trim()}`.replace(/[/\s]+/g, "_");
}
