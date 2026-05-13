/**
 * El SDK debe usar la base **predeterminada** del proyecto sin segundo argumento (equivalente a `(default)` en GCP).
 * Si en `.env` ponés `default` (sin paréntesis), Firestore intenta otra base y las reglas / datos no coinciden → permisos.
 */
export function resolveFirestoreDatabaseId(envValue: string | undefined): string | undefined {
  const t = envValue?.trim();
  if (!t) return undefined;
  const lower = t.toLowerCase();
  if (lower === "default" || t === "(default)") return undefined;
  return t;
}
