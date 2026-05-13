"use client";

import { actionBootstrapSession } from "@/app/actions/auth";
import { useAuthUser } from "@/modules/users/hooks";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

const PUBLIC_PREFIXES = ["/login"];

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading: authLoading } = useAuthUser();
  const [profileReady, setProfileReady] = useState(false);
  const lastBootstrapUid = useRef<string | null>(null);

  const publicRoute = isPublicPath(pathname);

  useEffect(() => {
    if (publicRoute || authLoading) {
      return;
    }
    if (!user) {
      lastBootstrapUid.current = null;
      setProfileReady(false);
      const next = pathname && pathname !== "/" ? pathname : "/dashboard";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [publicRoute, authLoading, user, pathname, router]);

  useEffect(() => {
    if (publicRoute) {
      setProfileReady(true);
      return;
    }
    if (authLoading) {
      return;
    }
    if (!user) {
      setProfileReady(false);
      return;
    }

    if (lastBootstrapUid.current === user.uid) {
      setProfileReady(true);
      return;
    }

    let cancelled = false;
    setProfileReady(false);

    void (async () => {
      try {
        let token = await user.getIdToken(true);
        let res = await actionBootstrapSession(token);
        if (!res.ok && res.error.code === "UNAUTHORIZED") {
          token = await user.getIdToken(true);
          res = await actionBootstrapSession(token);
        }
        if (!res.ok) {
          const { code, message } = res.error;
          console.warn("[Arauco-Seam] bootstrap falló", `${code}: ${message || "(sin mensaje)"}`);
        } else {
          await user.getIdToken(true);
          lastBootstrapUid.current = user.uid;
        }
      } finally {
        if (!cancelled) {
          setProfileReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicRoute, authLoading, user]);

  if (publicRoute) {
    return <>{children}</>;
  }

  if (authLoading || !user || !profileReady) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center gap-5 px-4">
        <div className="relative flex h-14 w-14 items-center justify-center" aria-hidden>
          <div className="absolute inset-0 rounded-full border-2 border-stone-200 dark:border-stone-600" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-brand border-r-brand/50" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">Preparando sesión</p>
          <p className="mt-1 text-xs text-muted">Sincronizando perfil y permisos…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
