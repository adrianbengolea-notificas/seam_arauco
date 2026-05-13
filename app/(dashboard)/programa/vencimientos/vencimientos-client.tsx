"use client";

import { actionAddAvisoToProgramaPublicado, actionMoveAvisoEnProgramaPublicado } from "@/app/actions/schedule";
import { CENTRO_NOMBRES, DEFAULT_CENTRO, KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpIconTooltip } from "@/components/ui/help-icon-tooltip";
import { Input } from "@/components/ui/input";
import { PermisoGuard } from "@/components/auth/PermisoGuard";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { cn } from "@/lib/utils";
import type { AvisoConVencimiento, UbicacionAvisoEnProgramaPublicado } from "@/modules/scheduling/hooks";
import {
  FRECUENCIAS_PLAN_MTSA_VENCIMIENTOS_TODAS,
  useAvisosVencimientos,
  useUbicacionAvisosProgramaPublicado,
} from "@/modules/scheduling/hooks";
import {
  getIsoWeekId,
  parseIsoWeekToBounds,
  semanaLabelDesdeIso,
  shiftIsoWeekId,
} from "@/modules/scheduling/iso-week";
import type { DiaSemanaPrograma } from "@/modules/scheduling/types";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import { ArrowRight, ClipboardList, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

function mergeHubVencimientosQuery(pathname: string, sp: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(sp.toString());
  if (pathname === "/programa/preventivos") p.set("pestana", "vencimientos");
  return p;
}

function avisoTieneOrdenServicioVinculada(a: AvisoConVencimiento): boolean {
  if (String(a.work_order_id ?? "").trim()) return true;
  if (String(a.antecesor_orden_abierta?.work_order_id ?? "").trim()) return true;
  return false;
}

/** Última semana ISO en la que el aviso quedó marcado al publicarse en la grilla (manual o motor). */
function avisoFiguraEnProgramaSemanalMarcado(a_: AvisoConVencimiento): string | null {
  const iso = String(a_.incluido_en_semana ?? "").trim();
  return /^\d{4}-W\d{2}$/.test(iso) ? iso : null;
}

/** Para el filtro «Semana en programa»: ya cubierto por grilla publicada **o** por OT vinculada / pendiente de cierre. */
function avisoTieneCoberturaPlanSemanal(a: AvisoConVencimiento): boolean {
  return Boolean(avisoFiguraEnProgramaSemanalMarcado(a)) || avisoTieneOrdenServicioVinculada(a);
}

function hrefAbrirProgramaSemanal(opts: { isoSemana: string; centroAviso: string; ponerCentroEnQuery: boolean }): string {
  const p = new URLSearchParams();
  p.set("semana", opts.isoSemana);
  if (opts.ponerCentroEnQuery && opts.centroAviso.trim()) {
    p.set("centro", opts.centroAviso.trim());
  }
  return `/programa?${p.toString()}`;
}

function etiquetaFrecuenciaPlan(m?: "M" | "T" | "S" | "A" | string): string {
  if (m === "M") return "Mensual";
  if (m === "T") return "Trimestral";
  if (m === "S") return "Semestral";
  if (m === "A") return "Anual";
  return m?.trim() || "—";
}

const DIAS_PROG: { value: DiaSemanaPrograma; label: string }[] = [
  { value: "lunes", label: "Lunes" },
  { value: "martes", label: "Martes" },
  { value: "miercoles", label: "Miércoles" },
  { value: "jueves", label: "Jueves" },
  { value: "viernes", label: "Viernes" },
  { value: "sabado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
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
    <Badge variant="default" className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100">
      {"Al día (>30 días)"}
    </Badge>
  );
}

export function VencimientosClient({ dentroDelHub = false }: { dentroDelHub?: boolean } = {}) {
  const { user } = useAuthUser();
  const { profile } = useUserProfile(user?.uid);
  const { puede, rol } = usePermisos();
  const puedeVerVencimientosSa = puede("programa:ver_vencimientos_sa");
  const puedeMoverEnProgramaPublicado = puede("programa:crear_ot") || puede("programa:editar");
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlFilter = sp.get("filter");

  const superadmin = rol === "superadmin";
  /** Centro del perfil; fallback al default de app para no disparar consulta global sin filtro (operarios). */
  const centro = profile?.centro?.trim() || DEFAULT_CENTRO;

  const tab = sp.get("tab") === "sin_historial" ? "sin_historial" : "seguimiento";
  const setTab = useCallback(
    (t: "seguimiento" | "sin_historial") => {
      const p = mergeHubVencimientosQuery(pathname, new URLSearchParams(sp.toString()));
      if (t === "sin_historial") p.set("tab", "sin_historial");
      else p.delete("tab");
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, sp],
  );
  const [esp, setEsp] = useState<"todos" | "AA" | "E" | "HG">("todos");
  const [estadoF, setEstadoF] = useState<"todos" | "vencido" | "proximo" | "ok">(() => {
    if (urlFilter === "vencido" || urlFilter === "proximo" || urlFilter === "ok") {
      return urlFilter;
    }
    return "todos";
  });
  useEffect(() => {
    if (urlFilter === "vencido" || urlFilter === "proximo" || urlFilter === "ok") {
      setEstadoF(urlFilter);
    } else {
      setEstadoF("todos");
    }
  }, [urlFilter]);
  const [freq, setFreq] = useState<"todos" | "M" | "T" | "S" | "A">("todos");
  const [semanaProgF, setSemanaProgF] = useState<"todos" | "con_semana" | "sin_semana">("todos");
  const [centroF, setCentroF] = useState<string>("");
  const [busqueda, setBusqueda] = useState("");

  const { avisos, loading, error } = useAvisosVencimientos({
    authUid: user?.uid,
    centro,
    verTodosLosCentros: superadmin,
    enabled: puedeVerVencimientosSa,
    frecuenciasPlanMtsa: FRECUENCIAS_PLAN_MTSA_VENCIMIENTOS_TODAS,
  });

  const { porAvisoId: ubicacionGrillaPorAviso, loading: loadingUbicaciones, error: errorUbicaciones } =
    useUbicacionAvisosProgramaPublicado(avisos, user?.uid);

  const kpis = useMemo(() => {
    let sinHistorial = 0;
    let sinHistorialEnProgramaSemanal = 0;
    let vencidos = 0;
    let proximos = 0;
    let ok = 0;
    for (const a of avisos) {
      if (!a.ultima_ejecucion_fecha) {
        sinHistorial += 1;
        if (avisoFiguraEnProgramaSemanalMarcado(a)) sinHistorialEnProgramaSemanal += 1;
        continue;
      }
      if (a.estado_vencimiento_live === "vencido") vencidos += 1;
      else if (a.estado_vencimiento_live === "proximo") proximos += 1;
      else if (a.estado_vencimiento_live === "ok") ok += 1;
    }
    return { sinHistorial, sinHistorialEnProgramaSemanal, vencidos, proximos, ok, total: avisos.length };
  }, [avisos]);

  const hrefSinHistorialList = useMemo(() => {
    const p = mergeHubVencimientosQuery(pathname, new URLSearchParams(sp.toString()));
    p.set("tab", "sin_historial");
    p.delete("filter");
    return `${pathname}?${p.toString()}#preventivos-sa-detalle`;
  }, [pathname, sp]);

  const hrefFilterVencido = useMemo(() => {
    const p = mergeHubVencimientosQuery(pathname, new URLSearchParams(sp.toString()));
    p.delete("tab");
    p.set("filter", "vencido");
    return `${pathname}?${p.toString()}#preventivos-sa-detalle`;
  }, [pathname, sp]);

  const hrefFilterProximo = useMemo(() => {
    const p = mergeHubVencimientosQuery(pathname, new URLSearchParams(sp.toString()));
    p.delete("tab");
    p.set("filter", "proximo");
    return `${pathname}?${p.toString()}#preventivos-sa-detalle`;
  }, [pathname, sp]);

  const hrefFilterOk = useMemo(() => {
    const p = mergeHubVencimientosQuery(pathname, new URLSearchParams(sp.toString()));
    p.delete("tab");
    p.set("filter", "ok");
    return `${pathname}?${p.toString()}#preventivos-sa-detalle`;
  }, [pathname, sp]);

  const centrosOpts = useMemo(() => {
    const s = new Set<string>();
    for (const k of KNOWN_CENTROS) {
      const t = k.trim();
      if (t) s.add(t);
    }
    for (const code of Object.keys(CENTRO_NOMBRES)) {
      const t = code.trim();
      if (t) s.add(t);
    }
    for (const a of avisos) {
      const t = a.centro?.trim();
      if (t) s.add(t);
    }
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [avisos]);

  const filtrados = useMemo(() => {
    let rows = avisos;
    if (superadmin && centroF.trim()) {
      rows = rows.filter((a) => a.centro === centroF.trim());
    }
    if (esp === "AA") rows = rows.filter((a) => a.especialidad === "AA");
    if (esp === "E") rows = rows.filter((a) => a.especialidad === "ELECTRICO");
    if (freq !== "todos") {
      rows = rows.filter((a) => a.frecuencia_plan_mtsa === freq);
    }

    if (semanaProgF === "con_semana") {
      rows = rows.filter((a) => avisoTieneCoberturaPlanSemanal(a));
    } else if (semanaProgF === "sin_semana") {
      rows = rows.filter((a) => !avisoTieneCoberturaPlanSemanal(a));
    }

    if (tab === "sin_historial") {
      rows = rows.filter((a) => !a.ultima_ejecucion_fecha && !avisoTieneOrdenServicioVinculada(a));
    } else {
      rows = rows.filter(
        (a) => Boolean(a.ultima_ejecucion_fecha) || avisoTieneOrdenServicioVinculada(a),
      );
      if (estadoF === "vencido") rows = rows.filter((a) => a.estado_vencimiento_live === "vencido");
      else if (estadoF === "proximo") rows = rows.filter((a) => a.estado_vencimiento_live === "proximo");
      else if (estadoF === "ok") rows = rows.filter((a) => a.estado_vencimiento_live === "ok");
    }
    const q = busqueda.trim().toLowerCase();
    if (q) {
      rows = rows.filter((a) => {
        if (String(a.n_aviso ?? "").toLowerCase().includes(q)) return true;
        if ((a.texto_corto ?? "").toLowerCase().includes(q)) return true;
        if ((a.ubicacion_tecnica ?? "").toLowerCase().includes(q)) return true;
        return false;
      });
    }
    return rows;
  }, [avisos, busqueda, centroF, esp, estadoF, freq, semanaProgF, tab, superadmin]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [pick, setPick] = useState<AvisoConVencimiento | null>(null);
  const [weekId, setWeekId] = useState(() => getIsoWeekId(new Date()));
  const [diaPick, setDiaPick] = useState<DiaSemanaPrograma>("lunes");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [replanDraft, setReplanDraft] = useState<
    Partial<Record<string, { weekId?: string; dia?: DiaSemanaPrograma }>>
  >({});
  const [movingAvisoId, setMovingAvisoId] = useState<string | null>(null);

  /** Semanas ISO elegibles al abrir el modal (pasado cercano + planificación). */
  const opcionesSemanaIso = useMemo(() => {
    const hoy = getIsoWeekId(new Date());
    const out: { id: string; label: string }[] = [];
    for (let d = -8; d <= 24; d++) {
      const id = shiftIsoWeekId(hoy, d);
      const { start, end } = parseIsoWeekToBounds(id);
      const rango = `${format(start, "d MMM", { locale: es })} – ${format(end, "d MMM yyyy", { locale: es })}`;
      out.push({ id, label: `${id} · ${rango}` });
    }
    return out;
  }, []);

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
      setMsg("Aviso agregado al programa semanal publicado.");
      setDialogOpen(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [pick, weekId, diaPick]);

  const aplicarReplan = useCallback(
    async (a: AvisoConVencimiento, ubic: UbicacionAvisoEnProgramaPublicado) => {
      const d = replanDraft[a.id];
      const destWeek = (d?.weekId ?? ubic.isoSemana).trim();
      const destDia = d?.dia ?? ubic.dia;
      const c = a.centro?.trim();
      if (!c) {
        setMsg("El aviso no tiene centro.");
        return;
      }
      const destDoc = propuestaSemanaDocId(c, destWeek);
      if (destDoc === ubic.programaDocId && destDia === ubic.dia) return;
      setMovingAvisoId(a.id);
      setMsg(null);
      try {
        const tok = await getClientIdToken();
        if (!tok) throw new Error("Sin sesión");
        const res = await actionMoveAvisoEnProgramaPublicado(tok, {
          sourceProgramaDocId: ubic.programaDocId,
          destProgramaDocId: destDoc,
          avisoNumero: a.n_aviso,
          avisoFirestoreId: a.id,
          from: {
            localidad: ubic.localidad,
            dia: ubic.dia,
            especialidad: ubic.especialidad,
          },
          destDia,
        });
        if (!res.ok) throw new Error(res.error.message);
        setMsg("Semana o día del programa actualizado.");
        setReplanDraft((p) => {
          const n = { ...p };
          delete n[a.id];
          return n;
        });
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error");
      } finally {
        setMovingAvisoId(null);
      }
    },
    [replanDraft],
  );

  if (!puedeVerVencimientosSa) {
    return <p className="text-sm text-muted-foreground">No tenés permiso para ver esta página.</p>;
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Programa</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Preventivos planificados (mensual a anual)</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {puede("programa:crear_ot") ? (
            <>
              Seguimiento de ejecución y alertas de vencimiento para avisos con plan mensual, trimestral, semestral o
              anual: resumen arriba y listado con filtros abajo. Podés sumar avisos a la grilla del programa semanal
              publicado o crear una orden directa cuando aplique.
            </>
          ) : (
            <>
              En una sola pantalla ves el estado de los preventivos de tu centro (mensual, trimestral, semestral y
              anual): arriba un resumen con totales y alertas según los datos del sistema, y más abajo el listado con
              filtros. Agregar avisos al programa o crear órdenes lo hacen supervisores y administradores.
            </>
          )}
        </p>
        <nav className="mt-3 flex flex-wrap gap-2 border-b border-border pb-3 text-sm" aria-label="Secciones de programa">
          <Link className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground" href="/programa">
            Programa semanal
          </Link>
          {puede("programa:crear_ot") ? (
            <>
              <span className="text-muted-foreground/70">·</span>
              <Link
                className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                href="/programa/aprobacion"
              >
                Aprobación motor
              </Link>
            </>
          ) : null}
          {!dentroDelHub ? (
            <>
              <span className="text-muted-foreground/70">·</span>
              <Link className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground" href="/programa/preventivos">
                Calendario anual de avisos
              </Link>
            </>
          ) : null}
        </nav>
      </header>

      {!loading && !error ? (
        <section id="resumen-kpis" className="space-y-4" aria-label="Resumen preventivos por vencimiento">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Resumen</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="border-amber-500/25 bg-amber-500/[0.04]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardList className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden />
                  Sin registro de ejecución
                </CardTitle>
                <CardDescription>
                  Totales en planta: avisos mensual, trimestral, semestral y anual sin fecha de última ejecución en el
                  sistema. Eso no quita que algunos ya estén cargados en la grilla del programa semanal (sin OT cerrada
                  aún): en el listado se ve la semana y el acceso a la grilla.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-3xl font-bold tabular-nums">{kpis.sinHistorial}</p>
                  {kpis.sinHistorialEnProgramaSemanal > 0 ? (
                    <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                      {kpis.sinHistorialEnProgramaSemanal} con semana marcada en programa publicado (sin ejecución
                      registrada).
                    </p>
                  ) : null}
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href={hrefSinHistorialList} scroll={true}>
                    Ver listado
                    <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="border-destructive/30 bg-destructive/[0.04]">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Vencidos</CardTitle>
                <CardDescription>Con ejecución previa y fuera de plazo.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end justify-between gap-3">
                <p className="text-3xl font-bold tabular-nums text-destructive">{kpis.vencidos}</p>
                <Button variant="outline" size="sm" asChild>
                  <Link href={hrefFilterVencido} scroll={true}>
                    Ver listado
                    <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="border-amber-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Próximos</CardTitle>
                <CardDescription>Vencen en los próximos 30 días.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end justify-between gap-3">
                <p className="text-3xl font-bold tabular-nums text-amber-900 dark:text-amber-100">{kpis.proximos}</p>
                <Button variant="outline" size="sm" asChild>
                  <Link href={hrefFilterProximo} scroll={true}>
                    Ver listado
                    <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Al día</CardTitle>
                <CardDescription>
                  Próximo vencimiento a más de 30 días. No indica si la última orden está cerrada.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-3xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">{kpis.ok}</p>
                  <Badge variant="default" className="mt-1 font-mono text-xs text-muted-foreground">
                    Total avisos (M/T/S/A): {kpis.total}
                  </Badge>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href={hrefFilterOk} scroll={true}>
                    Ver listado
                    <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Datos mostrados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Las tarjetas del resumen cuentan todo el universo de avisos de esta vista (planes M/T/S/A) para tu
                centro o planta según el contexto. Si aplicás filtros en el listado (especialidad, frecuencia, semana en
                programa, etc.), las filas visibles pueden ser menos que esos totales. El número «Sin registro de
                ejecución» incluye avisos sin fecha de última ejecución aunque ya tengan OT vinculada: esos aparecen en
                «Con historial de ejecución», no en «Sin ejecución cargada».
              </p>
              <p>
                El filtro «Estado» usa solo la fecha del próximo vencimiento del plan respecto a hoy: pasada → vencido;
                dentro de 30 días → próximo; más allá de eso → al día. Es independiente del cierre de la orden de
                trabajo.
              </p>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <div id="preventivos-sa-detalle" className="scroll-mt-4">
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-foreground">Detalle y acciones</h2>
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={tab === "seguimiento" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab("seguimiento")}
            >
              Con historial de ejecución
            </Button>
            {tab === "seguimiento" ? (
              <HelpIconTooltip
                ariaLabel="Información sobre la vista «Con historial de ejecución»"
                variant="info"
                className="self-center"
                panelClassName="left-0 right-auto max-h-[min(24rem,70vh)] overflow-y-auto text-left"
              >
                <p className="mb-2 font-semibold text-foreground">Seguimiento con historial u orden vinculada</p>
                <div className="space-y-2 text-muted-foreground">
                  <p>
                    Incluye avisos que ya tienen fecha de última ejecución cargada en el sistema o que tienen una OT
                    vinculada a este aviso (también si hay una orden previa del mismo mantenimiento pendiente de cierre).
                    Es el lugar para revisar vencidos, próximos y al día una vez que el trabajo quedó registrado o ya
                    hay trazabilidad por orden.
                  </p>
                  <p>
                    El filtro «Estado (vencimiento)» se basa solo en la fecha del próximo vencimiento del plan frente a
                    hoy (vencido / próximos 30 días / más allá). No indica si la última OT está cerrada.
                  </p>
                  <p>
                    Si aún no hay ejecución cargada pero sí OT abierta, la fila puede aparecer acá; en la tabla podés ver
                    enlaces a la OT en curso o a la última cerrada según corresponda.
                  </p>
                </div>
              </HelpIconTooltip>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={tab === "sin_historial" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab("sin_historial")}
            >
              Sin ejecución cargada
            </Button>
            {tab === "sin_historial" ? (
              <HelpIconTooltip
                ariaLabel="Información sobre la vista «Sin ejecución cargada»"
                variant="info"
                className="self-center"
                panelClassName="left-0 right-auto max-h-[min(24rem,70vh)] overflow-y-auto text-left"
              >
                <p className="mb-2 font-semibold text-foreground">Preventivos sin registro de ejecución en sistema</p>
                <div className="space-y-2 text-muted-foreground">
                  <p>
                    Incluye todas las frecuencias (mensual, trimestral, semestral y anual) que cumplen: no hay fecha de
                    última ejecución cargada y no hay una OT generada desde este aviso (ni orden previa del mismo
                    mantenimiento pendiente de cierre).
                  </p>
                  <p>
                    Un aviso puede figurar en el programa semanal publicado: entonces no se ofrece «Agregar al programa»,
                    sino el enlace a la grilla para mover celda o semana. Usá el filtro «Frecuencia» o «Semana en
                    programa» para acotar.
                  </p>
                  <p>
                    Si el trabajo se hizo fuera del sistema, al cerrar la primera OT empieza el cálculo de vencimientos.
                    Quienes ya tienen orden de servicio (aunque abierta) pasan a «Con historial de ejecución».
                  </p>
                </div>
              </HelpIconTooltip>
            ) : null}
          </div>
        </div>

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
            <option value="HG">HG</option>
          </select>
        </label>
        {tab === "seguimiento" ? (
          <label
            className="flex flex-col gap-1 text-xs font-medium"
            title="Según la fecha del próximo vencimiento del plan; no equivale a orden finalizada."
          >
            Estado (vencimiento)
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={estadoF}
              onChange={(e) => setEstadoF(e.target.value as typeof estadoF)}
            >
              <option value="todos">Todos</option>
              <option value="vencido">Vencidos</option>
              <option value="proximo">Próximos (≤30 días)</option>
              <option value="ok">{"Al día (>30 días)"}</option>
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
            <option value="M">Mensual</option>
            <option value="T">Trimestral</option>
            <option value="S">Semestral</option>
            <option value="A">Anual</option>
          </select>
        </label>
        <label
          className="flex flex-col gap-1 text-xs font-medium"
          title={`Con semana: figura con semana ISO en programa (incluido_en_semana) o tiene OT vinculada / orden previa pendiente. Sin semana: ni grilla ni OT — pendientes de programar.`}
        >
          Semana en programa
          <select
            className="h-9 min-w-[11rem] rounded-md border border-input bg-background px-2 text-sm"
            value={semanaProgF}
            onChange={(e) => setSemanaProgF(e.target.value as typeof semanaProgF)}
          >
            <option value="todos">Todas</option>
            <option value="con_semana">Con semana asignada</option>
            <option value="sin_semana">Sin semana asignada</option>
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
              <option value="">Todas las plantas</option>
              {centrosOpts.map((c) => (
                <option key={c} value={c}>
                  {nombreCentro(c)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="self-end text-xs text-muted-foreground">
            Centro: <span className="font-medium">{centro ? nombreCentro(centro) : "—"}</span>
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[12rem] max-w-md flex-1 flex-col gap-1 text-xs font-medium">
          Búsqueda rápida
          <span className="relative block">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-9 pl-7 text-sm"
              placeholder="N.º de aviso o palabras (descripción, ubicación)…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              aria-label="Filtrar avisos por número o texto"
            />
          </span>
        </label>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {mensajeErrorFirebaseParaUsuario(error)}
        </p>
      ) : null}
      {errorUbicaciones ? (
        <p className="text-sm text-destructive" role="alert">
          {mensajeErrorFirebaseParaUsuario(errorUbicaciones)}
        </p>
      ) : null}
      {msg ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{msg}</p> : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Aviso</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Descripción</th>
              <th className="px-3 py-2 font-medium">Ubicación</th>
              <th className="px-3 py-2 font-medium">Última ejec.</th>
              <th className="px-3 py-2 font-medium">Próx. venc.</th>
              <th className="min-w-[14rem] px-3 py-2 font-medium">Programa (sem. / día)</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtrados.map((a) => {
              const isoProg = avisoFiguraEnProgramaSemanalMarcado(a);
              const hrefPro =
                isoProg != null
                  ? hrefAbrirProgramaSemanal({
                      isoSemana: isoProg,
                      centroAviso: a.centro ?? "",
                      ponerCentroEnQuery: superadmin,
                    })
                  : null;
              const ubic = ubicacionGrillaPorAviso[a.id];
              const draft = replanDraft[a.id];
              const selWeek = draft?.weekId ?? ubic?.isoSemana ?? isoProg ?? "";
              const selDia = draft?.dia ?? ubic?.dia ?? ("lunes" as DiaSemanaPrograma);
              const opcionesSemanaFila =
                selWeek && !opcionesSemanaIso.some((o) => o.id === selWeek)
                  ? [{ id: selWeek, label: selWeek }, ...opcionesSemanaIso]
                  : opcionesSemanaIso;
              const hayCambioReplan =
                ubic &&
                (propuestaSemanaDocId(a.centro?.trim() ?? "", selWeek) !== ubic.programaDocId ||
                  selDia !== ubic.dia);
              return (
              <tr key={a.id} className="hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{a.n_aviso}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  <Badge variant="default" className="font-normal tabular-nums text-muted-foreground">
                    {etiquetaFrecuenciaPlan(a.frecuencia_plan_mtsa)}
                  </Badge>
                </td>
                <td className="max-w-[240px] px-3 py-2 text-muted-foreground">{a.texto_corto}</td>
                <td className="px-3 py-2 text-xs">{a.ubicacion_tecnica}</td>
                <td className="align-top px-3 py-2 text-xs">
                  {a.ultima_ejecucion_fecha ? (
                    format(a.ultima_ejecucion_fecha.toDate(), "dd/MM/yyyy", { locale: es })
                  ) : (
                    <div className="space-y-0.5">
                      <span>—</span>
                      {(isoProg || ubic) && (
                        <span className="block text-[10px] leading-tight text-muted-foreground">
                          {ubic
                            ? `Programa: ${DIAS_PROG.find((d) => d.value === ubic.dia)?.label ?? ubic.dia}`
                            : isoProg
                              ? `En programa: ${semanaLabelDesdeIso(isoProg)}`
                              : null}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="align-top px-3 py-2 text-xs">
                  {a.proximo_vencimiento ? (
                    format(a.proximo_vencimiento.toDate(), "dd/MM/yyyy", { locale: es })
                  ) : (
                    <div className="space-y-0.5">
                      <span>—</span>
                      {a.ultima_ejecucion_fecha && (isoProg || ubic) ? (
                        <span className="block text-[10px] leading-tight text-muted-foreground">
                          {ubic
                            ? `Programa: ${DIAS_PROG.find((d) => d.value === ubic.dia)?.label ?? ubic.dia}`
                            : isoProg
                              ? `En programa: ${semanaLabelDesdeIso(isoProg)}`
                              : null}
                        </span>
                      ) : null}
                    </div>
                  )}
                </td>
                <td className="align-top px-3 py-2 text-xs">
                  <div className="flex max-w-[280px] flex-col gap-1.5">
                    {isoProg ? (
                      <>
                        {loadingUbicaciones && !ubic ? (
                          <span className="text-[11px] text-muted-foreground">Cargando celda…</span>
                        ) : null}
                        {!loadingUbicaciones && !ubic ? (
                          <p className="text-[11px] leading-snug text-muted-foreground">
                            {semanaLabelDesdeIso(isoProg)} — no aparece en la grilla publicada.
                            {hrefPro ? (
                              <>
                                {" "}
                                <Link
                                  href={hrefPro}
                                  className="font-medium text-primary underline-offset-2 hover:underline"
                                >
                                  Abrir grilla
                                </Link>
                              </>
                            ) : null}
                          </p>
                        ) : null}
                        {ubic ? (
                          <>
                            <p className="text-[11px] leading-snug">
                              <span className="font-medium text-foreground">
                                {semanaLabelDesdeIso(ubic.isoSemana)}
                              </span>
                              <span className="text-muted-foreground"> · </span>
                              <span>{DIAS_PROG.find((d) => d.value === ubic.dia)?.label ?? ubic.dia}</span>
                            </p>
                            {hrefPro ? (
                              <Link
                                href={hrefPro}
                                className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                              >
                                Ver en grilla
                              </Link>
                            ) : null}
                            {puedeMoverEnProgramaPublicado ? (
                              <div className="flex flex-col gap-1 border-t border-border/60 pt-1.5">
                                <label className="text-[10px] font-medium text-muted-foreground">Cambio rápido</label>
                                <select
                                  className="h-8 rounded-md border border-input bg-background px-1.5 text-[11px]"
                                  value={selWeek}
                                  onChange={(e) =>
                                    setReplanDraft((p) => ({
                                      ...p,
                                      [a.id]: { ...p[a.id], weekId: e.target.value },
                                    }))
                                  }
                                >
                                  {opcionesSemanaFila.map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  className="h-8 rounded-md border border-input bg-background px-1.5 text-[11px]"
                                  value={selDia}
                                  onChange={(e) =>
                                    setReplanDraft((p) => ({
                                      ...p,
                                      [a.id]: {
                                        ...p[a.id],
                                        dia: e.target.value as DiaSemanaPrograma,
                                      },
                                    }))
                                  }
                                >
                                  {DIAS_PROG.map((d) => (
                                    <option key={d.value} value={d.value}>
                                      {d.label}
                                    </option>
                                  ))}
                                </select>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="h-8 text-[11px]"
                                  disabled={
                                    !hayCambioReplan || movingAvisoId === a.id || !a.centro?.trim()
                                  }
                                  onClick={() => void aplicarReplan(a, ubic)}
                                >
                                  {movingAvisoId === a.id ? "Guardando…" : "Aplicar"}
                                </Button>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </>
                    ) : avisoTieneOrdenServicioVinculada(a) ? (
                      <span className="text-[11px] text-muted-foreground">
                        Sin semana en grilla (cubierto por OT).
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">{badgeEstado(a)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {puede("programa:crear_ot") && !avisoTieneOrdenServicioVinculada(a) ? (
                      isoProg && hrefPro ? (
                        <>
                          <Link
                            href={hrefPro}
                            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Abrir grilla y reprogramar
                          </Link>
                          <Link
                            href={`/tareas/nueva?avisoId=${encodeURIComponent(a.id)}`}
                            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Crear OT directa
                          </Link>
                        </>
                      ) : (
                        <>
                          <Button type="button" variant="outline" size="sm" onClick={() => openAgregar(a)}>
                            Agregar al programa semanal
                          </Button>
                          <Link
                            href={`/tareas/nueva?avisoId=${encodeURIComponent(a.id)}`}
                            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Crear OT directa
                          </Link>
                        </>
                      )
                    ) : null}
                    {puede("programa:crear_ot") && avisoTieneOrdenServicioVinculada(a) ? (
                      <p className="text-xs text-muted-foreground">
                        Ya hay orden vinculada o pendiente de cierre; usá el enlace de abajo.
                      </p>
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
                    {a.work_order_id?.trim() &&
                    a.work_order_id.trim() !== a.ultima_ejecucion_ot_id?.trim() ? (
                      <Link
                        href={`/tareas/${a.work_order_id.trim()}`}
                        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                      >
                        Ver OT en curso
                      </Link>
                    ) : null}
                    {a.antecesor_orden_abierta?.work_order_id?.trim() &&
                    a.antecesor_orden_abierta.work_order_id.trim() !== a.work_order_id?.trim() ? (
                      <Link
                        href={`/tareas/${a.antecesor_orden_abierta.work_order_id.trim()}`}
                        className="text-xs font-medium text-amber-800 underline-offset-2 hover:underline dark:text-amber-200"
                      >
                        Orden anterior del mismo mantenimiento (cerrar primero)
                      </Link>
                    ) : null}
                    {!puede("programa:crear_ot") &&
                    !a.ultima_ejecucion_ot_id &&
                    !a.work_order_id?.trim() &&
                    !a.antecesor_orden_abierta?.work_order_id?.trim() ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : null}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && filtrados.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {tab === "sin_historial"
              ? "No hay preventivos sin OT vinculada ni historial de cierre con estos filtros."
              : "No hay preventivos con estos filtros."}
          </p>
        ) : null}
      </div>
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
                  Agregar al programa semanal publicado
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  Aviso <span className="font-mono">{pick.n_aviso}</span> · {pick.texto_corto.slice(0, 120)}
                </p>
                <label className="flex flex-col gap-1">
                  Semana (ISO)
                  <select
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={weekId}
                    onChange={(e) => setWeekId(e.target.value)}
                  >
                    {opcionesSemanaIso.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
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
