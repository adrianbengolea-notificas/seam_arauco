"use client";

import type { ReactNode } from "react";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
import {
  cumplimientoPreventivos,
  correctivosPorEquipoFilas,
  detectarReincidencias,
} from "@/services/kpi";
import { useDenominacionesActivosPorIds } from "@/modules/assets/hooks";
import { usePreventivosSaVencimientoKpis, FRECUENCIAS_PLAN_MTSA_VENCIMIENTOS_TODAS } from "@/modules/scheduling/hooks";
import { DASHBOARD_RECENT_OT_LIMIT, useTodaysWorkOrdersCached } from "@/modules/work-orders/hooks";
import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Tonos rojo/ámbar/piedra + lima solo para “cerrada” (mix SEAM / Arauco) */
const ESTADO_COLORS: Record<string, string> = {
  BORRADOR: "#78716c",
  ABIERTA: "#b91c1c",
  EN_EJECUCION: "#ca8a04",
  PENDIENTE_FIRMA_SOLICITANTE: "#ea580c",
  LISTA_PARA_CIERRE: "#57534e",
  CERRADA: "#65a30d",
  ANULADA: "#9f1239",
};

const TIPO_COLORS = ["#b91c1c", "#ea580c", "#ca8a04", "#78716c", "#44403c", "#65a30d"];

const chartTooltip = {
  contentStyle: {
    borderRadius: "12px",
    border: "1px solid color-mix(in oklch, var(--border) 80%, transparent)",
    background: "var(--surface)",
    boxShadow: "0 12px 40px color-mix(in oklch, var(--foreground) 12%, transparent)",
    padding: "10px 14px",
  },
  labelStyle: { fontWeight: 700, marginBottom: 4, color: "var(--foreground)" },
  itemStyle: { fontSize: 12, color: "var(--muted-fg)" },
};

type BarCorrectivoEquipo = {
  codigo: string;
  count: number;
  nombreComun?: string;
};

function YAxisTickCorrectivoEquipo(props: {
  x: number;
  y: number;
  payload: { value: string };
  rows: BarCorrectivoEquipo[];
}) {
  const { x, y, payload, rows } = props;
  const row = rows.find((r) => r.codigo === payload.value);
  const nombre = row?.nombreComun?.trim();
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="end" fill="var(--foreground)" fontSize={11} x={0} y={0} dy={nombre ? 0 : 4}>
        {payload.value}
      </text>
      {nombre ? (
        <text
          textAnchor="end"
          fill="var(--muted-fg)"
          fontSize={9}
          x={0}
          y={0}
          dy={14}
        >
          {nombre.length > 44 ? `${nombre.slice(0, 42)}…` : nombre}
        </text>
      ) : null}
    </g>
  );
}

