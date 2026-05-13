"use client";

import { agregarComentario, marcarComentariosLeidos } from "@/app/actions/comentarios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { Comentario } from "@/lib/firestore/types";
import { cn } from "@/lib/utils";
import { useComentariosOT } from "@/modules/work-orders/hooks";
import { getClientIdToken } from "@/modules/users/hooks";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useCallback, useEffect, useMemo, useState } from "react";

function badgeRol(rol: string): { label: string; className: string } {
  if (rol === "cliente_arauco") {
    return { label: "Cliente Arauco", className: "border-emerald-600/40 bg-emerald-600/12 text-emerald-900 dark:text-emerald-100" };
  }
  if (rol === "supervisor") {
    return { label: "Supervisor", className: "border-blue-600/40 bg-blue-600/12 text-blue-950 dark:text-blue-100" };
  }
  if (rol === "admin" || rol === "superadmin") {
    return { label: rol === "superadmin" ? "Superadmin" : "Admin", className: "border-violet-600/40 bg-violet-600/12 text-violet-950 dark:text-violet-100" };
  }
  return { label: "Técnico", className: "border-zinc-400/40 bg-zinc-500/12 text-zinc-800 dark:text-zinc-200" };
}

function tiempo(ts: Comentario["creadoAt"]): string {
  try {
    const d = ts.toDate();
    return formatDistanceToNow(d, { addSuffix: true, locale: es });
  } catch {
    return "—";
  }
}

type Props = {
  otId: string;
  viewerUid: string | undefined;
  puedeComentar: boolean;
  esCliente: boolean;
};

export function WorkOrderComentariosSection({ otId, viewerUid, puedeComentar, esCliente }: Props) {
  const { comentarios, loading, error } = useComentariosOT(otId);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [respondiendoA, setRespondiendoA] = useState<string | undefined>();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!viewerUid || !otId) return;
    let cancelled = false;
    void (async () => {
      const t = await getClientIdToken();
      if (!t || cancelled) return;
      await marcarComentariosLeidos(t, otId);
    })();
    return () => {
      cancelled = true;
    };
  }, [otId, viewerUid]);

  const porId = useMemo(() => {
    const m = new Map<string, Comentario>();
    for (const c of comentarios) m.set(c.id, c);
    return m;
  }, [comentarios]);

  const enviar = useCallback(async () => {
    const t = await getClientIdToken();
    if (!t) {
      setMsg("Sin sesión");
      return;
    }
    const tx = texto.trim();
    if (!tx) return;
    setEnviando(true);
    setMsg(null);
    try {
      const res = await agregarComentario(t, otId, { texto: tx, respondidoA: respondiendoA });
      if (!res.ok) {
        setMsg(res.error.message);
        return;
      }
      setTexto("");
      setRespondiendoA(undefined);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setEnviando(false);
    }
  }, [otId, texto, respondiendoA]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comentarios</CardTitle>
        <CardDescription>
          {loading ? "Cargando…" : error ? error.message : `${comentarios.length} mensajes`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {esCliente ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100">
            Estás viendo esta OT como Cliente Arauco. Solo podés agregar comentarios.
          </div>
        ) : null}
        {msg ? <p className="text-sm text-red-600">{msg}</p> : null}

        <ul className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
          {comentarios.map((c) => {
            const propio = c.autorId === viewerUid;
            const badge = badgeRol(c.autorRol);
            const cita = c.respondidoA ? porId.get(c.respondidoA) : undefined;
            return (
              <li
                key={c.id}
                className={cn("flex flex-col gap-1", propio ? "items-end" : "items-start")}
              >
                <div
                  className={cn(
                    "max-w-[min(100%,28rem)] rounded-2xl px-3 py-2 text-sm shadow-sm",
                    propio
                      ? "rounded-br-sm bg-blue-600/15 text-foreground ring-1 ring-blue-600/25"
                      : "rounded-bl-sm bg-zinc-100 text-foreground ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800",
                  )}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex rounded border px-1.5 py-0 text-[10px] font-semibold uppercase",
                        badge.className,
                      )}
                    >
                      {badge.label}
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">{c.autorNombre}</span>
                  </div>
                  {cita ? (
                    <p className="mb-1 truncate border-l-2 border-zinc-400 pl-2 text-xs italic text-muted-foreground">
                      {cita.texto}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap leading-relaxed">{c.texto}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 px-1">
                  <span className="text-[11px] text-muted-foreground">{tiempo(c.creadoAt)}</span>
                  {!propio && puedeComentar ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => setRespondiendoA(c.id)}
                    >
                      Responder
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {puedeComentar ? (
          <div className="space-y-2 border-t border-border pt-4">
            {respondiendoA ? (
              <p className="text-xs text-muted-foreground">
                Respondiendo al mensaje ·{" "}
                <button type="button" className="underline" onClick={() => setRespondiendoA(undefined)}>
                  Cancelar
                </button>
              </p>
            ) : null}
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Escribí un comentario..."
              className="min-h-[88px] resize-y"
            />
            <Button type="button" disabled={!texto.trim() || enviando} onClick={() => void enviar()}>
              {enviando ? "Enviando…" : "Enviar"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
