"use client";

import { Button } from "@/components/ui/button";
import { getFirebaseAuth } from "@/firebase/firebaseClient";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { useMemo } from "react";

function initialFromUser(displayName: string | undefined, email: string | null | undefined): string {
  const n = displayName?.trim();
  if (n) return n.charAt(0).toUpperCase();
  const e = email?.trim();
  if (e) return e.charAt(0).toUpperCase();
  return "?";
}

export function AppHeaderAuth() {
  const pathname = usePathname();
  const { user, loading } = useAuthUser();
  const profileUid =
    pathname === "/login" || pathname?.startsWith("/login/") ? undefined : user?.uid;
  const { profile } = useUserProfile(profileUid);
  const hideAuth = pathname === "/login";

  const initial = useMemo(
    () => initialFromUser(profile?.display_name, user?.email ?? null),
    [profile?.display_name, user?.email],
  );

  async function signOut() {
    await getFirebaseAuth().signOut();
    window.location.href = "/login";
  }

  if (hideAuth) {
    return null;
  }

  if (loading) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-header-muted" aria-live="polite">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-brand" />
        Sesión…
      </span>
    );
  }

  if (!user) {
    return (
      <Button
        asChild
        size="sm"
        variant="outline"
        className="border-white/35 bg-transparent text-header-fg hover:bg-white/10 hover:text-header-fg"
      >
        <Link href="/login">Entrar</Link>
      </Button>
    );
  }

  const emailTitle = user.email ?? user.uid;

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <Link
        href="/perfil"
        className="group flex items-center gap-2 rounded-lg py-1 pr-1.5 pl-1 outline-none ring-0 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--header-bg)]"
        title={emailTitle}
        aria-label={`Perfil — ${emailTitle}`}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground shadow-sm"
          aria-hidden
        >
          {initial}
        </span>
        <span className="hidden text-xs font-medium text-header-muted group-hover:text-header-fg sm:inline">
          Perfil
        </span>
      </Link>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 gap-1 px-2 text-header-muted hover:bg-white/8 hover:text-header-fg sm:px-2.5"
        onClick={() => void signOut()}
        title="Cerrar sesión"
      >
        <LogOut className="h-3.5 w-3.5 opacity-80" aria-hidden />
        <span className="hidden sm:inline">Salir</span>
      </Button>
    </div>
  );
}
