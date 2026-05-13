"use client";

import { cn } from "@/lib/utils";
import { usePermisos } from "@/lib/permisos/usePermisos";
import Link from "next/link";

const focusRing =
  "outline-none ring-0 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--header-bg)]";

export function AppShellBrandLink({ variant = "header" }: { variant?: "header" | "sidebar" }) {
  const { rol } = usePermisos();
  const href = rol === "cliente_arauco" ? "/cliente" : "/dashboard";

  if (variant === "sidebar") {
    return (
      <Link
        href={href}
        className={cn(
          "group shrink-0 border-b border-white/10 px-4 py-4 transition-opacity hover:opacity-95",
          focusRing,
        )}
      >
        <span className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand font-mono text-sm font-bold text-brand-foreground shadow-sm"
            aria-hidden
          >
            AS
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-header-muted">
              Mantenimiento industrial
            </span>
            <span className="truncate text-sm font-bold tracking-tight text-header-fg">Arauco-Seam</span>
          </span>
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "group flex shrink-0 items-center gap-3 rounded-lg transition-opacity hover:opacity-95",
        focusRing,
      )}
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
