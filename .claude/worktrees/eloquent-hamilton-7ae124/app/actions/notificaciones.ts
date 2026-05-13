"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import {
  NOTIFICACIONES_COLLECTION,
  NOTIFICACIONES_ITEMS_SUBCOLLECTION,
} from "@/lib/firestore/collections";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { FieldValue } from "firebase-admin/firestore";

function wrap<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  return fn()
    .then((data) => success(data))
    .catch((e: unknown) => {
      if (isAppError(e)) return Promise.resolve(failure(e));
      const err = new AppError("INTERNAL", e instanceof Error ? e.message : "Error interno", { cause: e });
      return Promise.resolve(failure(err));
    });
}

export async function marcarNotificacionLeida(
  idToken: string,
  notifId: string,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "notificaciones:recibir");
    const ref = getAdminDb()
      .collection(NOTIFICACIONES_COLLECTION)
      .doc(session.uid)
      .collection(NOTIFICACIONES_ITEMS_SUBCOLLECTION)
      .doc(notifId);
    const snap = await ref.get();
    if (!snap.exists) throw new AppError("NOT_FOUND", "Notificación no encontrada");
    await ref.update({ leida: true, leidoAt: FieldValue.serverTimestamp() });
  });
}

export async function marcarTodasNotificacionesLeidas(idToken: string): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "notificaciones:recibir");
    const col = getAdminDb()
      .collection(NOTIFICACIONES_COLLECTION)
      .doc(session.uid)
      .collection(NOTIFICACIONES_ITEMS_SUBCOLLECTION);
    const snap = await col.where("leida", "==", false).limit(500).get();
    let batch = getAdminDb().batch();
    let n = 0;
    for (const d of snap.docs) {
      batch.update(d.ref, { leida: true, leidoAt: FieldValue.serverTimestamp() });
      n++;
      if (n >= 400) {
        await batch.commit();
        batch = getAdminDb().batch();
        n = 0;
      }
    }
    if (n > 0) await batch.commit();
  });
}
