import { getAdminAuth } from "@/firebase/firebaseAdmin";
import { AppError } from "@/lib/errors/app-error";
import { getUserProfileByUid } from "@/modules/users/repository";
import { roleSatisfiesAllowed } from "@/modules/users/roles";
import type { UserRole } from "@/modules/users/types";

export type VerifiedSession = {
  uid: string;
  email: string | undefined;
  role: UserRole;
};

/** Solo valida JWT; no exige documento `users`. Usar para bootstrap. */
export async function verifyIdTokenBasic(
  idToken: string | undefined,
): Promise<{ uid: string; email: string | undefined }> {
  if (!idToken || idToken.length < 10) {
    throw new AppError("UNAUTHORIZED", "Token de sesión requerido");
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken, true);
    return { uid: decoded.uid, email: decoded.email };
  } catch (e) {
    throw new AppError("UNAUTHORIZED", "Token inválido o expirado", { cause: e });
  }
}

/**
 * Verifica token y exige perfil Firestore activo.
 * El rol efectivo es siempre `users/{uid}.rol`.
 */
export async function verifyIdTokenOrThrow(idToken: string | undefined): Promise<VerifiedSession> {
  const { uid, email } = await verifyIdTokenBasic(idToken);
  const profile = await getUserProfileByUid(uid);
  if (!profile) {
    throw new AppError(
      "UNAUTHORIZED",
      "Perfil no inicializado. Esperá un momento o volvé a iniciar sesión.",
    );
  }
  if (!profile.activo) {
    throw new AppError("FORBIDDEN", "Usuario inactivo");
  }

  return {
    uid,
    email: email ?? profile.email,
    role: profile.rol,
  };
}

export function requireRole(session: VerifiedSession, allowed: readonly UserRole[]): void {
  if (!roleSatisfiesAllowed(session.role, allowed)) {
    throw new AppError("FORBIDDEN", "Permisos insuficientes para esta operación");
  }
}
