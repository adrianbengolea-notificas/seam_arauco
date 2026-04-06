"use client";

import { usePermisos } from "@/lib/permisos/usePermisos";
import Link from "next/link";

export function AppShellBrandLink() {
  const { rol } = usePermisos();
  const href = rol === "cliente_arauco" ? "/cliente" : "/dashboard";

  return (
    <Link
      href={href}
      className="group flex shrink-0 items-center gap-3 rounded-lg outline-none ring-0 transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--header-bg)]"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand font-mono text-sm font-bold text-brand-foreground shadow-sm"
        aria-hidden
      >
        AS
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-header-muted">
          Mantenimiento industrial
        </span>
        <span className="truncate text-sm font-bold tracking-tight text-header-fg">Arauco-Seam</span>
      </span>
    </Link>
  );
}
