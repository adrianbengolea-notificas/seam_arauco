import { getAdminDb } from "@/firebase/firebaseAdmin";
import {
  NOTIFICACIONES_COLLECTION,
  NOTIFICACIONES_ITEMS_SUBCOLLECTION,
} from "@/lib/firestore/collections";
import type { Notificacion } from "@/lib/firestore/types";
import { tienePermiso, toPermisoRol, type Rol } from "@/lib/permisos/index";
import { getUserProfileByUid } from "@/modules/users/repository";
import { Timestamp } from "firebase-admin/firestore";
import type { DestinatarioNotif } from "@/lib/notificaciones/destinatarios";

function pushHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "statusCode" in err) {
    const n = Number((err as { statusCode: unknown }).statusCode);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Suscripción inválida o expirada: no reintentar. */
function isPermanentPushFailure(err: unknown): boolean {
  const s = pushHttpStatus(err);
  return s === 404 || s === 410;
}

function isRetryablePushFailure(err: unknown): boolean {
  if (isPermanentPushFailure(err)) return false;
  const s = pushHttpStatus(err);
  if (s === undefined) return true;
  if (s === 429) return true;
  if (s >= 500) return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendNotificationWithRetries(
  webpush: typeof import("web-push"),
  sub: import("web-push").PushSubscription,
  payloadJson: string,
): Promise<void> {
  const max = 3;
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      await webpush.sendNotification(sub, payloadJson);
      return;
    } catch (err) {
      if (!isRetryablePushFailure(err) || attempt === max - 1) {
        throw err;
      }
      await delay(350 * 2 ** attempt);
    }
  }
}

async function enviarPushSilencioso(
  destinatarios: DestinatarioNotif[],
  payload: { titulo: string; cuerpo: string; url: string },
): Promise<void> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const contact = process.env.VAPID_EMAIL ?? "mailto:admin@seam.com";
  if (!publicKey?.trim() || !privateKey?.trim()) return;

  let webpush: typeof import("web-push");
  try {
    webpush = await import("web-push");
  } catch (e) {
    console.error("[push] web-push no disponible", e);
    return;
  }

  webpush.setVapidDetails(contact, publicKey.trim(), privateKey.trim());
  const payloadJson = JSON.stringify(payload);

  for (const d of destinatarios) {
    const profile = await getUserProfileByUid(d.uid);
    if (!profile || profile.pushHabilitado !== true) continue;
    const raw = profile.pushSubscription;
    if (!raw || typeof raw !== "object") continue;
    const sub = raw as unknown as import("web-push").PushSubscription;
    try {
      await sendNotificationWithRetries(webpush, sub, payloadJson);
    } catch (err) {
      console.error("[push] fallo envío", d.uid, err);
    }
  }
}

/**
 * Crea documentos de notificación por destinatario (Admin SDK).
 * Errores y push se manejan sin bloquear al llamador si se usa con `void`.
 */
export async function crearNotificacion(
  destinatarios: DestinatarioNotif[],
  notif: Omit<Notificacion, "id" | "leida" | "creadoAt" | "pushEnviado"> | Record<string, unknown>,
): Promise<void> {
  try {
    const permitidos = destinatarios.filter((d) =>
      tienePermiso(normalizeRol(d.rol), "notificaciones:recibir"),
    );
    const byUid = new Map<string, DestinatarioNotif>();
    for (const p of permitidos) {
      byUid.set(p.uid, p);
    }
    const uniq = [...byUid.values()];
    if (!uniq.length) return;

    const db = getAdminDb();
    const now = Timestamp.now();
    const colBase = (uid: string) =>
      db.collection(NOTIFICACIONES_COLLECTION).doc(uid).collection(NOTIFICACIONES_ITEMS_SUBCOLLECTION);

    let batch = db.batch();
    let n = 0;
    for (const d of uniq) {
      const ref = colBase(d.uid).doc();
      batch.set(ref, {
        ...notif,
        leida: false,
        creadoAt: now,
        pushEnviado: false,
      });
      n++;
      if (n >= 400) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) await batch.commit();

    const hrefRaw = (notif as { href?: string }).href?.trim();
    const otIdRaw = (notif as { otId?: string }).otId?.trim();
    const url =
      hrefRaw && hrefRaw.startsWith("/")
        ? hrefRaw
        : otIdRaw
          ? `/tareas/${otIdRaw}`
          : "/dashboard";

    void enviarPushSilencioso(uniq, {
      titulo: String((notif as { titulo?: string }).titulo ?? "Arauco-Seam"),
      cuerpo: String((notif as { cuerpo?: string }).cuerpo ?? ""),
      url,
    }).catch((e) => console.error("[crearNotificacion] push", e));
  } catch (e) {
    console.error("[crearNotificacion]", e);
  }
}

function normalizeRol(rol: Rol | string): Rol {
  return toPermisoRol(String(rol));
}

/** Alias para uso fire-and-forget desde server actions. */
export function crearNotificacionSeguro(
  destinatarios: DestinatarioNotif[],
  notif: Omit<Notificacion, "id" | "leida" | "creadoAt" | "pushEnviado"> | Record<string, unknown>,
): void {
  void crearNotificacion(destinatarios, notif);
}
