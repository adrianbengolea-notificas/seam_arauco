"use client";

import { actionAddAvisoToProgramaPublicado } from "@/app/actions/schedule";
import { DEFAULT_CENTRO } from "@/lib/config/app-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PermisoGuard } from "@/components/auth/PermisoGuard";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { cn } from "@/lib/utils";
import type { AvisoConVencimiento } from "@/modules/scheduling/hooks";
import { useAvisosVencimientos } from "@/modules/scheduling/hooks";
import { getIsoWeekId } from "@/modules/scheduling/iso-week";
import type { DiaSemanaPrograma } from "@/modules/scheduling/types";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

const DIAS_PROG: { value: DiaSemanaPrograma; label: string }[] = [
  { value: "lunes", label: "Lunes" },
  { value: "martes", label: "Martes" },
  { value: "miercoles", label: "Miércoles" },
  { value: "jueves", label: "Jueves" },
  { value: "viernes", label: "Viernes" },
  { value: "sabado", label: "Sábado" },
];

function badgeEstado(a: AvisoConVencimiento) {
  const dias = a.dias_para_vencimiento_live;
  if (!a.ultima_ejecucion_fecha) {
    return (
      <Badge variant="default" className="bg-muted text-muted-foreground">
        Nunca ejecutado
      </Badge>
    );
  }
  if (a.estado_vencimiento_live === "vencido" && dias !== undefined) {
    return (
      <Badge className="border border-destructive/50 bg-destructive/15 text-destructive">
        VENCIDO hace {Math.abs(dias)} días
      </Badge>
    );
  }
  if (a.estado_vencimiento_live === "proximo" && dias !== undefined) {
    return (
      <Badge className="border border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-100">
        Vence en {dias} días
      </Badge>
    );
  }
  if (a.proximo_vencimiento) {
    try {
      const f = format(a.proximo_vencimiento.toDate(), "dd/MM/yyyy", { locale: es });
      return (
        <Badge variant="default" className="bg-muted text-muted-foreground">
          Vence el {f}
        </Badge>
      );
    } catch {
      /* empty */
    }
  }
  return (
    <Badge variant="default" className="bg-muted">
      OK
    </Badge>
  );
}

