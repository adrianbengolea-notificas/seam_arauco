"use client";

import { actionPushMasTarde } from "@/app/actions/push";
import { Button } from "@/components/ui/button";
import { solicitarPermisoPush } from "@/lib/notificaciones/push";
import { getClientIdToken } from "@/modules/users/hooks";
import { useState } from "react";

type Props = {
  /** Texto intro compacto (banner en header vs. card en perfil). */
  variant?: "compact" | "comfortable";
  className?: string;
};

export function PushOptInBanner({ variant = "compact", className }: Props) {
  const [dismissed, setDismissed] = useState(false);

  async function onActivarPush() {
    const ok = await solicitarPermisoPush();
    if (!ok) setDismissed(true);
  }

  async function onMasTarde() {
    const t = await getClientIdToken();
    if (t) await actionPushMasTarde(t);
    setDismissed(true);
  }

  if (dismissed) return null;

  const isComfortable = variant === "comfortable";

  return (
    <div
      className={
        isComfortable
          ? `flex flex-col gap-2 rounded-xl border border-border bg-muted/20 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${className ?? ""}`
          : `flex max-w-[11rem] items-center gap-1 rounded-md border border-white/15 bg-white/5 px-1.5 py-1 sm:max-w-none sm:gap-1.5 sm:px-2 ${className ?? ""}`
      }
    >
      {isComfortable ? (
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">Notificaciones en el navegador</p>
          <p className="text-muted-foreground leading-relaxed">
            Activá avisos push para enterarte de tareas y novedades aunque no tengas la pestaña abierta. Podés
            cambiarlo después en la configuración del navegador.
          </p>
        </div>
      ) : (
        <p className="hidden text-[11px] leading-tight text-header-muted sm:inline">¿Notificaciones push?</p>
      )}
      <div className={isComfortable ? "flex flex-wrap gap-2" : "flex items-center gap-1"}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={isComfortable ? "shrink-0" : "h-7 shrink-0 px-2 text-[10px] sm:text-[11px]"}
          onClick={() => void onActivarPush()}
        >
          Activar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={
            isComfortable
              ? "shrink-0 text-muted-foreground"
              : "h-7 shrink-0 px-2 text-[10px] text-header-muted hover:text-header-fg sm:text-[11px]"
          }
          onClick={() => void onMasTarde()}
        >
          Más tarde
        </Button>
      </div>
    </div>
  );
}
