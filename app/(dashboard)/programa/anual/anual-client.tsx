"use client";

import { actionActualizarMesesPlanPreventivo, actionAsignarSemanaPlanPreventivo } from "@/app/actions/plan-mantenimiento";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CENTRO_SELECTOR_TODAS_PLANTAS,
  DEFAULT_CENTRO,
  KNOWN_CENTROS,
  isCentroInKnownList,
  nombreCentro,
} from "@/lib/config/app-config";
import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";
import type {
  EstadoVencimientoPlan,
  FrecuenciaPlan,
  PlanMantenimientoFirestore,
} from "@/lib/firestore/plan-mantenimiento-types";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { cn } from "@/lib/utils";
import { usePlanesPreventivosLive } from "@/modules/scheduling/use-planes-preventivos-live";
import type { Especialidad } from "@/modules/notices/types";
import { getIsoWeekId, listaSemanasIsoEnAnoCalendario, semanaLabelDesdeIso } from "@/modules/scheduling/iso-week";
import { useAuthUser, useUserProfile, getClientIdToken } from "@/modules/users/hooks";
import { isSuperAdminRole } from "@/modules/users/roles";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type FiltroEsp = "todas" | Especialidad;

/** Filtro de frecuencia del plan (M/T/S/A). «Única» solo aparece con «Todas». */
type FiltroFrec = "todas" | Exclude<FrecuenciaPlan, "UNICA">;

const FREC_OPTS: { value: FiltroFrec; label: string }[] = [
  { value: "todas", label: "Todas las frecuencias" },
  { value: "A", label: "Anual" },
  { value: "M", label: "Mensual" },
  { value: "T", label: "Trimestral" },
  { value: "S", label: "Semestral" },
];

const ESP_OPTS: { value: FiltroEsp; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "AA", label: "AA" },
  { value: "ELECTRICO", label: "Eléctrico" },
  { value: "GG", label: "GG" },
  { value: "HG", label: "HG" },
];

const ESP_DISPLAY: Partial<Record<Especialidad, string>> = {
  AA: "AA",
  ELECTRICO: "ELEC",
  GG: "GG",
  HG: "HG",
};

const ESP_LABEL_LARGO: Partial<Record<Especialidad, string>> = {
  AA: "Aire acondicionado",
  ELECTRICO: "Eléctrico",
  GG: "Grupos generadores",
  HG: "HG",
};

const ORDEN_ESP: Especialidad[] = ["AA", "ELECTRICO", "GG", "HG"];

function claseBadgeEspecialidad(esp: Especialidad): string {
  switch (esp) {
    case "AA":
      return "border-sky-500/40 bg-sky-500/15 text-sky-950 dark:text-sky-100";
    case "ELECTRICO":
      return "border-violet-500/40 bg-violet-500/15 text-violet-950 dark:text-violet-100";
    case "GG":
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-950 dark:text-emerald-100";
    case "HG":
      return "border-amber-500/45 bg-amber-500/12 text-amber-950 dark:text-amber-100";
    default:
      return "";
  }
}

function tareasDelMes(planes: PlanMantenimientoFirestore[], mes: number): PlanMantenimientoFirestore[] {
  return planes.filter((p) => {
    const m = p.meses_programados;
    if (!m?.length) return false;
    return m.includes(mes);
  });
}

/**
 * Tile «Sin mes»: semestral, anual o única sin `meses_programados`.
 * Mensual y trimestral no entran (sus meses vienen del Excel Arauco en Configuración e importación).
 */
function incluyeEnSinMesCalendario(p: PlanMantenimientoFirestore): boolean {
  const f = p.frecuencia;
  if (f === "M" || f === "T") return false;
  return !(p.meses_programados?.length ?? 0);
}

function cuentaPorEsp(tareas: PlanMantenimientoFirestore[]): Record<Especialidad, number> {
  const base: Record<Especialidad, number> = {
    AA: 0,
    ELECTRICO: 0,
    GG: 0,
    HG: 0,
  };
  for (const t of tareas) {
    const esp = t.especialidad;
    if (esp in base) base[esp]++;
  }
  return base;
}

function etiquetaMes(mes: number): string {
  return format(new Date(2000, mes - 1, 15), "LLLL", { locale: es });
}

