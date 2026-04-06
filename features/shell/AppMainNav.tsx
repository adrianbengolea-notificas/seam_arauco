"use client";

import { cn } from "@/lib/utils";
import { useCentroConfigLive } from "@/modules/centros/hooks";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { PermisoGuard } from "@/components/auth/PermisoGuard";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

const links = [
  { href: "/dashboard", label: "Panel", module: null as "materiales" | "activos" | null },
  { href: "/programa", label: "Programa", module: null },
  { href: "/tareas", label: "Tareas", module: null },
  { href: "/materiales", label: "Materiales", module: "materiales" as const },
  { href: "/activos", label: "Activos", module: "activos" as const },
] as const;

function pathMatches(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppMainNav() {
  const pathname = usePathname();
  const { user } = useAuthUser();
  const profileUid =
    pathname === "/login" || pathname?.startsWith("/login/") ? undefined : user?.uid;
  const { profile } = useUserProfile(profileUid);
  const { config: centroConfig } = useCentroConfigLive(profile?.centro);

  const navLinks = useMemo(() => {
    return links.filter((l) => {
      if (l.module === "materiales") return centroConfig.modulos.materiales;
      if (l.module === "activos") return centroConfig.modulos.activos;
      return true;
    });
  }, [centroConfig.modulos.activos, centroConfig.modulos.materiales]);

  const linkClass = (active: boolean) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150",
      active
        ? "bg-white/12 text-header-fg shadow-sm ring-1 ring-brand/40"
        : "text-header-muted hover:bg-white/8 hover:text-header-fg",
    );

  return (
    <nav className="order-3 flex w-full flex-wrap items-center justify-center gap-0.5 sm:order-none sm:flex-1">
      {navLinks.map((l) => {
        const active = pathMatches(l.href, pathname);
        return (
          <Link key={l.href} href={l.href} className={linkClass(active)}>
            {l.label}
          </Link>
        );
      })}
      <PermisoGuard permiso="admin:gestionar_usuarios">
        <Link
          href="/superadmin"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
            pathname?.startsWith("/superadmin")
              ? "bg-brand text-brand-foreground shadow-sm"
              : "text-header-muted ring-1 ring-white/15 hover:bg-white/10 hover:text-header-fg",
          )}
        >
          Superadmin
        </Link>
      </PermisoGuard>
      <PermisoGuard permiso="materiales:ingresar_stock">
        <Link
          href="/superadmin/materiales"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            pathname === "/superadmin/materiales"
              ? "bg-brand text-brand-foreground shadow-sm"
              : "text-header-muted ring-1 ring-white/15 hover:bg-white/10 hover:text-header-fg",
          )}
        >
          Inventario
        </Link>
      </PermisoGuard>
    </nav>
  );
}
