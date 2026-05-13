"use client";

import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";

/**
 * Error boundary de segmento para el layout del dashboard (App Router).
 * Captura errores en cualquier page o componente dentro de (dashboard)
 * sin tumbar el chrome completo (sidebar, header).
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[40vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-lg font-semibold tracking-tight text-foreground">Algo salió mal</h1>
      <p className="text-sm text-muted-foreground">
        {error.message?.trim()
          ? mensajeErrorFirebaseParaUsuario(error)
          : "Error inesperado al mostrar esta vista."}
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground/60">ref: {error.digest}</p>
      )}
      <button
        type="button"
        className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted"
        onClick={() => reset()}
      >
        Reintentar
      </button>
    </div>
  );
}