/** Meses en orden de año de trabajo: abril (año Y) … marzo (año Y+1). */
const MESES_ANO_TRABAJO: readonly number[] = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

/** Año calendario real del mes `mes` (1–12) dentro del año de trabajo que comienza en abril de `añoTrabajoInicio`. */
function añoCalendarioParaMesEnAnoTrabajo(mes: number, añoTrabajoInicio: number): number {
  return mes >= 4 ? añoTrabajoInicio : añoTrabajoInicio + 1;
}

function intensidadPorConteo(total: number, min: number, max: number): "none" | "low" | "mid" | "high" {
  if (total <= 0) return "none";
  if (max <= min || max <= 0) return "mid";
  const t = (total - min) / (max - min);
  if (t < 1 / 3) return "low";
  if (t < 2 / 3) return "mid";
  return "high";
}

function barraPct(claseBg: string, pct01: number) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
      <div className={cn("h-full rounded-full transition-all", claseBg)} style={{ width: `${Math.round(pct01 * 100)}%` }} />
    </div>
  );
}

function badgeEstadoPlan(estado: EstadoVencimientoPlan, diasParaVencer?: number | null) {
  if (estado === "vencido") {
    let extra = "";
    if (diasParaVencer != null) {
      extra =
        diasParaVencer <= 0
          ? ` (hace ${Math.abs(Math.trunc(diasParaVencer))} d)`
          : ` (en ${Math.trunc(diasParaVencer)} d)`;
    }
    return (
      <Badge className="border border-destructive/50 bg-destructive/15 text-destructive">
        Vencido{extra}
      </Badge>
    );
  }
  if (estado === "proximo") {
    return (
      <Badge className="border border-amber-500/45 bg-amber-500/12 text-amber-950 dark:text-amber-100">
        Próximo
        {diasParaVencer != null ? ` (${diasParaVencer} d)` : ""}
      </Badge>
    );
  }
  if (estado === "nunca_ejecutado") {
    return (
      <Badge variant="default" className="bg-muted text-muted-foreground">
        Nunca ejecutado
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="bg-muted">
      OK
      {diasParaVencer != null ? ` · ${diasParaVencer} d` : ""}
    </Badge>
  );
}

/** Agrupa por localidad → especialidad ordenada */
function grupoLocalidadEsp(tareas: PlanMantenimientoFirestore[]): Map<string, Map<Especialidad, PlanMantenimientoFirestore[]>> {
  const byLoc = new Map<string, PlanMantenimientoFirestore[]>();
  for (const p of tareas) {
    const loc = p.localidad?.trim() || "—";
    if (!byLoc.has(loc)) byLoc.set(loc, []);
    byLoc.get(loc)!.push(p);
  }
  const locales = [...byLoc.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  const out = new Map<string, Map<Especialidad, PlanMantenimientoFirestore[]>>();
  for (const loc of locales) {
    const items = byLoc.get(loc)!;
    const byEsp = new Map<Especialidad, PlanMantenimientoFirestore[]>();
    for (const e of ORDEN_ESP) byEsp.set(e, []);
    for (const p of items) {
      const row = byEsp.get(p.especialidad);
      if (row) row.push(p);
    }
    const mapClean = new Map<Especialidad, PlanMantenimientoFirestore[]>();
    for (const e of ORDEN_ESP) {
      const row = byEsp.get(e);
      if (row?.length) {
        row.sort((a, b) =>
          String(a.numero ?? "").localeCompare(String(b.numero ?? ""), undefined, { numeric: true }),
        );
        mapClean.set(e, row);
      }
    }
    if (mapClean.size) out.set(loc, mapClean);
  }
  return out;
}

export function AnualClient({ dentroDelHub = false }: { dentroDelHub?: boolean } = {}) {
  const { user } = useAuthUser();
  const { profile } = useUserProfile(user?.uid);
  const { puede } = usePermisos();

  const perfilCentro = (profile?.centro?.trim() || DEFAULT_CENTRO).trim();
  const viewerSa = isSuperAdminRole(profile?.rol);

  const [centroSeleccionado, setCentroSeleccionado] = useState<string>(() =>
    viewerSa ? CENTRO_SELECTOR_TODAS_PLANTAS : perfilCentro,
  );

  /** Al cargar perfil, alinear centro si cambió usuario (solo no-SA siguen centro). */
  const centroQuery = useMemo(() => {
    if (viewerSa) {
      const c = centroSeleccionado.trim();
      if (c === CENTRO_SELECTOR_TODAS_PLANTAS) return CENTRO_SELECTOR_TODAS_PLANTAS;
      if (isCentroInKnownList(c)) return c;
      return CENTRO_SELECTOR_TODAS_PLANTAS;
    }
    return perfilCentro;
  }, [viewerSa, centroSeleccionado, perfilCentro]);

  const [espFiltro, setEspFiltro] = useState<FiltroEsp>("todas");
  const [frecFiltro, setFrecFiltro] = useState<FiltroFrec>("todas");
  const yearNow = new Date().getFullYear();
  const añosDisponibles = [yearNow - 1, yearNow, yearNow + 1];
  const [añoVisual, setAñoVisual] = useState<number>(() => yearNow);

  const [mesDetalle, setMesDetalle] = useState<number | null>(null);

  const puedeVer = puede("programa:ver_calendario_anual");
  const puedeAsignarSemana = puede("programa:crear_ot") || puede("programa:editar");
  const { planes: planesFirestore, loading, error } = usePlanesPreventivosLive(
    puedeVer ? user?.uid : undefined,
    centroQuery,
  );

  /** El año de trabajo cruza dos años gregorianos; el selector incluye semanas ISO de ambos. */
  const semanasOpcionesAno = useMemo(() => {
    const a = listaSemanasIsoEnAnoCalendario(añoVisual);
    const b = listaSemanasIsoEnAnoCalendario(añoVisual + 1);
    return [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  }, [añoVisual]);

  const [planSemanaAbierto, setPlanSemanaAbierto] = useState<PlanMantenimientoFirestore | null>(null);
  const [semanaDraft, setSemanaDraft] = useState("");
  const [busySemana, setBusySemana] = useState(false);
  const [msgSemanaModal, setMsgSemanaModal] = useState<string | null>(null);

  const [planMesesAbierto, setPlanMesesAbierto] = useState<PlanMantenimientoFirestore | null>(null);
  const [mesesDraft, setMesesDraft] = useState<number[]>([]);
  const [busyMeses, setBusyMeses] = useState(false);
  const [msgMesesModal, setMsgMesesModal] = useState<string | null>(null);

  useEffect(() => {
    if (!planSemanaAbierto) return;
    setSemanaDraft(planSemanaAbierto.semana_asignada?.trim() ?? "");
    setMsgSemanaModal(null);
  }, [planSemanaAbierto]);

  useEffect(() => {
    if (!planMesesAbierto) return;
    setMesesDraft(planMesesAbierto.meses_programados?.slice() ?? []);
    setMsgMesesModal(null);
  }, [planMesesAbierto]);

  const ejecutarGuardarMeses = useCallback(async () => {
    const plan = planMesesAbierto;
    if (!plan) return;
    setBusyMeses(true);
    setMsgMesesModal(null);
    try {
      const tok = await getClientIdToken();
      if (!tok) throw new Error("Sin sesión");
      const res = await actionActualizarMesesPlanPreventivo(tok, {
        planId: plan.id,
        meses: mesesDraft,
      });
      if (!res.ok) throw new Error(res.error.message);
      setPlanMesesAbierto(null);
    } catch (e) {
      setMsgMesesModal(e instanceof Error ? e.message : "Error");
    } finally {
      setBusyMeses(false);
    }
  }, [planMesesAbierto, mesesDraft]);

  const opcionesSemanaSelect = useMemo(() => {
    const cur = planSemanaAbierto?.semana_asignada?.trim();
    const seen = new Set(semanasOpcionesAno);
    if (cur && !seen.has(cur)) {
      seen.add(cur);
      return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return semanasOpcionesAno.slice();
  }, [semanasOpcionesAno, planSemanaAbierto]);

  const ejecutarGuardarSemana = useCallback(async () => {
    const plan = planSemanaAbierto;
    if (!plan) return;
    setBusySemana(true);
    setMsgSemanaModal(null);
    try {
      const tok = await getClientIdToken();
      if (!tok) throw new Error("Sin sesión");
      const t = semanaDraft.trim();
      const semanaIso = t === "" ? null : t;
      if (semanaIso && !/^\d{4}-W\d{2}$/.test(semanaIso)) {
        setMsgSemanaModal("Semana debe ser como 2026-W14.");
        return;
      }
      const res = await actionAsignarSemanaPlanPreventivo(tok, {
        planId: plan.id,
        semanaIso,
      });
      if (!res.ok) throw new Error(res.error.message);
      setPlanSemanaAbierto(null);
    } catch (e) {
      setMsgSemanaModal(e instanceof Error ? e.message : "Error");
    } finally {
      setBusySemana(false);
    }
  }, [planSemanaAbierto, semanaDraft]);

  const planesEsp = useMemo(() => {
    let p = planesFirestore;
    if (espFiltro !== "todas") p = p.filter((x) => x.especialidad === espFiltro);
    if (frecFiltro !== "todas") p = p.filter((x) => x.frecuencia === frecFiltro);
    return p;
  }, [planesFirestore, espFiltro, frecFiltro]);

  const sinMes = useMemo(() => planesEsp.filter((p) => incluyeEnSinMesCalendario(p)), [planesEsp]);

  const mtPendientesCalendarioArauco = useMemo(
    () =>
      planesEsp.filter(
        (p) => (p.frecuencia === "M" || p.frecuencia === "T") && !(p.meses_programados?.length ?? 0),
      ).length,
    [planesEsp],
  );

  const cuentaPorMes = useMemo(() => {
    const r: number[] = [];
    for (let m = 1; m <= 12; m++) {
      r[m] = tareasDelMes(planesEsp, m).length;
    }
    return r;
  }, [planesEsp]);

  const { mesMasCarga, mesMinCarga } = useMemo(() => {
    let max = -1;
    let min = Number.MAX_SAFE_INTEGER;
    let mesMax = 1;
    let mesMin = 1;
    for (let m = 1; m <= 12; m++) {
      const n = cuentaPorMes[m];
      if (!Number.isFinite(n)) continue;
      if (n > max) {
        max = n;
        mesMax = m;
      }
      if (n >= 0 && n < min) {
        min = n;
        mesMin = m;
      }
    }
    if (max < 0) return { mesMasCarga: null as number | null, mesMinCarga: null as number | null };
    return { mesMasCarga: mesMax, mesMinCarga: mesMin };
  }, [cuentaPorMes]);

  const cargasTrece = cuentaPorMes.slice(1, 13);
  const minCarga = cargasTrece.length ? Math.min(...cargasTrece) : 0;
  const maxCarga = Math.max(0, ...cargasTrece);

  /** Inicio (año gregoriano) del año de trabajo que contiene «hoy»: abr Y … mar Y+1. */
  const mesActual = new Date().getMonth() + 1;
  const añoTrabajoQueContieneHoy = mesActual >= 4 ? yearNow : yearNow - 1;
  const destacarMesActual =
    añoVisual === añoTrabajoQueContieneHoy ? mesActual : null;

  const detalleLista = useMemo(() => {
    if (mesDetalle == null) return [];
    if (mesDetalle === 0) return sinMes;
    return tareasDelMes(planesEsp, mesDetalle);
  }, [mesDetalle, planesEsp, sinMes]);
  const detalleGrouped = useMemo(() => grupoLocalidadEsp(detalleLista), [detalleLista]);

  if (!user) {
    return <p className="text-sm text-muted-foreground">Iniciá sesión para ver el plan anual.</p>;
  }
  if (!puedeVer) {
    return <p className="text-sm text-muted-foreground">No tenés permiso para ver esta sección.</p>;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Programa</p>
        <h1 className="text-2xl font-bold tracking-tight md:text-[1.65rem]">Calendario anual de avisos preventivos</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Vista de distribución por mes según <span className="font-medium text-foreground">meses_programados</span> en los{" "}
          <span className="font-medium text-foreground">planes de aviso preventivo</span> (origen habitual: importación desde Excel).
          Una misma fila puede contar varias veces al año si su frecuencia lo programa en varios meses.
        </p>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Las <strong className="font-medium text-foreground">OTs</strong> aparecen cuando el motor las genera y se aprueban, o cuando se crean manualmente; esta pantalla organiza el programa de avisos, no la agenda de OTs.
        </p>
        {puedeAsignarSemana ? (
          <p className="max-w-3xl text-sm text-muted-foreground">
            Con los permisos correctos podés fijar <strong className="font-medium text-foreground">en qué semana del año ejecutar cada plan</strong>{" "}
            (por ejemplo: «semana del 12 al 18 de mayo»).
          </p>
        ) : null}
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-border pb-3 text-sm" aria-label="Secciones de programa">
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
        {puede("programa:ver_vencimientos_sa") && !dentroDelHub ? (
          <>
            <span className="text-muted-foreground/70">·</span>
            <Link
              className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              href="/programa/preventivos?pestana=vencimientos"
            >
              Alertas S/A
            </Link>
          </>
        ) : null}
      </nav>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">
            Resumen · año trabajo {añoVisual}–{añoVisual + 1}
          </CardTitle>
          <CardDescription>
            Planes activos mostrados: <span className="font-medium text-foreground">{planesEsp.length}</span>
            {" · "}sin mes (S/A/única — asignables acá):{" "}
            <span className={sinMes.length > 0 ? "font-semibold text-amber-800 dark:text-amber-100" : ""}>
              {sinMes.length}
            </span>
            {mtPendientesCalendarioArauco > 0 ? (
              <>
                {" · "}
                <span className="text-muted-foreground">
                  mensual/trimestral pendiente de Excel Arauco:{" "}
                  <span className="font-medium text-foreground">{mtPendientesCalendarioArauco}</span>
                  {" — "}
                  <Link className="font-medium text-primary underline underline-offset-2" href="/superadmin/configuracion">
                    importación
                  </Link>
                </span>
              </>
            ) : null}
            {mesMasCarga != null ? (
              <>
                {" · "}más cargado: <span className="font-medium capitalize">{etiquetaMes(mesMasCarga)}</span> (
                {cuentaPorMes[mesMasCarga]})
              </>
            ) : null}
            {mesMinCarga != null ? (
              <>
                {" · "}más liviano: <span className="font-medium capitalize">{etiquetaMes(mesMinCarga)}</span> (
                {cuentaPorMes[mesMinCarga]})
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
      </Card>


      <div className="flex flex-wrap gap-3">
        {viewerSa ? (
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Centro
            <select
              className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm shadow-sm"
              value={
                centroSeleccionado === CENTRO_SELECTOR_TODAS_PLANTAS
                  ? CENTRO_SELECTOR_TODAS_PLANTAS
                  : centroSeleccionado.trim() || perfilCentro
              }
              onChange={(e) => setCentroSeleccionado(e.target.value.trim())}
            >
              <option value={CENTRO_SELECTOR_TODAS_PLANTAS}>Todas las plantas</option>
              {KNOWN_CENTROS.map((c) => (
                <option key={c} value={c}>
                  {nombreCentro(c)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">
            Centro <span className="font-mono font-medium text-foreground">{perfilCentro}</span>
            {" — "}
            {nombreCentro(perfilCentro)}
          </p>
        )}

        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Especialidad
          <select
            className="h-9 min-w-[9rem] rounded-md border border-input bg-background px-2 text-sm shadow-sm"
            value={espFiltro}
            onChange={(e) => setEspFiltro(e.target.value as FiltroEsp)}
          >
            {ESP_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Frecuencia
          <select
            className="h-9 min-w-[11rem] rounded-md border border-input bg-background px-2 text-sm shadow-sm"
            value={frecFiltro}
            onChange={(e) => setFrecFiltro(e.target.value as FiltroFrec)}
          >
            {FREC_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Año de trabajo (abr.–mar.; el selector es el año que inicia en abril)
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm"
            value={String(añoVisual)}
            onChange={(e) => setAñoVisual(Number(e.target.value))}
          >
            {añosDisponibles.map((y) => (
              <option key={y} value={String(y)}>
                {y} (abr. {y} – mar. {y + 1})
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {mensajeErrorFirebaseParaUsuario(error)}
        </div>
      ) : null}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_min(400px,max(28vw))] lg:items-start lg:gap-6">
        <div className="min-w-0 space-y-3">
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy aria-label="Cargando calendario">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="h-36 animate-pulse rounded-xl border border-border bg-muted/40" />
              ))}
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground lg:hidden">
                Tocá un mes para ver el detalle agrupado por localidad.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {MESES_ANO_TRABAJO.map((mes) => {
                  const lista = tareasDelMes(planesEsp, mes);
                  const cuenta = cuentaPorEsp(lista);
                  const total = lista.length;
                  const nivel = intensidadPorConteo(total, minCarga, maxCarga);
                  const destacar = destacarMesActual === mes;
                  const bgNivel =
                    nivel === "none"
                      ? "bg-muted/30"
                      : nivel === "low"
                        ? "bg-emerald-500/10 ring-emerald-500/35"
                        : nivel === "mid"
                          ? "bg-amber-500/12 ring-amber-500/30"
                          : "bg-red-500/12 ring-red-500/35";
                  const activoSel = mesDetalle === mes;
                  const vencidosN = lista.filter((p) => p.estado_vencimiento === "vencido").length;
                  const pctBarra = total > 0 && maxCarga > 0 ? total / Math.max(maxCarga, 1) : 0;

                  return (
                    <button
                      key={mes}
                      type="button"
                      onClick={() => setMesDetalle((m) => (m === mes ? null : mes))}
                      className={cn(
                        "rounded-xl border p-3 text-left transition-[box-shadow,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35",
                        bgNivel,
                        "border-border hover:shadow-md",
                        destacar && "ring-2 ring-brand ring-offset-2 ring-offset-background",
                        activoSel && "ring-2 ring-brand border-brand/35",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground capitalize">
                          {etiquetaMes(mes)}{" "}
                          <span className="font-normal text-muted-foreground/80">
                            ’{String(añoCalendarioParaMesEnAnoTrabajo(mes, añoVisual)).slice(-2)}
                          </span>
                        </span>
                        <span className="text-xl font-semibold tabular-nums">{total}</span>
                      </div>
                      {total > 0 ? barraPct(nivel === "high" ? "bg-red-500/70" : "bg-brand/55", pctBarra) : null}

                      <div className="mt-2 flex flex-wrap gap-1">
                        {ORDEN_ESP.map((e) =>
                          cuenta[e] ? (
                            <Badge key={`${mes}-${e}`} className={cn("text-[0.65rem]", claseBadgeEspecialidad(e))}>
                              {ESP_DISPLAY[e]} {cuenta[e]}
                            </Badge>
                          ) : null,
                        )}
                      </div>

                      <div className="mt-2 flex min-h-[1rem] flex-wrap gap-1">
                        {vencidosN ? (
                          <Badge className="bg-destructive/15 text-destructive">{vencidosN} vencido{vencidosN > 1 ? "s" : ""}</Badge>
                        ) : (
                          <span className="text-[0.65rem] text-muted-foreground">Sin vencidos en lista</span>
                        )}
                      </div>
                    </button>
                  );
                })}

                {/* Tile «Sin mes»: solo planes que deben llevar mes desde esta pantalla (no M/T). */}
                {sinMes.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setMesDetalle((m) => (m === 0 ? null : 0))}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-[box-shadow,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35",
                      "border-dashed border-amber-500/50 bg-amber-500/[0.06] hover:shadow-md",
                      mesDetalle === 0 && "ring-2 ring-amber-500 border-amber-500/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        Sin mes
                      </span>
                      <span className="text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                        {sinMes.length}
                      </span>
                    </div>
                    <div className="mt-2">
                      <span className="text-[0.65rem] text-amber-700/80 dark:text-amber-400/80">
                        Semestral / anual / única sin mes — hacé clic para asignar (M/T no: van por Excel Arauco).
                      </span>
                    </div>
                  </button>
                ) : null}
              </div>
              <p className="text-[0.65rem] text-muted-foreground">
                Intensidad de color de la celda comparada dentro del año (min–max de conteos mensuales con los filtros
                aplicados).
              </p>
            </>
          )}
        </div>

        <aside className="mt-6 min-w-0 lg:sticky lg:top-[var(--sticky-top,72px)] lg:mt-0">
          {mesDetalle == null ? (
            <Card className="hidden border-dashed lg:block">
              <CardHeader className="py-6">
                <CardTitle className="text-sm font-medium text-muted-foreground">Seleccioná un mes</CardTitle>
                <CardDescription>
                  Para ver todas las filas del plan ese mes (agrupadas por localidad y especialidad), hacé clic en una celda.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card className="max-h-[min(78vh,calc(100vh-120px))] overflow-hidden lg:flex lg:flex-col">
              <CardHeader className="shrink-0 border-b pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg capitalize">
                      {mesDetalle === 0
                        ? "Sin mes asignado"
                        : `${etiquetaMes(mesDetalle)} · ${añoCalendarioParaMesEnAnoTrabajo(mesDetalle, añoVisual)}`}
                    </CardTitle>
                    <CardDescription>
                      {detalleLista.length} tarea{detalleLista.length === 1 ? "" : "s"}
                      {mesDetalle === 0
                        ? " sin mes asignable desde acá (semestral/anual/única) — usá «Cambiar mes»"
                        : ` en ese mes · ISO semana actual `}
                      {mesDetalle !== 0 && (
                        <span className="font-mono text-foreground">{getIsoWeekId(new Date())}</span>
                      )}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" type="button" onClick={() => setMesDetalle(null)}>
                    Cerrar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2 pt-4">
                {detalleLista.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay tareas este mes para los filtros actuales.</p>
                ) : (
                  [...detalleGrouped.entries()].map(([localidad, porEsp]) => (
                    <div key={localidad}>
                      <h3 className="border-b pb-1 text-sm font-semibold text-foreground">{localidad}</h3>
                      <div className="mt-2 space-y-4">
                        {[...porEsp.entries()].map(([esp, lista]) => (
                          <div key={`${localidad}-${esp}`}>
                            <Badge className={cn("mb-1.5 text-[0.7rem]", claseBadgeEspecialidad(esp))}>
                              {ESP_LABEL_LARGO[esp] ?? esp}
                            </Badge>
                            <ul className="space-y-2 border-l-2 border-border pl-3">
                              {lista.map((p) => (
                                <li key={p.id} className="rounded-md bg-muted/20 py-2 pl-2 pr-1">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="font-mono text-xs text-muted-foreground">{p.numero}</p>
                                      <p className="text-sm leading-snug">{p.descripcion}</p>
                                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[0.7rem] text-muted-foreground">
                                        <Badge variant="default" className="text-[0.65rem]">
                                          Frec.{p.frecuencia === "UNICA" ? " Única" : ` ${p.frecuencia}`}
                                        </Badge>
                                        <span>{nombreCentro(p.centro)}</span>
                                      </p>
                                      {p.semana_asignada?.trim() ? (
                                        <p className="mt-1.5 flex flex-wrap items-center gap-1">
                                          <Badge
                                            variant="default"
                                            className="border border-brand/35 bg-brand/10 text-[0.65rem] font-mono text-foreground"
                                          >
                                            {p.semana_asignada.trim()}
                                          </Badge>
                                          <span className="text-[0.72rem] text-muted-foreground">
                                            {semanaLabelDesdeIso(p.semana_asignada.trim())}
                                          </span>
                                        </p>
                                      ) : puedeAsignarSemana ? (
                                        <p className="mt-1 text-[0.7rem] text-amber-800/90 dark:text-amber-200/90">
                                          Sin semana ISO asignada
                                        </p>
                                      ) : null}
                                      {puedeAsignarSemana ? (
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8 text-xs"
                                            onClick={() => setPlanSemanaAbierto(p)}
                                          >
                                            {p.semana_asignada?.trim() ? "Cambiar semana" : "Asignar semana ISO"}
                                          </Button>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8 text-xs"
                                            onClick={() => setPlanMesesAbierto(p)}
                                          >
                                            Cambiar mes
                                          </Button>
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                      {badgeEstadoPlan(p.estado_vencimiento, p.dias_para_vencer)}
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {mesDetalle != null ? (
            <div className="mt-3 lg:hidden">
              <Button variant="outline" size="sm" type="button" className="w-full" onClick={() => setMesDetalle(null)}>
                Cerrar detalle de mes
              </Button>
            </div>
          ) : null}
        </aside>
      </div>

      {planSemanaAbierto ? (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-semana-plan-titulo"
            onClick={() => {
              if (!busySemana) setPlanSemanaAbierto(null);
            }}
          >
            <Card
              className="relative w-full max-w-md shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <CardHeader className="pb-2">
                <CardTitle id="dialog-semana-plan-titulo" className="text-lg">
                  Semana ISO objetivo
                </CardTitle>
                <CardDescription>
                  Selector acotado a semanas ISO que aparecen dentro del año {añoVisual} en la grilla gregoriana — podés repetir valores
                  de años distintos si la fila viene de otro período de planificación (se conserva igual).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{planSemanaAbierto.numero}</p>
                  <p className="text-sm">{planSemanaAbierto.descripcion}</p>
                  <p className="mt-2 text-[0.7rem] text-muted-foreground">
                    Centro <span className="font-medium text-foreground">{nombreCentro(planSemanaAbierto.centro)}</span>
                  </p>
                </div>

                <label className="block text-xs font-medium text-muted-foreground">
                  Semana objetivo ({añoVisual}/{añoVisual + 1} u otra cargada desde el doc)
                  <select
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm"
                    value={semanaDraft}
                    onChange={(e) => setSemanaDraft(e.target.value)}
                    disabled={busySemana}
                  >
                    <option value="">Sin semana objetivo — limpiar</option>
                    {opcionesSemanaSelect.map((w) => (
                      <option key={w} value={w}>
                        {w} — {semanaLabelDesdeIso(w)}
                      </option>
                    ))}
                  </select>
                </label>

                {msgSemanaModal ? (
                  <p className="text-sm text-destructive" role="alert">
                    {msgSemanaModal}
                  </p>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                  <Button type="button" variant="ghost" disabled={busySemana} onClick={() => setPlanSemanaAbierto(null)}>
                    Cancelar
                  </Button>
                  <Button type="button" disabled={busySemana} onClick={() => void ejecutarGuardarSemana()}>
                    {busySemana ? "Guardando…" : "Guardar"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

      {planMesesAbierto ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-meses-plan-titulo"
          onClick={() => { if (!busyMeses) setPlanMesesAbierto(null); }}
        >
          <Card className="relative w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="pb-2">
              <CardTitle id="dialog-meses-plan-titulo" className="text-lg">
                Cambiar meses programados
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="font-mono text-xs text-muted-foreground">{planMesesAbierto.numero}</p>
                <p className="text-sm">{planMesesAbierto.descripcion}</p>
                <p className="mt-1 text-[0.7rem] text-muted-foreground">
                  Centro <span className="font-medium text-foreground">{nombreCentro(planMesesAbierto.centro)}</span>
                </p>
              </div>

              {/* Meses activos — se quitan con × */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Meses asignados <span className="font-normal">(hacé clic en × para quitar)</span>
                </p>
                {mesesDraft.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {mesesDraft.map((m) => (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/10 px-2.5 py-0.5 text-xs font-medium capitalize text-foreground"
                      >
                        {etiquetaMes(m)}
                        <button
                          type="button"
                          disabled={busyMeses}
                          aria-label={`Quitar ${etiquetaMes(m)}`}
                          onClick={() => setMesesDraft((prev) => prev.filter((x) => x !== m))}
                          className="ml-0.5 rounded-full p-0.5 text-foreground/60 hover:bg-destructive/15 hover:text-destructive disabled:pointer-events-none"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[0.7rem] text-amber-700 dark:text-amber-300">
                    Sin meses asignados — la tarea quedará fuera del calendario.
                  </p>
                )}
              </div>

              {/* Grid para agregar meses */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Agregar mes
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {MESES_ANO_TRABAJO.map((m) => {
                    const yaEsta = mesesDraft.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={busyMeses || yaEsta}
                        onClick={() => setMesesDraft((prev) => [...prev, m].sort((a, b) => a - b))}
                        className={cn(
                          "rounded-md border px-2 py-1.5 text-xs font-medium capitalize transition-colors",
                          yaEsta
                            ? "cursor-default border-border/40 bg-muted/30 text-muted-foreground/40"
                            : "border-border bg-background text-muted-foreground hover:border-brand/50 hover:bg-brand/5 hover:text-foreground",
                        )}
                      >
                        {etiquetaMes(m).slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {msgMesesModal ? (
                <p className="text-sm text-destructive" role="alert">{msgMesesModal}</p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="ghost" disabled={busyMeses} onClick={() => setPlanMesesAbierto(null)}>
                  Cancelar
                </Button>
                <Button type="button" disabled={busyMeses} onClick={() => void ejecutarGuardarMeses()}>
                  {busyMeses ? "Guardando…" : "Guardar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