export function VencimientosClient() {
  const { user } = useAuthUser();
  const { profile } = useUserProfile(user?.uid);
  const { puede, rol } = usePermisos();
  const sp = useSearchParams();
  const urlFilter = sp.get("filter");

  const superadmin = rol === "superadmin";
  /** Centro del perfil; fallback al default de app para no disparar consulta global sin filtro (operarios). */
  const centro = profile?.centro?.trim() || DEFAULT_CENTRO;

  const [tab, setTab] = useState<"seguimiento" | "sin_historial">("seguimiento");
  const [esp, setEsp] = useState<"todos" | "AA" | "E">("todos");
  const [estadoF, setEstadoF] = useState<"todos" | "vencido" | "proximo" | "ok">(
    urlFilter === "vencido" || urlFilter === "proximo" ? (urlFilter as "vencido" | "proximo") : "todos",
  );
  const [freq, setFreq] = useState<"todos" | "S" | "A">("todos");
  const [centroF, setCentroF] = useState<string>("");

  const { avisos, loading, error } = useAvisosVencimientos({
    authUid: user?.uid,
    centro,
    verTodosLosCentros: superadmin,
  });

  const centrosOpts = useMemo(() => {
    const s = new Set<string>();
    for (const a of avisos) {
      if (a.centro?.trim()) s.add(a.centro.trim());
    }
    return [...s].sort();
  }, [avisos]);

  const filtrados = useMemo(() => {
    let rows = avisos;
    if (superadmin && centroF.trim()) {
      rows = rows.filter((a) => a.centro === centroF.trim());
    }
    if (esp === "AA") rows = rows.filter((a) => a.especialidad === "AA");
    if (esp === "E") rows = rows.filter((a) => a.especialidad === "ELECTRICO" || a.especialidad === "HG");
    if (freq === "S") rows = rows.filter((a) => a.frecuencia_plan_mtsa === "S");
    if (freq === "A") rows = rows.filter((a) => a.frecuencia_plan_mtsa === "A");

    if (tab === "sin_historial") {
      rows = rows.filter((a) => !a.ultima_ejecucion_fecha);
    } else {
      if (estadoF === "vencido") rows = rows.filter((a) => a.estado_vencimiento_live === "vencido");
      else if (estadoF === "proximo") rows = rows.filter((a) => a.estado_vencimiento_live === "proximo");
      else if (estadoF === "ok") rows = rows.filter((a) => a.estado_vencimiento_live === "ok");
    }
    return rows;
  }, [avisos, centroF, esp, estadoF, freq, tab, superadmin]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [pick, setPick] = useState<AvisoConVencimiento | null>(null);
  const [weekId, setWeekId] = useState(() => getIsoWeekId(new Date()));
  const [diaPick, setDiaPick] = useState<DiaSemanaPrograma>("lunes");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const openAgregar = (a: AvisoConVencimiento) => {
    setPick(a);
    setWeekId(getIsoWeekId(new Date()));
    setDiaPick("lunes");
    setMsg(null);
    setDialogOpen(true);
  };

  const agregarPrograma = useCallback(async () => {
    if (!pick) return;
    setBusy(true);
    setMsg(null);
    try {
      const tok = await getClientIdToken();
      if (!tok) throw new Error("Sin sesión");
      const res = await actionAddAvisoToProgramaPublicado(tok, {
        weekId,
        avisoFirestoreId: pick.id,
        dia: diaPick,
        localidad: pick.ubicacion_tecnica,
      });
      if (!res.ok) throw new Error(res.error.message);
      setMsg("Aviso agregado al programa publicado.");
      setDialogOpen(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [pick, weekId, diaPick]);

  if (!puede("programa:ver")) {
    return <p className="text-sm text-muted-foreground">No tenés permiso para ver esta página.</p>;
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Programa</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Vencimientos preventivos S/A</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {puede("programa:crear_ot") ? (
            <>
              Priorizá semestrales y anuales según urgencia, agregalos a la grilla publicada o abrí una OT nueva.
            </>
          ) : (
            <>
              Consultá el estado de preventivos semestrales y anuales de tu centro (vencidos, próximos y al día). Las
              acciones de carga en programa las realizan supervisión o administración.
            </>
          )}
        </p>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        <Button
          type="button"
          variant={tab === "seguimiento" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("seguimiento")}
        >
          Seguimiento
        </Button>
        <Button
          type="button"
          variant={tab === "sin_historial" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("sin_historial")}
        >
          Sin historial
        </Button>
      </div>

      {tab === "sin_historial" ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Avisos sin registro de ejecución</CardTitle>
            <CardDescription>
              Estos avisos no tienen registro de ejecución en el sistema. Al cerrar la primera OT para cada uno,
              comenzará el seguimiento automático de vencimientos.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Especialidad
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={esp}
            onChange={(e) => setEsp(e.target.value as typeof esp)}
          >
            <option value="todos">Todos</option>
            <option value="AA">AA</option>
            <option value="E">Eléctrico</option>
          </select>
        </label>
        {tab === "seguimiento" ? (
          <label className="flex flex-col gap-1 text-xs font-medium">
            Estado
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={estadoF}
              onChange={(e) => setEstadoF(e.target.value as typeof estadoF)}
            >
              <option value="todos">Todos</option>
              <option value="vencido">Vencidos</option>
              <option value="proximo">Próximos (≤30 días)</option>
              <option value="ok">OK</option>
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs font-medium">
          Frecuencia
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={freq}
            onChange={(e) => setFreq(e.target.value as typeof freq)}
          >
            <option value="todos">Todos</option>
            <option value="S">Semestral</option>
            <option value="A">Anual</option>
          </select>
        </label>
        {superadmin ? (
          <label className="flex flex-col gap-1 text-xs font-medium">
            Centro
            <select
              className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
              value={centroF}
              onChange={(e) => setCentroF(e.target.value)}
            >
              <option value="">Todos</option>
              {centrosOpts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="self-end text-xs text-muted-foreground">
            Centro: <span className="font-mono">{centro || "—"}</span>
          </p>
        )}
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
      {msg ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{msg}</p> : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Aviso</th>
              <th className="px-3 py-2 font-medium">Descripción</th>
              <th className="px-3 py-2 font-medium">Ubicación</th>
              <th className="px-3 py-2 font-medium">Última ejec.</th>
              <th className="px-3 py-2 font-medium">Próx. venc.</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtrados.map((a) => (
              <tr key={a.id} className="hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{a.n_aviso}</td>
                <td className="max-w-[240px] px-3 py-2 text-muted-foreground">{a.texto_corto}</td>
                <td className="px-3 py-2 text-xs">{a.ubicacion_tecnica}</td>
                <td className="px-3 py-2 text-xs">
                  {a.ultima_ejecucion_fecha
                    ? format(a.ultima_ejecucion_fecha.toDate(), "dd/MM/yyyy", { locale: es })
                    : "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {a.proximo_vencimiento
                    ? format(a.proximo_vencimiento.toDate(), "dd/MM/yyyy", { locale: es })
                    : "—"}
                </td>
                <td className="px-3 py-2">{badgeEstado(a)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {puede("programa:crear_ot") ? (
                      <>
                        <Button type="button" variant="outline" size="sm" onClick={() => openAgregar(a)}>
                          Agregar al programa
                        </Button>
                        <Link
                          href={`/tareas/nueva?avisoId=${encodeURIComponent(a.id)}`}
                          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                        >
                          Crear OT directa
                        </Link>
                      </>
                    ) : null}
                    {a.ultima_ejecucion_ot_id ? (
                      <Link
                        href={`/tareas/${a.ultima_ejecucion_ot_id}`}
                        className={cn(
                          "text-xs font-medium text-primary underline-offset-2 hover:underline",
                        )}
                      >
                        Ver última OT
                      </Link>
                    ) : null}
                    {!puede("programa:crear_ot") && !a.ultima_ejecucion_ot_id ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtrados.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No hay avisos con estos filtros.</p>
        ) : null}
      </div>

      <PermisoGuard permiso="programa:crear_ot">
        {dialogOpen && pick ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="venc-dlg-title"
          >
            <Card className="w-full max-w-md shadow-xl">
              <CardHeader className="pb-2">
                <CardTitle id="venc-dlg-title" className="text-base">
                  Agregar al programa publicado
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  Aviso <span className="font-mono">{pick.n_aviso}</span> · {pick.texto_corto.slice(0, 120)}
                </p>
                <label className="flex flex-col gap-1">
                  Semana (ISO)
                  <input
                    className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                    value={weekId}
                    onChange={(e) => setWeekId(e.target.value)}
                    placeholder="2026-W14"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Día
                  <select
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={diaPick}
                    onChange={(e) => setDiaPick(e.target.value as DiaSemanaPrograma)}
                  >
                    {DIAS_PROG.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="button" onClick={() => void agregarPrograma()} disabled={busy}>
                    Confirmar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </PermisoGuard>
    </div>
  );
}
