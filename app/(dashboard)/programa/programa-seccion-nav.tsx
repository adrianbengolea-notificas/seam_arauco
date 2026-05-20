"use client";

import { usePermisos } from "@/lib/permisos/usePermisos";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  /** Resalta «Programa semanal» aunque la ruta sea exactamente `/programa`. */
  vistaActual?: "grilla" | "correctivos" | "preventivos";
};

function tabClass(active: boolean) {
  return cn(
    "rounded-md px-2 py-1 transition-colors",
    active
      ? "bg-muted font-medium text-foreground"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  );
}

/** Subnavegación común del módulo Programa (grilla, correctivos, motor, preventivos). */
export function ProgramaSeccionNav({ vistaActual }: Props) {
  const pathname = usePathname();
  const { puede } = usePermisos();

  const enGrilla =
    vistaActual === "grilla" ||
    pathname === "/programa" ||
    (pathname?.startsWith("/programa") &&
      !pathname.startsWith("/programa/correctivos") &&
      !pathname.startsWith("/programa/aprobacion") &&
      !pathname.startsWith("/programa/preventivos") &&
      !pathname.startsWith("/programa/vencimientos") &&
      !pathname.startsWith("/programa/anual") &&
      !pathname.startsWith("/programa/cargar") &&
      !pathname.startsWith("/programa/seguimiento"));

  const enCorrectivos = vistaActual === "correctivos" || pathname?.startsWith("/programa/correctivos");
  const enPreventivos =
    vistaActual === "preventivos" ||
    pathname?.startsWith("/programa/preventivos") ||
    pathname?.startsWith("/programa/anual") ||
    pathname?.startsWith("/programa/vencimientos");

  const puedeCorrectivos = puede("programa:crear_ot") || puede("programa:editar");
  const puedePreventivos = puede("programa:ver_calendario_anual") || puede("programa:ver_vencimientos_sa");

  if (!puedeCorrectivos && !puedePreventivos) {
    return null;
  }

  return (
    <nav
      className="flex flex-wrap gap-2 border-b border-border pb-3 text-sm"
      aria-label="Secciones del programa semanal"
    >
      <Link href="/programa" className={tabClass(enGrilla)}>
        Programa semanal (grilla)
      </Link>
      {puedeCorrectivos ? (
        <>
          <span className="text-muted-foreground/70" aria-hidden>
            ·
          </span>
          <Link href="/programa/correctivos" className={tabClass(enCorrectivos)}>
            Correctivos
          </Link>
        </>
      ) : null}
      {puedePreventivos ? (
        <>
          <span className="text-muted-foreground/70" aria-hidden>
            ·
          </span>
          <Link href="/programa/preventivos" className={tabClass(enPreventivos)}>
            Planes preventivos
          </Link>
        </>
      ) : null}
    </nav>
  );
}
