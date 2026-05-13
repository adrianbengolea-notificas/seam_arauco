"use client";

import { cn } from "@/lib/utils";
import { useCentroConfigLive } from "@/modules/centros/hooks";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { PermisoGuard } from "@/components/auth/PermisoGuard";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { AppShellBrandLink } from "@/features/shell/AppShellBrandLink";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

type NavLink = {
  href: string;
  label: string;
  module: "materiales" | "activos" | null;
};

const links: NavLink[] = [
  { href: "/dashboard", label: "Panel", module: null },
  { href: "/programa", label: "Programa", module: null },
  { href: "/tareas", label: "Órdenes de trabajo", module: null },
  { href: "/materiales", label: "Materiales", module: "materiales" },
  { href: "/activos", label: "Activos", module: "activos" },
];

function pathMatches(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/cliente") return pathname === "/cliente" || pathname.startsWith("/cliente/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

type AppSidebarProps = {
  mobileOpen: boolean;
  onNavigate?: () => void;
};

export function AppSidebar({ mobileOpen, onNavigate }: AppSidebarProps) {
  const pathname = usePathname();
  const { user } = useAuthUser();
  const { rol, puede } = usePermisos();
  const showSistemaNav =
    puede("admin:gestionar_usuarios") ||
    puede("admin:cargar_programa") ||
    puede("materiales:ingresar_stock");
  const profileUid =
    pathname === "/login" || pathname?.startsWith("/login/") ? undefined : user?.uid;
  const { profile } = useUserProfile(profileUid);
  const { config: centroConfig } = useCentroConfigLive(profile?.centro);

  const navLinks = useMemo(() => {
    let list = links.filter((l) => {
      if (l.module === "materiales") return centroConfig.modulos.materiales;
      if (l.module === "activos") return centroConfig.modulos.activos;
      return true;
    });
    if (rol === "cliente_arauco") {
      list = list
        .filter((l) => l.href !== "/materiales")
        .map((l) => (l.href === "/dashboard" ? { ...l, href: "/cliente", label: "Inicio" } : l));
    }
    if (rol === "tecnico") {
      list = list.filter((l) => l.module !== "materiales" && l.module !== "activos");
    }
    return list;
  }, [centroConfig.modulos.activos, centroConfig.modulos.materiales, rol]);

  const mainHrefSet = new Set(["/dashboard", "/cliente", "/programa", "/tareas"]);
  const mainLinks = navLinks.filter((l) => mainHrefSet.has(l.href));
  const mainLinksNav = useMemo(() => {
    if (rol !== "tecnico") return mainLinks;
    const byHref = Object.fromEntries(mainLinks.map((l) => [l.href, l]));
    return ["/dashboard", "/tareas", "/programa"]
      .map((h) => byHref[h])
      .filter((l): l is NavLink => Boolean(l));
  }, [mainLinks, rol]);
  const moduleLinks = navLinks.filter((l) => !mainHrefSet.has(l.href));

  const itemClass = (active: boolean) =>
    cn(
      "block w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
      active
        ? "bg-white/12 text-header-fg shadow-sm ring-1 ring-brand/40"
        : "text-header-muted hover:bg-white/8 hover:text-header-fg",
    );

  const adminItemClass = (active: boolean, emphasized?: boolean) =>
    cn(
      "block w-full rounded-lg px-3 py-2.5 text-sm transition-colors duration-150",
      emphasized ? "font-semibold" : "font-medium",
      active
        ? "bg-brand text-brand-foreground shadow-sm"
        : "text-header-muted ring-1 ring-white/12 hover:bg-white/10 hover:text-header-fg",
    );

  return (
    <aside
      id="app-sidebar-nav"
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-[16rem] flex-col border-r border-white/10 bg-header text-header-fg shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none",
        "md:relative md:inset-auto md:z-auto md:h-auto md:min-h-screen md:w-[15.5rem] md:translate-x-0 md:self-stretch md:shadow-none",
        mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
      )}
    >
      <div className="h-0.5 w-full shrink-0 bg-brand" aria-hidden />
      <div
        className="flex min-h-0 flex-1 flex-col"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) onNavigate?.();
        }}
      >
        <AppShellBrandLink variant="sidebar" />
        <nav
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3 md:py-4"
          aria-label="Navegación principal"
        >
        <div className="space-y-1">
          {mainLinksNav.map((l) => {
            const active = pathMatches(l.href, pathname);
            return (
              <Link key={l.href} href={l.href} className={itemClass(active)}>
                {l.label}
              </Link>
            );
          })}
          <PermisoGuard permiso="programa:ver">
            <Link
              href="/programa/vencimientos"
              className={itemClass(Boolean(pathname?.startsWith("/programa/vencimientos")))}
            >
              Vencimientos S/A
            </Link>
          </PermisoGuard>
        </div>

        {moduleLinks.length > 0 ? (
          <div className="mt-4 space-y-1 border-t border-white/10 pt-4">
            <p className="px-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-header-muted">
              Módulos
            </p>
            {moduleLinks.map((l) => {
              const active = pathMatches(l.href, pathname);
              return (
                <Link key={l.href} href={l.href} className={itemClass(active)}>
                  {l.label}
                </Link>
              );
            })}
          </div>
        ) : null}

        {showSistemaNav ? (
          <div className="mt-4 space-y-1 border-t border-white/10 pt-4">
            <p className="px-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-header-muted">
              Sistema
            </p>
            {(puede("admin:gestionar_usuarios") || puede("admin:cargar_programa")) ? (
              <Link
                href="/superadmin/configuracion"
                className={adminItemClass(Boolean(pathname?.startsWith("/superadmin/configuracion")), true)}
              >
                Configuración general
              </Link>
            ) : null}
            {puede("admin:gestionar_usuarios") ? (
              <Link
                href="/superadmin"
                className={adminItemClass(
                  Boolean(pathname?.startsWith("/superadmin")) && !pathname?.startsWith("/superadmin/configuracion"),
                )}
              >
                Panel Superadmin
              </Link>
            ) : null}
            <PermisoGuard permiso="materiales:ingresar_stock">
              <Link
                href="/superadmin/materiales"
                className={adminItemClass(pathname === "/superadmin/materiales")}
              >
                Inventario
              </Link>
            </PermisoGuard>
          </div>
        ) : null}
        </nav>
      </div>
    </aside>
  );
}
