import type { UserRole } from "@/modules/users/types";

/**
 * Bootstrap súper admin (solo servidor):
 * - `SUPERADMIN_EMAIL`: igualdad de correo → rol superadmin al crear perfil.
 * - `SUPERADMIN_UID`: igualdad de uid → rol superadmin (migración / compat env).
 */
export function roleForEmailAndUid(
  email: string,
  uid: string,
  fallback: UserRole = "tecnico",
): UserRole {
  const superUid = process.env.SUPERADMIN_UID?.trim();
  if (superUid && uid === superUid) {
    return "superadmin";
  }
  const superEmail = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  if (superEmail && email.trim().toLowerCase() === superEmail) {
    return "superadmin";
  }
  return fallback;
}

/** @deprecated Usar roleForEmailAndUid con uid */
export function roleForEmail(email: string, fallback: UserRole = "tecnico"): UserRole {
  const superEmail = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  if (superEmail && email.trim().toLowerCase() === superEmail) {
    return "superadmin";
  }
  return fallback;
}
