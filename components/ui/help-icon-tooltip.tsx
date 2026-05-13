"use client";

import { cn } from "@/lib/utils";
import { CircleHelp, Info } from "lucide-react";
import type { ReactNode } from "react";

type HelpIconTooltipProps = {
  /** Etiqueta accesible del botón de ayuda */
  ariaLabel: string;
  children: ReactNode;
  /** `info`: icono "i" en círculo; `help`: icono de interrogación (por defecto) */
  variant?: "help" | "info";
  /** Clases en el contenedor del botón (p. ej. alinear con un título) */
  className?: string;
  /** Clases extra para el panel (p. ej. alinear a la izquierda: `left-0 right-auto`) */
  panelClassName?: string;
};

export function HelpIconTooltip({
  ariaLabel,
  children,
  variant = "help",
  className,
  panelClassName,
}: HelpIconTooltipProps) {
  const Icon = variant === "info" ? Info : CircleHelp;
  return (
    <span
      className={cn(
        // Por encima de bloques con z-20 (p. ej. selector de pestañas en /programa) para que el panel
        // no quede debajo y se “mezcle” con el contenido.
        "group relative z-[100] inline-flex shrink-0",
        className,
      )}
    >
      <button
        type="button"
        className="rounded-full p-0.5 text-zinc-500 outline-none ring-offset-background hover:text-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:hover:text-zinc-300 dark:focus-visible:ring-zinc-500"
        aria-label={ariaLabel}
      >
        <Icon className="h-4 w-4" aria-hidden strokeWidth={2} />
      </button>
      <div
        role="tooltip"
        className={cn(
          "pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto invisible absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2.5rem))] rounded-lg border border-border bg-surface px-3 py-2.5 text-xs font-normal leading-relaxed text-foreground shadow-md opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 dark:border-zinc-700 dark:bg-zinc-950",
          panelClassName,
        )}
      >
        {children}
      </div>
    </span>
  );
}
