import { AppError } from "@/lib/errors/app-error";
import { verifyFirebaseIdTokenOrThrow } from "@/lib/auth/verify-id-token";
import { type Permiso, tienePermiso, toPermisoRol, type Rol } from "@/lib/permisos/index";
import { getUserProfileByUid } from "@/modules/users/repository";
import type { UserProfile } from "@/modules/users/types";
import type { UserProfileWithUid } from "@/modules/users/repository";
import { z } from "zod";

/** Valores permitidos en custom claim `rol` del JWT (incl. legado `super_admin`). */
const firebaseRolClaimSchema = z.enum([
  "tecnico",
  "supervisor",
  "admin",
  "superadmin",
  "super_admin",
  "cliente_arauco",
]);

function extractBearerToken(request: Request | null): string | null {
  if (!request) return null;
  const h = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!h?.toLowerCase().startsWith("bearer ")) return null;
  const t = h.slice(7).trim();
  return t.length > 10 ? t : null;
}

/**
 * JWT + perfil Firestore activo y alineado con claims; sin comprobar un permiso concreto.
 * Fuente de verdad del rol: perfil Firestore; opcionalmente compara con custom claims del token.
 */
export async function requireVerifiedProfileFromToken(idToken: string): Promise<UserProfileWithUid> {
  if (!idToken || idToken.length <= 10) {
    throw new AppError("UNAUTHORIZED", "Token de sesión requerido");
  }

  const decoded = await verifyFirebaseIdTokenOrThrow(idToken, true);
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
    const parsedClaim = firebaseRolClaimSchema.safeParse(String(claimRaw).trim());
    if (!parsedClaim.success) {
      throw new AppError(
        "UNAUTHORIZED",
        "Sesión con rol en token no reconocido. Volvé a iniciar sesión.",
      );
    }
    const claimRol = toPermisoRol(parsedClaim.data);
    if (claimRol !== effectiveRol) {
      throw new AppError("UNAUTHORIZED", "Sesión desactualizada. Volvé a iniciar sesión.");
    }
  }
  const claimCentro = decoded.centro != null ? String(decoded.centro) : "";
  if (claimCentro && claimCentro !== String(profile.centro ?? "")) {
    throw new AppError("UNAUTHORIZED", "Sesión desactualizada. Volvé a iniciar sesión.");
  }

  return { uid, ...profile };
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

  const session = await requireVerifiedProfileFromToken(token);
  const effectiveRol = toPermisoRol(session.rol);
  if (!tienePermiso(effectiveRol, permiso)) {
    throw new AppError("FORBIDDEN", "Permisos insuficientes para esta operación");
  }

  return session;
}

/** Al menos uno de los permisos (p. ej. listar técnicos al crear OT o al reasignar). */
export async function requireAnyPermisoFromToken(
  idToken: string,
  permisos: Permiso[],
): Promise<UserProfileWithUid> {
  const session = await requireVerifiedProfileFromToken(idToken);
  const effectiveRol = toPermisoRol(session.rol);
  if (!permisos.some((p) => tienePermiso(effectiveRol, p))) {
    throw new AppError("FORBIDDEN", "Permisos insuficientes para esta operación");
  }
  return session;
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
