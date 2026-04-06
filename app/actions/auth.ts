"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { verifyIdTokenBasic } from "@/lib/auth/verify-id-token";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { getAdminAuth } from "@/firebase/firebaseAdmin";
import { ensureUserProfileCreated, syncUserCustomClaims } from "@/modules/users/repository";

function wrap<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  return fn()
    .then((data) => success(data))
    .catch((e: unknown) => {
      if (isAppError(e)) return Promise.resolve(failure(e));
      const err = new AppError("INTERNAL", e instanceof Error ? e.message : "Error interno", {
        cause: e,
      });
      return Promise.resolve(failure(err));
    });
}

/**
 * Idempotente: crea `users/{uid}` en primera sesión. Llamar tras login o al restaurar sesión.
 */
export async function actionBootstrapSession(
  idToken: string,
): Promise<ActionResult<{ rol: string; display_name: string }>> {
  return wrap(async () => {
    const { uid, email } = await verifyIdTokenBasic(idToken);
    const record = await getAdminAuth().getUser(uid);
    const displayName =
      record.displayName || record.email?.split("@")[0] || email?.split("@")[0] || uid;
    const profile = await ensureUserProfileCreated({
      uid,
      email: email ?? record.email ?? "",
      displayName,
    });
    await syncUserCustomClaims(uid, profile);
    return { rol: profile.rol, display_name: profile.display_name };
  });
}
