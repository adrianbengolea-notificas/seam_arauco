import type { UserProfile } from "@/modules/users/types";

type CentroUsuarioInput = Pick<UserProfile, "centro" | "centros_asignados"> | null | undefined;

/** Centros donde el usuario opera (técnico multi-planta o resto con `centro` único). */
export function centrosEfectivosDelUsuario(profile: CentroUsuarioInput): string[] {
  if (!profile) return [];
  const raw = profile.centros_asignados;
  if (Array.isArray(raw) && raw.length > 0) {
    const seen = new Set<string>();
    for (const c of raw) {
      const t = String(c ?? "").trim();
      if (t) seen.add(t);
    }
    if (seen.size > 0) return [...seen].sort((a, b) => a.localeCompare(b));
  }
  const c = String(profile.centro ?? "").trim();
  return c ? [c] : [];
}

export function usuarioTieneCentro(
  profile: CentroUsuarioInput,
  centroOt: string | null | undefined,
): boolean {
  const c = String(centroOt ?? "").trim();
  if (!c) return false;
  return centrosEfectivosDelUsuario(profile).includes(c);
}

/** Superadmin pleno vs admin de planta: comparten al menos un centro. */
export function perfilesCompartenCentro(
  a: CentroUsuarioInput,
  b: CentroUsuarioInput,
): boolean {
  const ca = centrosEfectivosDelUsuario(a);
  const cb = centrosEfectivosDelUsuario(b);
  if (ca.length === 0 || cb.length === 0) return false;
  return ca.some((c) => cb.includes(c));
}
