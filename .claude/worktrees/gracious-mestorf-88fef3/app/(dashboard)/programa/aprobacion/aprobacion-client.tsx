"use client";

import {
  actionAprobarItemsPropuestaMotor,
  actionRechazarItemPropuestaMotor,
} from "@/app/actions/schedule";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_CENTRO } from "@/lib/config/app-config";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import { usePropuestaMotorSemana } from "@/modules/scheduling/hooks";
import { getIsoWeekId } from "@/modules/scheduling/iso-week";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

export function AprobacionPropuestaClient() {
  const { user } = useAuthUser();
  const { profile } = useUserProfile(user?.uid);
  const { puede } = usePermisos();
  const puedeActuar = puede("programa:crear_ot");
  const semanaActual = useMemo(() => getIsoWeekId(new Date()), []);
  const centro = profile?.centro?.trim() || DEFAULT_CENTRO;
  const propuestaId = useMemo(() => propuestaSemanaDocId(centro, semanaActual), [centro, semanaActual]);

  const { propuesta, loading, error } = usePropuestaMotorSemana(
    puedeActuar ? propuestaId : undefined,
    user?.uid,
  );

  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setElegidos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const aprobar = useCallback(async () => {
    if (elegidos.size === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const token = await getClientIdToken();
      if (!token) throw new Error("Sin sesión");
      const res = await actionAprobarItemsPropuestaMotor(token, {
        propuestaId,
        itemIds: [...elegidos],
      });
      if (!res.ok) {
        setMsg(res.error?.message ?? "Error al aprobar");
        return;
      }
      setMsg(res.data.mensaje ?? `Listo: ${res.data.creadas.length} OT(s) nuevas · programa ${res.data.programaId}`);
      setElegidos(new Set());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [elegidos, propuestaId]);

  const rechazar = useCallback(
    async (itemId: string) => {
      setBusy(true);
      setMsg(null);
      try {
        const token = await getClientIdToken();
        if (!token) throw new Error("Sin sesión");
        const res = await actionRechazarItemPropuestaMotor(token, { propuestaId, itemId });
        if (!res.ok) setMsg(res.error?.message ?? "Error");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error");
      } finally {
        setBusy(false);
      }
    },
    [propuestaId],
  );

  if (!puedeActuar) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Acceso restringido</CardTitle>
          <CardDescription>Necesitás permisos de supervisor o administración para aprobar propuestas.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Aprobación de propuesta semanal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Semana <span className="font-mono">{semanaActual}</span> · Centro{" "}
            <span className="font-mono">{centro}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/programa">Volver al programa</Link>
        </Button>
      </div>

      {msg ? (
        <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm" role="status">
          {msg}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Cargando propuesta…</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}

      {!loading && !propuesta ? (
        <Card>
          <CardHeader>
            <CardTitle>Sin propuesta para esta semana</CardTitle>
            <CardDescription>
              Todavía no hay documento en{" "}
              <span className="font-mono">propuestas_semana/{propuestaId}</span>. Cuando el cron{" "}
              <span className="font-mono">motor-ot-diario</span> corra con <span className="font-mono">CRON_SECRET</span>
              , vas a ver los ítems acá.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {propuesta ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default" className="capitalize">
              {propuesta.status}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {propuesta.items?.filter((i) => i.status === "propuesta").length ?? 0} pendientes ·{" "}
              {propuesta.items?.length ?? 0} total
            </span>
          </div>

          {(propuesta.advertencias ?? []).length ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Advertencias del motor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 pt-0 text-sm text-muted-foreground">
                {propuesta.advertencias!.map((a, i) => (
                  <p key={i}>• {a}</p>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="space-y-2">
            {(propuesta.items ?? []).map((item) => {
              const selectable = item.status === "propuesta";
              const sel = elegidos.has(item.id);
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between",
                    sel && "ring-1 ring-primary/40",
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={item.prioridad === 1 ? "urgente" : item.prioridad === 2 ? "correctivo" : "preventivo"}>
                        P{item.prioridad}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">{item.dia_semana}</span>
                      <Badge variant={item.kind === "correctivo_existente" ? "correctivo" : "preventivo"}>
                        {item.kind === "correctivo_existente" ? "Correctivo" : "Preventivo"}
                      </Badge>
                      <Badge variant="default" className="capitalize">
                        {item.status}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      #{item.numero} · {item.descripcion.slice(0, 120)}
                      {item.descripcion.length > 120 ? "…" : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.razon_incluida}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {selectable ? (
                      <>
                        <Button type="button" size="sm" variant={sel ? "secondary" : "outline"} onClick={() => toggle(item.id)}>
                          {sel ? "Quitar" : "Seleccionar"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void rechazar(item.id)}
                        >
                          Rechazar
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" disabled={busy || elegidos.size === 0} onClick={() => void aprobar()}>
              Aprobar seleccionados ({elegidos.size})
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
