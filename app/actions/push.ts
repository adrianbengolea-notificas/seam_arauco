"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { adminUpdateUserPushSubscription } from "@/modules/users/repository";
import { z } from "zod";

const subscriptionSchema = z
  .object({
    endpoint: z.string(),
    expirationTime: z.union([z.number(), z.null()]).optional(),
    keys: z
      .object({
        p256dh: z.string(),
        auth: z.string(),
      })
      .optional(),
  })
  .passthrough();

function wrap<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  return fn()
    .then((data) => success(data))
    .catch((e: unknown) => {
      if (isAppError(e)) return Promise.resolve(failure(e));
      const err = new AppError("INTERNAL", e instanceof Error ? e.message : "Error interno", { cause: e });
      return Promise.resolve(failure(err));
    });
}

export async function actionGuardarPushSubscription(
  idToken: string,
  input: { subscription: z.infer<typeof subscriptionSchema>; pushHabilitado: boolean },
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "notificaciones:recibir");
    const subscription = subscriptionSchema.parse(input.subscription);
    await adminUpdateUserPushSubscription(session.uid, {
      pushSubscription: subscription as unknown as Record<string, unknown>,
      pushHabilitado: input.pushHabilitado,
    });
  });
}

export async function actionPushMasTarde(idToken: string): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "notificaciones:recibir");
    await adminUpdateUserPushSubscription(session.uid, { pushHabilitado: false });
  });
}
