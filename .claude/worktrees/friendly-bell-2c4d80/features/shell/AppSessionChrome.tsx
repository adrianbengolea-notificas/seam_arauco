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
    <div className="flex max-w-full flex-nowrap items-center justify-end gap-1.5 sm:gap-2">
      {!hideAuth && user ? <NotificacionesBell /> : null}
      <AppHeaderAuth />
      {showPushBanner ? (
        <div className="flex max-w-[11rem] items-center gap-1 rounded-md border border-white/15 bg-white/5 px-1.5 py-1 sm:max-w-none sm:gap-1.5 sm:px-2">
          <p className="hidden text-[11px] leading-tight text-header-muted sm:inline">
            ¿Notificaciones push?
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 shrink-0 px-2 text-[10px] sm:text-[11px]"
            onClick={() => void onActivarPush()}
          >
            Activar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2 text-[10px] text-header-muted hover:text-header-fg sm:text-[11px]"
            onClick={() => void onMasTarde()}
          >
            Más tarde
          </Button>
        </div>
      ) : null}
    </div>
  );
}
