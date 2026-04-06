"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { cumplimientoPreventivos, correctivosPorEquipo } from "@/services/kpi";
import { useMaterialsCatalogLive } from "@/modules/materials/hooks";
import { useTodaysWorkOrdersCached } from "@/modules/work-orders/hooks";
import Link from "next/link";
import { useMemo, useState } from "react";
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

export function DashboardPanel() {
  /** `null` = todos los centros (vista general). */
  const [centroFiltro, setCentroFiltro] = useState<string | null>(null);
  const { rows, loading, error } = useTodaysWorkOrdersCached(centroFiltro);
  const { itemsBajoStock } = useMaterialsCatalogLive(600);

  const kpi = useMemo(() => cumplimientoPreventivos(rows), [rows]);

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

  const correctivosBars = useMemo(() => {
    const map = correctivosPorEquipo(rows);
    return Object.entries(map)
      .map(([equipo, count]) => ({ equipo, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [rows]);

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-6 border-b border-border/80 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted">Indicadores</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Panel operativo
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Vista general de la operación. Podés acotar por dependencia o centro; los gráficos usan una muestra
            de órdenes recientes desde Firestore.
          </p>
        </div>
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
            <option value="">Todos los centros</option>
            {KNOWN_CENTROS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </header>

      {loading ? (
        <p className="text-sm font-medium text-muted">Cargando órdenes recientes…</p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Preventivos" hint="Programados vs cerrados a tiempo (ventana ±7 días)" accent="brand">
          <>
            <span className="text-accent-lime">{kpi.cerradosATiempo}</span>
            <span className="text-muted"> / </span>
            <span>{kpi.programados}</span>
            <span className="ml-2 text-sm font-normal text-muted"> cerrados a tiempo</span>
          </>
        </StatCard>
        <StatCard
          label="Órdenes en muestra"
          hint={
            centroFiltro === null
              ? "Hasta 80 OT recientes (todos los centros)"
              : `Hasta 80 OT recientes filtradas por ${centroFiltro}`
          }
          accent="neutral"
        >
          <>{rows.length} registros</>
        </StatCard>
        <Link href="/superadmin/materiales?filter=bajo_stock" className="block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-brand/40">
          <StatCard
            label="Materiales con stock bajo"
            hint="Catálogo con stock_disponible ≤ stock_minimo"
            accent={itemsBajoStock.length > 0 ? "brand" : "neutral"}
          >
            <span className={itemsBajoStock.length > 0 ? "text-destructive" : undefined}>
              {itemsBajoStock.length}
            </span>
            <span className="ml-2 text-sm font-normal text-muted"> ítems</span>
          </StatCard>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>OT por estado</CardTitle>
            <CardDescription>Proporción según el estado actual en la muestra</CardDescription>
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
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
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
                  <Tooltip {...chartTooltip} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>OT por tipo de trabajo</CardTitle>
            <CardDescription>Mix de preventivo, correctivo y otras categorías</CardDescription>
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
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
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
                  <Tooltip {...chartTooltip} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Correctivos y emergencias por equipo</CardTitle>
          <CardDescription>Ranking dentro de la muestra actual (no incluye histórico completo)</CardDescription>
        </CardHeader>
        <CardContent className="h-[340px] w-full min-w-0">
          {correctivosBars.length === 0 ? (
            <p className="text-sm text-muted">Sin correctivos en la muestra.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={correctivosBars} layout="vertical" margin={{ left: 4, right: 20, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="var(--border)" opacity={0.6} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: "var(--muted-fg)", fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="equipo"
                  width={118}
                  tick={{ fill: "var(--foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip {...chartTooltip} />
                <Legend wrapperStyle={{ paddingTop: 12 }} />
                <Bar
                  dataKey="count"
                  name="Cant. OT"
                  fill="var(--brand)"
                  radius={[0, 10, 10, 0]}
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
