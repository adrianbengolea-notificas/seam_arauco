import { getAdminAuth } from "@/firebase/firebaseAdmin";
import { AppError } from "@/lib/errors/app-error";
import { getUserProfileByUid } from "@/modules/users/repository";
import { roleSatisfiesAllowed } from "@/modules/users/roles";
import type { UserRole } from "@/modules/users/types";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FirebaseAuthError } from "firebase-admin/auth";

export type VerifiedSession = {
  uid: string;
  email: string | undefined;
  role: UserRole;
};

function messageForVerifyIdTokenFailure(e: unknown): string {
  if (e instanceof FirebaseAuthError) {
    if (e.hasCode("id-token-expired")) {
      return "La sesión expiró. Volvé a iniciar sesión.";
    }
    if (e.hasCode("id-token-revoked")) {
      return "La sesión fue revocada. Volvé a iniciar sesión.";
    }
    if (e.hasCode("invalid-id-token")) {
      return "Token de sesión inválido. Volvé a iniciar sesión.";
    }
    if (e.hasCode("user-disabled")) {
      return "Usuario deshabilitado.";
    }
    if (e.hasCode("argument-error")) {
      return "No se pudo validar el token en el servidor. En local: agregá en .env.local GOOGLE_APPLICATION_CREDENTIALS con la ruta al JSON de cuenta de servicio del proyecto (Firebase Console → Cuentas de servicio), o variable FIREBASE_SERVICE_ACCOUNT_KEY. Ejecutá npm run diag:firebase.";
    }
    const msg = (e.message || "").toLowerCase();
    if (
      msg.includes("quota project") ||
      msg.includes("requires a quota project") ||
      (e.hasCode("internal-error") && msg.includes("identitytoolkit") && msg.includes("403"))
    ) {
      return "Firebase Admin usa credenciales de usuario (gcloud application-default) y Google exige un «proyecto de cuota» para la API Identity Toolkit. En una terminal: gcloud auth application-default set-quota-project TU_PROJECT_ID (el mismo que NEXT_PUBLIC_FIREBASE_PROJECT_ID). Tu cuenta necesita permiso serviceusage.services.use en ese proyecto; si no podés, pedí a un admin del proyecto que te asigne p. ej. roles/serviceusage.serviceUsageConsumer o Editor, o que te pasen FIREBASE_SERVICE_ACCOUNT_KEY / JSON de cuenta de servicio. Más info: cloud.google.com/docs/authentication/adc-troubleshooting/user-creds";
    }
    if (
      msg.includes("audience") ||
      msg.includes("incorrect issuer") ||
      msg.includes("project") && msg.includes("expect")
    ) {
      return "El JWT es del proyecto de Firebase del navegador, pero Firebase Admin en el servidor usa otro proyecto o no tiene credenciales. Alineá service account con NEXT_PUBLIC_FIREBASE_PROJECT_ID (npm run diag:firebase).";
    }
    const code = typeof (e as { code?: string }).code === "string" ? (e as { code: string }).code : "auth";
    const detail = (e.message || "").trim();
    if (detail) {
      const max = 400;
      const clipped = detail.length > max ? `${detail.slice(0, max)}…` : detail;
      return `No se pudo validar la sesión (${code}). ${clipped}`;
    }
    return "No se pudo validar la sesión. Volvé a iniciar sesión.";
  }
  const any = e as { code?: string; message?: string };
  const anyMsg = typeof any.message === "string" ? any.message.trim() : "";
  const anyCode = typeof any.code === "string" ? any.code : "";
  if (anyMsg) {
    const max = 400;
    const clipped = anyMsg.length > max ? `${anyMsg.slice(0, max)}…` : anyMsg;
    const label = anyCode ? `${anyCode}: ` : "";
    return `${label}${clipped}`;
  }
  const fallback = e instanceof Error ? e.message.trim() : "";
  if (
    fallback &&
    (fallback.includes("ENOTFOUND") ||
      fallback.includes("ECONNREFUSED") ||
      fallback.includes("Could not load the default credentials"))
  ) {
    return "El servidor no pudo usar credenciales de Firebase Admin (¿falta GOOGLE_APPLICATION_CREDENTIALS o gcloud auth application-default login?). Ejecutá npm run diag:firebase.";
  }
  if (fallback) {
    const max = 400;
    return fallback.length <= max ? fallback : `${fallback.slice(0, max)}…`;
  }
  return "Token inválido o expirado";
}

/**
 * Verificación del JWT de Firebase Auth (incl. `checkRevoked`).
 * Expone claims completos; preferible una sola llamada por request.
 */
export async function verifyFirebaseIdTokenOrThrow(
  idToken: string | undefined,
  checkRevoked = true,
): Promise<DecodedIdToken> {
  if (!idToken || idToken.length < 10) {
    throw new AppError("UNAUTHORIZED", "Token de sesión requerido");
  }
  try {
    return await getAdminAuth().verifyIdToken(idToken, checkRevoked);
  } catch (e) {
    throw new AppError("UNAUTHORIZED", messageForVerifyIdTokenFailure(e), { cause: e });
  }
}

/** Solo valida JWT; no exige documento `users`. Usar para bootstrap. */
export async function verifyIdTokenBasic(
  idToken: string | undefined,
): Promise<{ uid: string; email: string | undefined }> {
  const decoded = await verifyFirebaseIdTokenOrThrow(idToken, true);
  return { uid: decoded.uid, email: decoded.email };
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