function StatCard({
  label,
  hint,
  children,
  accent,
}: {
  label: string;
  hint: string;
  children: ReactNode;
  accent?: "brand" | "neutral";
}) {
  return (
    <Card className="overflow-hidden">
      <div
        className={
          accent === "brand"
            ? "h-1 w-full bg-gradient-to-r from-brand via-brand to-accent-warm"
            : "h-1 w-full bg-stone-300 dark:bg-stone-600"
        }
      />
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-muted">{label}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent className="pb-5 pt-1">
        <div className="font-mono text-lg font-semibold tabular-nums tracking-tight text-foreground sm:text-xl">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

function ColaChip({
  count,
  label,
  hint,
  href,
  urgente,
}: {
  count: number;
  label: string;
  hint: string;
  href: string;
  urgente?: boolean;
}) {
  return (
    <Link
      href={href}
      title={hint}
      className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-brand/50 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <span
        className={
          count > 0 && urgente
            ? "font-mono text-2xl font-bold tabular-nums leading-none text-destructive"
            : count > 0
              ? "font-mono text-2xl font-bold tabular-nums leading-none text-foreground"
              : "font-mono text-2xl font-bold tabular-nums leading-none text-muted-foreground"
        }
      >
        {count}
      </span>
      <span className="text-xs font-medium leading-tight text-muted-foreground">{label}</span>
    </Link>
  );
}

export function DashboardPanel() {
  const { rol, puede, authLoading, user, profile } = usePermisos();
  const router = useRouter();
  useEffect(() => {
    if (authLoading) return;
    if (rol === "cliente_arauco") router.replace("/cliente");
  }, [rol, router, authLoading]);

  /** Solo superadmin: `null` = todos los centros. Resto de roles: siempre el centro del perfil. */
  const [centroFiltro, setCentroFiltro] = useState<string | null>(null);
  /**
   * Misma prioridad que Firestore `callerCentroPuedeLeerOtCentro`: si existe `centros_asignados`,
   * el alcance operativo es esa lista; si no, el campo `centro`. Evita técnico con centro vacío
   * pero plantas en la lista — que antes caía en `centroParaOt === null` y consultas indebidas.
   */
  const centrosPerfil = useMemo(() => {
    const lista = profile?.centros_asignados;
    if (Array.isArray(lista) && lista.length > 0) {
      return [...new Set(lista.map((k) => String(k).trim()).filter(Boolean))];
    }
    const c = profile?.centro?.trim();
    return c ? [c] : [];
  }, [profile]);
  const centroPerfil = centrosPerfil[0] ?? null;
  const centrosLabel =
    centrosPerfil.length > 0 ? centrosPerfil.map((c) => nombreCentro(c)).join(", ") : "—";
  const centroParaOt = useMemo(() => {
    if (rol === "tecnico") {
      if (centrosPerfil.length === 0) return null;
      return centrosPerfil.length === 1 ? centrosPerfil[0]! : [...centrosPerfil];
    }
    if (rol === "superadmin") return centroFiltro;
    return centroPerfil;
  }, [rol, centrosPerfil, centroPerfil, centroFiltro]);

  // No disparar queries de trabajo hasta que el perfil esté cargado (evita query
  // con centro=null que puede dar permission-denied en Firestore para técnicos)
  const perfilListo = Boolean(user) && !authLoading;

  const { rows, loading, error } = useTodaysWorkOrdersCached(centroParaOt, {
    uid: user?.uid ?? "",
    rol: profile?.rol ?? "tecnico",
  }, { enabled: perfilListo });

  const centroKpi = rol === "superadmin" ? centroFiltro ?? "" : centroPerfil ?? "";
  const verTodosSa = rol === "superadmin" && centroFiltro === null;
  const verKpiVencimientosSa = puede("programa:ver_vencimientos_sa");
  const {
    vencidos,
    proximos,
    alDia,
    sinFecha,
    loading: saKpiLoading,
    error: saKpiError,
  } = usePreventivosSaVencimientoKpis({
    authUid: perfilListo ? user?.uid : undefined,
    centro: verTodosSa ? undefined : centroKpi || centroPerfil,
    verTodosLosCentros: verTodosSa,
    enabled: verKpiVencimientosSa,
    frecuenciasPlanMtsa: FRECUENCIAS_PLAN_MTSA_VENCIMIENTOS_TODAS,
  });

  const kpi = useMemo(() => cumplimientoPreventivos(rows), [rows]);

  const reincidencias = useMemo(
    () => detectarReincidencias(rows, { ventanaDias: 90, umbral: 3 }),
    [rows],
  );

  const firestoreError = error ?? saKpiError;

  const porEstado = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      m.set(r.estado, (m.get(r.estado) ?? 0) + 1);
    }
    return [...m.entries()].map(([name, value]) => ({ name, value }));
  }, [rows]);

  const porTipo = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      m.set(r.tipo_trabajo, (m.get(r.tipo_trabajo) ?? 0) + 1);
    }
    return [...m.entries()].map(([name, value]) => ({ name, value }));
  }, [rows]);

  const filasCorrectivosTop = useMemo(() => correctivosPorEquipoFilas(rows).slice(0, 8), [rows]);
  const assetIdsTopCorrectivos = useMemo(
    () => filasCorrectivosTop.map((f) => f.asset_id),
    [filasCorrectivosTop],
  );
  const { byAssetId: denomPorActivo } = useDenominacionesActivosPorIds(assetIdsTopCorrectivos);
  const correctivosBars = useMemo((): BarCorrectivoEquipo[] => {
    return filasCorrectivosTop.map((f) => ({
      codigo: f.codigo,
      count: f.count,
      nombreComun: denomPorActivo[f.asset_id],
    }));
  }, [filasCorrectivosTop, denomPorActivo]);

  const esSupervisorOMas = puede("ot:ver_todas");

  const colaCounts = useMemo(() => {
    const hoy = Date.now();
    let abierta = 0, en_ejecucion = 0, pendiente_firma = 0, lista_cierre = 0, sin_asignar = 0, atrasados = 0;
    for (const r of rows) {
      if (r.estado === "ABIERTA") abierta++;
      if (r.estado === "EN_EJECUCION") en_ejecucion++;
      if (r.estado === "PENDIENTE_FIRMA_SOLICITANTE") pendiente_firma++;
      if (r.estado === "LISTA_PARA_CIERRE") lista_cierre++;
      const activa = r.estado !== "CERRADA" && r.estado !== "ANULADA" && r.estado !== "BORRADOR";
      if (activa && !r.tecnico_asignado_uid) sin_asignar++;
      if (
        activa &&
        (r.tipo_trabajo === "PREVENTIVO" || r.tipo_trabajo === "PREDICTIVO") &&
        (r.fecha_inicio_programada?.toMillis?.() ?? 0) > 0 &&
        (r.fecha_inicio_programada?.toMillis?.() ?? 0) < hoy
      ) atrasados++;
    }
    return { abierta, en_ejecucion, pendiente_firma, lista_cierre, sin_asignar, atrasados };
  }, [rows]);

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-6 border-b border-border/80 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted">Resumen</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {rol === "tecnico" ? "Tu panel" : "Panel operativo"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            {rol === "tecnico" ? (
              <>
                Acá ves un vistazo de{" "}
                <span className="font-medium text-foreground">tus órdenes asignadas</span> y de las que siguen{" "}
                <span className="font-medium text-foreground">sin técnico</span> en el pool, en{" "}
                {centrosPerfil.length === 1 ? "tu centro" : "tus centros"}{" "}
                <span className="text-foreground">{centrosLabel}</span>. Para gestionar el día a día usá{" "}
                <Link href="/tareas" className="font-medium text-primary underline underline-offset-2">
                  Órdenes de trabajo
                </Link>
                .
              </>
            ) : rol === "superadmin" ? (
              <>
                Elegí una dependencia o dejá <span className="font-medium text-foreground">Todas las plantas</span>{" "}
                para ver totales. Más abajo:{" "}
                <span className="font-medium text-foreground">avisos del plan</span> (cada 6 meses o al año) y gráficos
                sobre <span className="font-medium text-foreground">OTs recientes</span> (solo las últimas{" "}
                {DASHBOARD_RECENT_OT_LIMIT} actualizadas — no reemplaza un informe de fin de mes).
              </>
            ) : (
              <>
                Vista para <span className="font-medium text-foreground">supervisión</span> en{" "}
                {centrosPerfil.length === 1 ? "tu planta" : "tus plantas"}{" "}
                <span className="text-foreground">{centrosLabel}</span>. Arriba: estado del plan
                semestral/anual. Abajo: órdenes recientes (máximo {DASHBOARD_RECENT_OT_LIMIT} por última actualización).
                Para mediciones y planillas cargadas en campo, usá los{" "}
                <span className="font-medium text-foreground">atajos a registros</span> más abajo.
              </>
            )}
          </p>
        </div>
        {rol === "superadmin" ? (
          <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
            <label htmlFor="dashboard-centro" className="text-xs font-semibold uppercase tracking-wide text-muted">
              Centro / dependencia
            </label>
            <select
              id="dashboard-centro"
              value={centroFiltro ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setCentroFiltro(v === "" ? null : v);
              }}
              className="flex h-10 w-full min-w-[220px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-sm transition-[border-color,box-shadow] duration-150 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 sm:w-auto"
            >
              <option value="">Todas las plantas</option>
              {KNOWN_CENTROS.map((c) => (
                <option key={c} value={c}>
                  {nombreCentro(c)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </header>

      {loading || authLoading ? (
        <p className="text-sm font-medium text-muted">
          {authLoading ? "Cargando tu perfil y órdenes…" : "Cargando órdenes recientes…"}
        </p>
      ) : null}
      {firestoreError ? (
        <p className="rounded-lg border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {mensajeErrorFirebaseParaUsuario(firestoreError)}
        </p>
      ) : null}

      {!authLoading && user && !profile ? (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100"
          role="status"
        >
          No encontramos tu ficha de usuario en el sistema: por ahora se te trata como técnico sin planta asignada.
          Pedile a administración que complete tu perfil (centro y rol) o revisá que estés en el proyecto correcto.
        </p>
      ) : null}

      {esSupervisorOMas && perfilListo && puede("reportes:ver_cumplimiento") ? (
        <div
          className="rounded-xl border border-border/80 bg-muted/30 px-4 py-3 text-sm leading-relaxed text-foreground"
          role="note"
        >
          <span className="font-semibold text-foreground">Importante:</span> los gráficos y totales de órdenes de este
          panel usan solo las <span className="font-mono tabular-nums">{DASHBOARD_RECENT_OT_LIMIT}</span> órdenes más
          recientemente <span className="font-medium">actualizadas</span>, no todo el mes ni todo el histórico. Para
          cerrar números de período o certificaciones, usá el{" "}
          <Link href="/reportes/cumplimiento" className="font-medium text-primary underline underline-offset-2">
            reporte de cumplimiento
          </Link>
          .
        </div>
      ) : null}

      {verKpiVencimientosSa ? (
        <section aria-label="Estado de avisos del plan de mantenimiento (M/T/S/A)" className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Preventivos por plan: vencimientos</h2>
          <p className="text-xs text-muted-foreground">
            Mensual, trimestral, semestral y anual:{" "}
            <span className="font-medium text-foreground/90">avisos del calendario de mantenimiento</span>, no un conteo
            de órdenes sueltas. Cada aviso puede tener una o más OTs asociadas.
          </p>
          {saKpiLoading ? (
            <p className="text-xs text-muted-foreground">Cargando vencimientos…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-4">
              <Link
                href="/programa/preventivos?pestana=vencimientos&filter=vencido"
                className="block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <StatCard
                  label="Fuera de plazo"
                  hint="Avisos cuya fecha límite de ejecución ya pasó"
                  accent="brand"
                >
                  <span className="text-destructive">{vencidos}</span>
                  <span className="ml-2 text-sm font-normal text-muted-foreground"> avisos</span>
                </StatCard>
              </Link>
              <Link
                href="/programa/preventivos?pestana=vencimientos&filter=proximo"
                className="block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <StatCard
                  label="Vencen en 30 días"
                  hint="Hay que planificarlos pronto para no pasarse de la fecha"
                  accent="neutral"
                >
                  <span className="text-amber-700 dark:text-amber-400">{proximos}</span>
                  <span className="ml-2 text-sm font-normal text-muted-foreground"> avisos</span>
                </StatCard>
              </Link>
              <Link
                href="/programa/preventivos?pestana=vencimientos&filter=ok"
                className="block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <StatCard
                  label="En regla"
                  hint="Próximo vencimiento del plan a más de 30 días (no indica OT cerrada)"
                  accent="neutral"
                >
                  <span className="text-emerald-700 dark:text-emerald-400">{alDia}</span>
                  <span className="ml-2 text-sm font-normal text-muted-foreground"> avisos</span>
                </StatCard>
              </Link>
              <Link
                href="/programa/preventivos?pestana=vencimientos&tab=sin_historial"
                className="block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <StatCard
                  label="Sin ejecución cargada"
                  hint="Todavía no hay en el sistema una fecha de última ejecución para ese aviso"
                  accent="neutral"
                >
                  <span className="text-muted-foreground">{sinFecha}</span>
                  <span className="ml-2 text-sm font-normal text-muted-foreground"> avisos</span>
                </StatCard>
              </Link>
            </div>
          )}
        </section>
      ) : null}

      {esSupervisorOMas && !loading ? (
        <section aria-label="Resumen de cola en la muestra actual" className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold text-foreground">Órdenes en curso (muestra rápida)</h2>
            <p className="text-xs text-muted-foreground">
              Números calculados solo sobre las {rows.length} órdenes que muestra este panel.{" "}
              <Link href="/tareas" className="underline underline-offset-2 hover:text-foreground">
                Abrir listado de tareas
              </Link>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <ColaChip
              count={colaCounts.abierta}
              label="Por arrancar"
              hint="Órdenes abiertas, aún sin iniciar trabajo"
              href="/tareas?estado=PENDIENTE"
            />
            <ColaChip
              count={colaCounts.en_ejecucion}
              label="Trabajo en marcha"
              hint="Orden iniciada por el técnico"
              href="/tareas?estado=EN_CURSO"
            />
            <ColaChip
              count={colaCounts.pendiente_firma}
              label="Falta firma en planta"
              hint="Esperando firma de quien pidió el trabajo"
              href="/tareas?estado=EN_CURSO"
            />
            <ColaChip
              count={colaCounts.lista_cierre}
              label="Para cerrar"
              hint="Listas para el cierre formal en el sistema"
              href="/tareas?estado=EN_CURSO"
            />
            <ColaChip
              count={colaCounts.sin_asignar}
              label="Sin técnico"
              hint="Siguen en el pool: ningún técnico asignado todavía"
              href="/tareas"
              urgente
            />
            <ColaChip
              count={colaCounts.atrasados}
              label="Fecha pasada"
              hint="Preventivo o predictivo con fecha programada vencida y orden aún no cerrada"
              href="/tareas"
              urgente
            />
          </div>
        </section>
      ) : null}

      {esSupervisorOMas ? (
        <section aria-label="Atajos del supervisor" className="space-y-5">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Atajos de trabajo</h2>
            <div className="flex flex-wrap gap-2">
              {puede("ot:crear_manual") ? (
                <Link
                  href="/tareas/nueva"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-3 text-xs font-semibold text-brand transition-colors hover:bg-brand/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  + Nueva orden manual
                </Link>
              ) : null}
              <Link
                href="/programa-semanal"
                className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Calendario semanal
              </Link>
              {puede("programa:ver_vencimientos_sa") ? (
                <Link
                  href="/programa/preventivos?pestana=vencimientos"
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  🗓️ Vencimientos preventivos (M/T/S/A)
                </Link>
              ) : null}
              <Link
                href="/tareas"
                className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Todas las órdenes
              </Link>
              {puede("materiales:ver_reporting") ? (
                <Link
                  href="/materiales"
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  Stock y consumos
                </Link>
              ) : null}
            </div>
          </div>

          <div id="registros-mediciones">
            <h2 className="mb-1 text-sm font-semibold text-foreground">Mediciones y registros informados</h2>
            <p className="mb-3 max-w-2xl text-xs text-muted-foreground">
              En órdenes <span className="font-medium text-foreground/90">cerradas</span> están las planillas digitales
              y los valores que cargó el técnico. El plan semestral/anual muestra si ya quedó registrada una ejecución
              por aviso.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/tareas?estado=COMPLETADA"
                className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Órdenes cerradas (planillas y mediciones)
              </Link>
              {puede("programa:ver_vencimientos_sa") ? (
                <Link
                  href="/programa/preventivos?pestana=vencimientos#preventivos-sa-detalle"
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  Lista con historial / sin OT
                </Link>
              ) : null}
              {puede("programa:ver_vencimientos_sa") ? (
                <Link
                  href="/programa/preventivos?pestana=vencimientos#resumen-kpis"
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  Resumen semestral / anual
                </Link>
              ) : null}
              {puede("reportes:ver_cumplimiento") ? (
                <Link
                  href="/reportes/cumplimiento"
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  Informe planificado vs ejecutado (mes)
                </Link>
              ) : null}
              {puede("programa:ver_calendario_anual") ? (
                <Link
                  href="/programa/preventivos"
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  Calendario anual de avisos
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Indicadores sobre órdenes recientes</h2>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono font-semibold tabular-nums text-foreground">{rows.length}</span> órdenes en esta
            vista. Los gráficos usan como máximo las {DASHBOARD_RECENT_OT_LIMIT} últimas por fecha de actualización en el
            sistema (no equivale a “todo lo del mes”).
          </p>
        </div>
        <div className="grid gap-4 sm:max-w-xl">
          <StatCard
            label="Preventivos cerrados dentro de la ventana"
            hint="De las preventivas que aparecen acá: cuántas se cerraron dentro de 7 días desde la fecha programada"
            accent="brand"
          >
            <>
              <span className="text-accent-lime">{kpi.cerradosATiempo}</span>
              <span className="text-muted"> / </span>
              <span>{kpi.programados}</span>
              <span className="ml-2 text-sm font-normal text-muted"> con cierre a tiempo</span>
            </>
          </StatCard>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cantidad de órdenes por estado</CardTitle>
            <CardDescription>
              Reparto en esta muestra. Entre paréntesis: número absoluto de órdenes.{" "}
              <Link href="/tareas" className="font-medium text-primary underline-offset-2 hover:underline">
                Ir a tareas
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] w-full min-w-0">
            {porEstado.length === 0 ? (
              <p className="text-sm text-muted">Sin datos para graficar.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 8, bottom: 8 }}>
                  <Pie
                    data={porEstado}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={2}
                    label={({ name, percent, value }) =>
                      `${name} ${((percent ?? 0) * 100).toFixed(0)}% (${value as number})`
                    }
                    labelLine={{ stroke: "var(--border)", strokeWidth: 1 }}
                  >
                    {porEstado.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={ESTADO_COLORS[entry.name] ?? TIPO_COLORS[i % TIPO_COLORS.length]}
                        stroke="var(--surface)"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    {...chartTooltip}
                    formatter={(value, name) => [`${value as number} OTs`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cantidad de órdenes por tipo de trabajo</CardTitle>
            <CardDescription>
              Preventivo, correctivo, emergencia, etc. Sobre la misma muestra reciente.{" "}
              <Link href="/tareas" className="font-medium text-primary underline-offset-2 hover:underline">
                Ir a tareas
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] w-full min-w-0">
            {porTipo.length === 0 ? (
              <p className="text-sm text-muted">Sin datos para graficar.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 8, bottom: 8 }}>
                  <Pie
                    data={porTipo}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={2}
                    label={({ name, percent, value }) =>
                      `${name} ${((percent ?? 0) * 100).toFixed(0)}% (${value as number})`
                    }
                    labelLine={{ stroke: "var(--border)", strokeWidth: 1 }}
                  >
                    {porTipo.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={TIPO_COLORS[i % TIPO_COLORS.length]}
                        stroke="var(--surface)"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    {...chartTooltip}
                    formatter={(value, name) => [`${value as number} OTs`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Equipos con más correctivos o emergencias</CardTitle>
          <CardDescription>
            Solo entre las órdenes de esta vista (no es el ranking histórico completo). Código de equipo y nombre del
            maestro.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[400px] w-full min-w-0">
          {correctivosBars.length === 0 ? (
            <p className="text-sm text-muted">Sin correctivos en la muestra.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={correctivosBars} layout="vertical" margin={{ left: 8, right: 20, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="var(--border)" opacity={0.6} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: "var(--muted-fg)", fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="codigo"
                  width={208}
                  interval={0}
                  tick={(p) => (
                    <YAxisTickCorrectivoEquipo
                      x={Number(p.x)}
                      y={Number(p.y)}
                      payload={p.payload as { value: string }}
                      rows={correctivosBars}
                    />
                  )}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  {...chartTooltip}
                  labelFormatter={(_, p) => {
                    const pl = p as { payload?: BarCorrectivoEquipo } | undefined;
                    const c = pl?.payload?.codigo ?? "";
                    const n = pl?.payload?.nombreComun?.trim();
                    return n ? `${c} — ${n}` : c;
                  }}
                />
                <Legend wrapperStyle={{ paddingTop: 12 }} />
                <Bar
                  dataKey="count"
                  name="Órdenes"
                  fill="var(--brand)"
                  radius={[0, 10, 10, 0]}
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {reincidencias.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Equipos con muchas fallas repetidas</CardTitle>
            <CardDescription>
              Tres o más correctivos o emergencias en los últimos 90 días, contando solo dentro de la muestra actual.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {reincidencias.map((r) => (
                <li key={r.asset_id} className="flex justify-between gap-4">
                  <Link
                    href={`/activos/${r.asset_id}`}
                    className="font-mono text-foreground underline underline-offset-2 hover:text-brand focus-visible:outline-none"
                  >
                    {r.codigo_activo_snapshot || r.asset_id}
                  </Link>
                  <span className="font-semibold text-destructive">{r.eventos} en el período</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
