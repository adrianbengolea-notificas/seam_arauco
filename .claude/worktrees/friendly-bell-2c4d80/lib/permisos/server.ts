import { AppError } from "@/lib/errors/app-error";
import { verifyFirebaseIdTokenOrThrow } from "@/lib/auth/verify-id-token";
import { type Permiso, tienePermiso, toPermisoRol, type Rol } from "@/lib/permisos/index";
import { getUserProfileByUid } from "@/modules/users/repository";
import type { UserProfile } from "@/modules/users/types";
import type { UserProfileWithUid } from "@/modules/users/repository";

function extractBearerToken(request: Request | null): string | null {
  if (!request) return null;
  const h = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!h?.toLowerCase().startsWith("bearer ")) return null;
  const t = h.slice(7).trim();
  return t.length > 10 ? t : null;
}

/**
 * Verifica JWT y permiso canónico. Fuente de verdad del rol: perfil Firestore;
 * opcionalmente compara con custom claims del token.
 */
export async function requirePermiso(
  request: Request | null,
  permiso: Permiso,
  idToken?: string,
): Promise<UserProfileWithUid> {
  const token = (idToken && idToken.length > 10 ? idToken : null) ?? extractBearerToken(request);
  if (!token) {
    throw new AppError("UNAUTHORIZED", "Token de sesión requerido");
  }

  const decoded = await verifyFirebaseIdTokenOrThrow(token, true);
  const uid = decoded.uid;

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

  const effectiveRol = toPermisoRol(profile.rol);
  const claimRaw = decoded.rol;
  if (claimRaw != null && String(claimRaw).length > 0) {
    const claimRol = toPermisoRol(String(claimRaw));
    if (claimRol !== effectiveRol) {
      throw new AppError("UNAUTHORIZED", "Sesión desactualizada. Volvé a iniciar sesión.");
    }
  }
  const claimCentro = decoded.centro != null ? String(decoded.centro) : "";
  if (claimCentro && claimCentro !== String(profile.centro ?? "")) {
    throw new AppError("UNAUTHORIZED", "Sesión desactualizada. Volvé a iniciar sesión.");
  }

  if (!tienePermiso(effectiveRol, permiso)) {
    throw new AppError("FORBIDDEN", "Permisos insuficientes para esta operación");
  }

  return { uid, ...profile };
}

/** Alias tipado para actions que solo pasan el idToken (sin Request). */
export async function requirePermisoFromToken(
  idToken: string,
  permiso: Permiso,
): Promise<UserProfileWithUid> {
  return requirePermiso(null, permiso, idToken);
}

export function profilePermisoRol(profile: UserProfile): Rol {
  return toPermisoRol(profile.rol);
}
