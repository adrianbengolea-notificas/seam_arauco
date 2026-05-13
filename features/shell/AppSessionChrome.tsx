"use client";

import { PushOptInBanner } from "@/components/notificaciones/PushOptInBanner";
import { AppHeaderAuth } from "@/features/shell/AppHeaderAuth";
import { NotificacionesBell } from "@/components/notificaciones/NotificacionesBell";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { usePathname } from "next/navigation";

export function AppSessionChrome() {
  const pathname = usePathname();
  const { user } = useAuthUser();
  const profileUid =
    pathname === "/login" || pathname?.startsWith("/login/") ? undefined : user?.uid;
  const { profile } = useUserProfile(profileUid);

  const hideAuth = pathname === "/login";
  /** Grilla programa; detalle de OT (acción principal abajo); el CTA también vive en /perfil. */
  const hidePushInChrome =
    pathname === "/programa" || Boolean(pathname?.startsWith("/tareas/"));
  const showPushBanner =
    !hideAuth &&
    Boolean(user) &&
    Boolean(profile) &&
    profile?.pushHabilitado === undefined &&
    !hidePushInChrome;

  return (
    <div className="flex max-w-full flex-nowrap items-center justify-end gap-1.5 sm:gap-2">
      {!hideAuth && user ? <NotificacionesBell /> : null}
      <AppHeaderAuth />
      {showPushBanner ? <PushOptInBanner key={user?.uid} variant="compact" /> : null}
    </div>
  );
}
