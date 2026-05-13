"use client";

import { Button } from "@/components/ui/button";
import type { NotificacionTipo } from "@/lib/firestore/types";
import { cn } from "@/lib/utils";
import { useNotificaciones } from "@/modules/users/hooks";
import { useAuthUser } from "@/modules/users/hooks";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

function colorPorTipo(t: NotificacionTipo): string {
  switch (t) {
    case "ot_urgente_abierta":
      return "bg-red-500";
    case "ot_cerrada_firmada":
      return "bg-emerald-500";
    case "material_externo_cargado":
      return "bg-amber-500";
    case "comentario_nuevo":
    case "comentario_respondido":
      return "bg-blue-500";
    case "stock_bajo":
      return "bg-orange-500";
    case "ot_asignada":
      return "bg-violet-500";
    case "ot_vencida":
      return "bg-rose-600";
    case "propuesta_disponible":
      return "bg-sky-600";
    default:
      return "bg-zinc-400";
  }
}

function tiempoRelativo(ts: { toDate?: () => Date } | null | undefined): string {
  if (!ts?.toDate) return "—";
  try {
    const d = ts.toDate();
    return formatDistanceToNow(d, { addSuffix: true, locale: es });
  } catch {
    return "—";
  }
}

export function NotificacionesBell() {
  const { user } = useAuthUser();
  const router = useRouter();
  const { items, noLeidas, loading, marcarLeida, marcarTodasLeidas } = useNotificaciones(user?.uid);
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const badge = useMemo(() => {
    if (noLeidas <= 0) return null;
    if (noLeidas > 9) return "9+";
    return String(noLeidas);
  }, [noLeidas]);

  useEffect(() => {
    if (!abierto) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [abierto]);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative text-header-muted hover:bg-white/10 hover:text-header-fg"
        aria-label="Notificaciones"
        onClick={() => setAbierto((o) => !o)}
      >
        <Bell className="h-4 w-4" />
        {badge ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
            {badge}
          </span>
        ) : null}
      </Button>

      {abierto ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(100vw-2rem,22rem)] rounded-xl border border-white/15 bg-[var(--header-bg)] py-2 shadow-xl ring-1 ring-black/10">
          <div className="flex items-center justify-between border-b border-white/10 px-3 pb-2">
            <p className="text-xs font-semibold text-header-fg">Notificaciones</p>
            {loading ? <span className="text-[10px] text-header-muted">…</span> : null}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!items.length && !loading ? (
              <p className="px-3 py-6 text-center text-sm text-header-muted">Todo al día</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full gap-2 px-3 py-2.5 text-left transition hover:bg-white/8",
                        !n.leida ? "bg-white/5" : "",
                      )}
                      onClick={() => {
                        marcarLeida(n.id);
                        setAbierto(false);
                        if (n.otId) router.push(`/tareas/${n.otId}`);
                      }}
                    >
                      <span
                        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", colorPorTipo(n.tipo))}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-1.5">
                          {!n.leida ? (
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden />
                          ) : (
                            <span className="w-1.5 shrink-0" aria-hidden />
                          )}
                          <span className="text-[14px] font-medium leading-snug text-header-fg">{n.titulo}</span>
                        </span>
                        <span className="mt-0.5 block pl-3 text-[12px] text-header-muted">{n.cuerpo}</span>
                        <span className="mt-1 block pl-3 text-[11px] text-header-muted/80">
                          {tiempoRelativo(n.creadoAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {items.length ? (
            <div className="border-t border-white/10 px-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-xs text-header-muted hover:bg-white/10 hover:text-header-fg"
                onClick={() => marcarTodasLeidas()}
              >
                Marcar todas como leídas
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
