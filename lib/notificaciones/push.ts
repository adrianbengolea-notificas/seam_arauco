"use client";

import { actionGuardarPushSubscription } from "@/app/actions/push";
import { getClientIdToken } from "@/modules/users/hooks";

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Solicita permiso de notificaciones, registra SW y persiste la suscripción (Admin SDK vía action).
 */
export async function solicitarPermisoPush(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;

  const vapid = process.env.NEXT_PUBLIC_VAPID_KEY?.trim();
  if (!vapid) {
    console.warn("[push] Falta NEXT_PUBLIC_VAPID_KEY");
    return false;
  }

  try {
    await navigator.serviceWorker.register("/sw.js");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    });
    const json = sub.toJSON() as Record<string, unknown>;
    const token = await getClientIdToken();
    if (!token) return false;
    const res = await actionGuardarPushSubscription(token, {
      subscription: json as { endpoint: string; expirationTime?: number | null; keys?: { p256dh: string; auth: string } },
      pushHabilitado: true,
    });
    return res.ok;
  } catch (e) {
    console.error("[push]", e);
    return false;
  }
}
