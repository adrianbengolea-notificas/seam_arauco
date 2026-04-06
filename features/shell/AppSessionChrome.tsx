"use client";

import { actionPushMasTarde } from "@/app/actions/push";
import { AppHeaderAuth } from "@/features/shell/AppHeaderAuth";
import { NotificacionesBell } from "@/components/notificaciones/NotificacionesBell";
import { Button } from "@/components/ui/button";
import { solicitarPermisoPush } from "@/lib/notificaciones/push";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function AppSessionChrome() {
  const pathname = usePathname();
  const { user } = useAuthUser();
  const profileUid =
    pathname === "/login" || pathname?.startsWith("/login/") ? undefined : user?.uid;
  const { profile } = useUserProfile(profileUid);
  const [pushDismiss, setPushDismiss] = useState(false);

  useEffect(() => {
    setPushDismiss(false);
  }, [user?.uid]);

  const hideAuth = pathname === "/login";
  const showPushBanner =
    !hideAuth &&
    Boolean(user) &&
    Boolean(profile) &&
    profile?.pushHabilitado === undefined &&
    !pushDismiss;

  async function onActivarPush() {
    const ok = await solicitarPermisoPush();
    if (!ok) setPushDismiss(true);
  }

  async function onMasTarde() {
    const t = await getClientIdToken();
    if (t) await actionPushMasTarde(t);
    setPushDismiss(true);
  }

  return (
    <div className="ml-auto flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-2">
      {!hideAuth && user ? <NotificacionesBell /> : null}
      {showPushBanner ? (
        <div className="order-first flex max-w-sm flex-wrap items-center justify-end gap-2 rounded-md border border-white/15 bg-white/5 px-2 py-1.5 sm:order-none sm:max-w-none">
          <p className="text-[11px] text-header-muted">¿Recibir notificaciones de eventos?</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 text-[11px]"
            onClick={() => void onActivarPush()}
          >
            Activar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-[11px] text-header-muted hover:text-header-fg"
            onClick={() => void onMasTarde()}
          >
            Más tarde
          </Button>
        </div>
      ) : null}
      <AppHeaderAuth />
    </div>
  );
}
