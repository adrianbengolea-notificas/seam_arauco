"use client";

import type { ReactNode } from "react";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { cumplimientoPreventivos, correctivosPorEquipo } from "@/services/kpi";
import { usePreventivosSaVencimientoKpis } from "@/modules/scheduling/hooks";
import { useMaterialsCatalogLive } from "@/modules/materials/hooks";
import { useTodaysWorkOrdersCached } from "@/modules/work-orders/hooks";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { cn } from "@/lib/utils";
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
  const { rol, puede } = usePermisos();
  const router = useRouter();
  const { user } = useAuthUser();
  const { profile, loading: profileLoading } = useUserProfile(user?.uid);
  useEffect(() => {
    if (rol === "cliente_arauco") router.replace("/cliente");
  }, [rol, router]);

  /** Solo superadmin: `null` = todos los centros. Resto de roles: siempre el centro del perfil. */
  const [centroFiltro, setCentroFiltro] = useState<string | null>(null);
  const centroPerfil = profile?.centro?.trim() || null;
  const centroParaOt = useMemo(() => {
    if (rol === "tecnico") return centroPerfil;
    if (rol === "superadmin") return centroFiltro;
    return centroPerfil;
  }, [rol, centroPerfil, centroFiltro]);

  const { rows, loading, error } = useTodaysWorkOrdersCached(centroParaOt, {
    uid: user?.uid ?? "",
    rol: profile?.rol ?? "tecnico",
  });
  const { itemsBajoStock: itemsBajoStockRaw, error: materialsCatalogError } = useMaterialsCatalogLive(600);
  const itemsBajoStock = useMemo(() => {
    if (rol === "superadmin" || !centroPerfil) return itemsBajoStockRaw;
    return itemsBajoStockRaw.filter((it) => {
      const c = it.centro_almacen?.trim();
      return !c || c === centroPerfil;
    });
  }, [rol, centroPerfil, itemsBajoStockRaw]);
  const verCardMaterialesBajoStock = puede("materiales:ingresar_stock") || puede("materiales:ver_reporting");

  const centroKpi = rol === "superadmin" ? centroFiltro ?? "" : profile?.centro ?? "";
  const verTodosSa = rol === "superadmin" && centroFiltro === null;
  const {
    vencidos,
    proximos,
    alDia,
    loading: saKpiLoading,
    error: saKpiError,
  } = usePreventivosSaVencimientoKpis({
    authUid: user?.uid,
    centro: verTodosSa ? undefined : centroKpi || profile?.centro,
    verTodosLosCentros: verTodosSa,
  });

  const kpi = useMemo(() => cumplimientoPreventivos(rows), [rows]);

  const firestoreError = error ?? saKpiError ?? materialsCatalogError;

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
            {rol === "tecnico" ? "Tu panel" : "Panel operativo"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            {rol === "tecnico" ? (
              <>
                Tus órdenes asignadas y vencimientos S/A del centro{" "}
                <span className="font-mono text-foreground">{profile?.centro ?? "—"}</span>.
              </>
            ) : rol === "superadmin" ? (
              <>
                Vista general de la operación. Podés consolidar todos los centros o filtrar por dependencia; los
                gráficos usan una muestra de órdenes recientes desde Firestore.
              </>
            ) : (
              <>
                Indicadores de tu planta ({centroPerfil ?? "—"}). Los gráficos usan una muestra de órdenes recientes
                del centro asignado a tu perfil.
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
              <option value="">Todos los centros</option>
              {KNOWN_CENTROS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </header>

      {loading || profileLoading ? (
        <p className="text-sm font-medium text-muted">
          {profileLoading ? "Cargando tu perfil y órdenes…" : "Cargando órdenes recientes…"}
        </p>
      ) : null}
      {firestoreError ? (
        <p className="rounded-lg border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {firestoreError.message}
        </p>
      ) : null}

      {!profileLoading && user && !profile ? (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100"
          role="status"
        >
          No hay documento en <span className="font-mono">users</span> para tu cuenta: el sistema asume rol técnico
          sin centro hasta que exista el perfil. Contactá administración o revisá reglas Firestore / base de datos
          correcta.
        </p>
      ) : null}

      {puede("programa:ver") ? (
        <section aria-label="Preventivos semestrales y anuales" className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Preventivos S/A</h2>
          {saKpiLoading ? (
            <p className="text-xs text-muted-foreground">Cargando vencimientos…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Link
                href="/programa/vencimientos?filter=vencido"
                className="block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <StatCard
                  label="Vencidos"
                  hint="Semestrales/anuales con fecha de vencimiento superada"
                  accent="brand"
                >
                  <span className="text-destructive">{vencidos}</span>
                  <span className="ml-2 text-sm font-normal text-muted-foreground"> avisos</span>
                </StatCard>
              </Link>
              <Link
                href="/programa/vencimientos?filter=proximo"
                className="block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <StatCard
                  label="Próximos (30 días)"
                  hint="Vencen en el mes próximo"
                  accent="neutral"
                >
                  <span className="text-amber-700 dark:text-amber-400">{proximos}</span>
                  <span className="ml-2 text-sm font-normal text-muted-foreground"> avisos</span>
                </StatCard>
              </Link>
              <StatCard label="Al día" hint="Estado OK según vencimiento calculado" accent="neutral">
                <span className="text-emerald-700 dark:text-emerald-400">{alDia}</span>
                <span className="ml-2 text-sm font-normal text-muted-foreground"> avisos</span>
              </StatCard>
            </div>
          )}
        </section>
      ) : null}

      <div
        className={cn(
          "grid gap-4 sm:grid-cols-2",
          verCardMaterialesBajoStock ? "lg:grid-cols-3" : "lg:grid-cols-2",
        )}
      >
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
            rol === "tecnico"
              ? "Hasta 80 OT recientes que tenés asignadas en tu centro"
              : rol === "superadmin" && centroFiltro === null
                ? "Hasta 80 OT recientes (todos los centros)"
                : `Hasta 80 OT recientes del centro ${rol === "superadmin" ? (centroFiltro ?? "—") : (centroPerfil ?? "—")}`
          }
          accent="neutral"
        >
          <>{rows.length} registros</>
        </StatCard>
        {verCardMaterialesBajoStock ? (
          <Link
            href="/superadmin/materiales?filter=bajo_stock"
            className="block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-brand/40"
          >
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
        ) : null}
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
