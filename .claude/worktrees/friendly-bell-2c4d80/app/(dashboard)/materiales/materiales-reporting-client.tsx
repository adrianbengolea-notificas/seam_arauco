"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useMaterialesOT } from "@/modules/materials/hooks";
import type { MaterialOTConsumoRow, MaterialesOTFilters } from "@/modules/materials/types";
import { useAuth } from "@/modules/users/hooks";
import { endOfMonth, format, parse, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { Download } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const PAGE_SIZE = 20;

function pct(part: number, total: number): number {
  if (!total || !Number.isFinite(total)) return 0;
  return Math.round((part / total) * 100);
}

function especialidadLabel(code: MaterialOTConsumoRow["otEspecialidad"]): string {
  switch (code) {
    case "AA":
      return "AA";
    case "ELECTRICO":
      return "Eléc.";
    case "GG":
      return "GG";
    case "HG":
      return "HG";
    default:
      return "—";
  }
}

function fechaMostrada(r: MaterialOTConsumoRow): Date {
  const f = r.otFechaCompletada?.toDate?.() ?? r.creadoAt?.toDate?.();
  return f && !Number.isNaN(f.getTime()) ? f : new Date();
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(rows: MaterialOTConsumoRow[]): string {
  const headers = [
    "Descripción",
    "Cantidad",
    "Unidad",
    "Origen",
    "OT_id",
    "Número aviso",
    "Tipo_OT",
    "Especialidad",
    "Centro_OT",
    "Fecha",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const fecha = fechaMostrada(r);
    lines.push(
      [
        csvEscape(r.descripcion),
        String(r.cantidad),
        csvEscape(r.unidad),
        r.origen,
        r.otId,
        csvEscape(r.otNumeroAviso),
        r.otTipo ?? "",
        r.otEspecialidad ?? "",
        csvEscape(r.otCentro),
        csvEscape(fecha.toISOString()),
      ].join(","),
    );
  }
  return "\uFEFF" + lines.join("\n");
}

function origenBadgeClass(origen: "ARAUCO" | "EXTERNO"): string {
  return origen === "ARAUCO"
    ? "border-emerald-600/45 bg-emerald-600/15 text-emerald-950 dark:text-emerald-100"
    : "border-amber-600/45 bg-amber-600/15 text-amber-950 dark:text-amber-100";
}

export function MaterialesReportingClient() {
  const { user, profile, loading: authLoading } = useAuth();
  const [monthStr, setMonthStr] = useState(() => format(new Date(), "yyyy-MM"));
  const [tipo, setTipo] = useState<MaterialesOTFilters["tipo"]>("todos");
  const [esp, setEsp] = useState<MaterialesOTFilters["especialidad"]>("todos");
  const [origen, setOrigen] = useState<MaterialesOTFilters["origen"]>("todos");
  const [centro, setCentro] = useState("");
  const [page, setPage] = useState(0);
  const centroSeeded = useRef(false);

  useEffect(() => {
    if (centroSeeded.current || !profile?.centro) return;
    setCentro(profile.centro);
    centroSeeded.current = true;
  }, [profile?.centro]);

  const { desde, hasta } = useMemo(() => {
    const base = parse(monthStr, "yyyy-MM", new Date());
    return { desde: startOfMonth(base), hasta: endOfMonth(base) };
  }, [monthStr]);

  const filters = useMemo(
    () =>
      ({
        tipo,
        especialidad: esp,
        origen,
        desde,
        hasta,
        centro: centro.trim() || undefined,
      }) satisfies MaterialesOTFilters,
    [tipo, esp, origen, desde, hasta, centro],
  );

  const materialesQueryEnabled = Boolean(user) && !authLoading;
  const { materiales, totales, loading, error, hitLimit } = useMaterialesOT(filters, {
    enabled: materialesQueryEnabled,
  });

  const pageRows = useMemo(() => {
    const start = page * PAGE_SIZE;
    return materiales.slice(start, start + PAGE_SIZE);
  }, [materiales, page]);

  const totalPages = Math.max(1, Math.ceil(materiales.length / PAGE_SIZE));

  const gruposPorOt = useMemo(() => {
    const map = new Map<string, MaterialOTConsumoRow[]>();
    for (const r of materiales) {
      const list = map.get(r.otId) ?? [];
      list.push(r);
      map.set(r.otId, list);
    }
    const entries = [...map.entries()].map(([otId, items]) => {
      const maxT = Math.max(...items.map((i) => fechaMostrada(i).getTime()));
      let arauco = 0;
      let ext = 0;
      for (const i of items) {
        if (i.origen === "ARAUCO") arauco += i.cantidad;
        else ext += i.cantidad;
      }
      const esp0 = items[0]?.otEspecialidad ?? null;
      const aviso0 = items[0]?.otNumeroAviso ?? "—";
      return { otId, items, maxT, arauco, ext, esp0, aviso0 };
    });
    entries.sort((a, b) => b.maxT - a.maxT);
    return entries;
  }, [materiales]);

  const pieOrigen = useMemo(
    () =>
      [
        { name: "Arauco", value: totales.porOrigen.ARAUCO, fill: "var(--chart-origen-arauco, #10b981)" },
        { name: "Externo", value: totales.porOrigen.EXTERNO, fill: "var(--chart-origen-ext, #f97316)" },
      ].filter((x) => x.value > 0),
    [totales.porOrigen],
  );

  const pieTipo = useMemo(
    () =>
      [
        { name: "Preventivo", value: totales.porTipo.preventivo, fill: "#0ea5e9" },
        { name: "Correctivo", value: totales.porTipo.correctivo, fill: "#d97706" },
      ].filter((x) => x.value > 0),
    [totales.porTipo],
  );

  function exportCsv() {
    const blob = new Blob([buildCsv(materiales)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `materiales-ot-${monthStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const periodoLabel = format(desde, "LLLL yyyy", { locale: es });

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Materiales consumidos en OTs</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Reporting de materiales cargados en órdenes de trabajo (solo lectura). Período:{" "}
            <span className="font-medium capitalize text-foreground">{periodoLabel}</span>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={authLoading || loading || Boolean(error) || materiales.length === 0}
          onClick={exportCsv}
        >
          <Download className="size-4" />
          Exportar CSV
        </Button>
      </div>

      {hitLimit ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          Se alcanzó el límite de registros en el período. Acotá el mes o contactá al administrador para
          paginación en servidor.
        </p>
      ) : null}
      {!authLoading && !user ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">
          Iniciá sesión para ver el reporting de materiales.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-600">
          {(error as { code?: string }).code === "permission-denied"
            ? "No tenés permiso para leer materiales de OT o las reglas de Firestore aún no están actualizadas. Si el problema continúa, pedí al admin que despliegue las reglas (`materiales_ot` / collection group)."
            : error.message}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total usado (período)</CardTitle>
            <CardDescription>Suma de cantidades filtradas</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{totales.total.toLocaleString("es-AR")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Provistos por Arauco</CardTitle>
            <CardDescription>Por cantidad consumida · torta vs externo</CardDescription>
          </CardHeader>
          <CardContent className="h-32 space-y-1">
            <p className="text-2xl font-semibold tabular-nums text-emerald-800 dark:text-emerald-200">
              {totales.porOrigen.ARAUCO.toLocaleString("es-AR")}
              <span className="ml-2 text-sm font-normal text-zinc-600 dark:text-zinc-400">
                ({pct(totales.porOrigen.ARAUCO, totales.total)}%)
              </span>
            </p>
            {pieOrigen.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieOrigen} dataKey="value" nameKey="name" innerRadius={18} outerRadius={32} paddingAngle={2}>
                    {pieOrigen.map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) =>
                      typeof value === "number" ? value.toLocaleString("es-AR") : String(value ?? "")
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-zinc-500">Sin datos</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Comprados externos</CardTitle>
            <CardDescription>Por cantidad consumida</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-3xl font-semibold tabular-nums text-amber-900 dark:text-amber-100">
              {totales.porOrigen.EXTERNO.toLocaleString("es-AR")}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {pct(totales.porOrigen.EXTERNO, totales.total)}% del total filtrado
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Preventivo vs correctivo</CardTitle>
            <CardDescription>
              Prev. {totales.porTipo.preventivo.toLocaleString("es-AR")} · Corr.{" "}
              {totales.porTipo.correctivo.toLocaleString("es-AR")}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-28">
            {pieTipo.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieTipo} dataKey="value" nameKey="name" innerRadius={22} outerRadius={38} paddingAngle={2}>
                    {pieTipo.map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) =>
                      typeof value === "number" ? value.toLocaleString("es-AR") : String(value ?? "")
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-zinc-500">Sin datos con tipo en OT</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div
        className={cn(
          "sticky top-0 z-20 -mx-1 rounded-lg border border-zinc-200/80 bg-background/90 px-3 py-3 shadow-sm backdrop-blur-md",
          "dark:border-zinc-800 dark:bg-zinc-950/90",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 lg:gap-3">
          <label className="flex flex-col gap-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Tipo
            <select
              className="h-9 min-w-[8.5rem] rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={tipo ?? "todos"}
              onChange={(e) => {
                setTipo(e.target.value as MaterialesOTFilters["tipo"]);
                setPage(0);
              }}
            >
              <option value="todos">Todos</option>
              <option value="preventivo">Preventivo</option>
              <option value="correctivo">Correctivo</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Especialidad
            <select
              className="h-9 min-w-[9rem] rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={esp ?? "todos"}
              onChange={(e) => {
                setEsp(e.target.value as MaterialesOTFilters["especialidad"]);
                setPage(0);
              }}
            >
              <option value="todos">Todas</option>
              <option value="A">AA</option>
              <option value="E">Eléctrico</option>
              <option value="GG">GG</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Origen
            <select
              className="h-9 min-w-[8.5rem] rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={origen ?? "todos"}
              onChange={(e) => {
                setOrigen(e.target.value as MaterialesOTFilters["origen"]);
                setPage(0);
              }}
            >
              <option value="todos">Todos</option>
              <option value="ARAUCO">Arauco</option>
              <option value="EXTERNO">Externo</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Período
            <input
              type="month"
              className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={monthStr}
              onChange={(e) => {
                setMonthStr(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label className="flex min-w-[10rem] flex-1 flex-col gap-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 sm:min-w-[12rem]">
            Centro OT
            <Input
              className="h-9 text-sm"
              placeholder={profile?.centro ? `Ej. ${profile.centro}` : "Vacío = todos"}
              value={centro}
              onChange={(e) => {
                setCentro(e.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Detalle por ítem</h2>
        {authLoading || loading ? (
          <p className="text-sm text-zinc-500">Cargando…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Cantidad</th>
                  <th className="px-3 py-2">Unidad</th>
                  <th className="px-3 py-2">Origen</th>
                  <th className="px-3 py-2">OT</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">
                      No hay materiales para los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => {
                    const fd = fechaMostrada(r);
                    return (
                      <tr key={`${r.otId}-${r.id}`} className="bg-white dark:bg-zinc-950">
                        <td className="max-w-[240px] px-3 py-2">
                          <span className="line-clamp-2">{r.descripcion}</span>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{r.cantidad}</td>
                        <td className="px-3 py-2">{r.unidad}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                              origenBadgeClass(r.origen),
                            )}
                          >
                            {r.origen === "ARAUCO" ? "Arauco" : "Externo"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/tareas/${r.otId}`}
                            className="font-mono text-brand underline-offset-2 hover:underline"
                          >
                            {r.otNumeroAviso || r.otId.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          {r.otTipo ? (
                            <Badge variant={r.otTipo === "preventivo" ? "preventivo" : "correctivo"}>
                              {r.otTipo === "preventivo" ? "Preventivo" : "Correctivo"}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                          {fd.toLocaleDateString("es-AR")}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
        {materiales.length > PAGE_SIZE ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              Página {page + 1} de {totalPages} · {materiales.length} filas
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Resumen por OT</h2>
        <div className="space-y-2">
          {gruposPorOt.length === 0 && !loading ? (
            <p className="text-sm text-zinc-500">Sin OTs con materiales en este conjunto filtrado.</p>
          ) : null}
          {gruposPorOt.map((g) => {
            const nAr = g.items.filter((i) => i.origen === "ARAUCO").length;
            const nEx = g.items.filter((i) => i.origen === "EXTERNO").length;
            return (
              <details
                key={g.otId}
                className="group rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 font-mono text-sm font-semibold">{g.aviso0}</span>
                  {g.esp0 ? (
                    <span className="rounded-md border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-700">
                      {especialidadLabel(g.esp0)}
                    </span>
                  ) : null}
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">
                    {g.items.length} ítem{g.items.length === 1 ? "" : "s"}
                  </span>
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {nAr} Arauco / {nEx} Externo
                  </span>
                </summary>
                <div className="border-t border-zinc-200 px-2 pb-3 dark:border-zinc-800">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="text-left text-[10px] font-semibold uppercase text-zinc-500">
                        <th className="px-2 py-2">Descripción</th>
                        <th className="px-2 py-2">Cant.</th>
                        <th className="px-2 py-2">Ud.</th>
                        <th className="px-2 py-2">Origen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                      {g.items.map((r) => (
                        <tr key={r.id}>
                          <td className="px-2 py-1.5">{r.descripcion}</td>
                          <td className="px-2 py-1.5 tabular-nums">{r.cantidad}</td>
                          <td className="px-2 py-1.5">{r.unidad}</td>
                          <td className="px-2 py-1.5">
                            <span className={cn("rounded-md border px-1.5 py-0.5 text-xs", origenBadgeClass(r.origen))}>
                              {r.origen === "ARAUCO" ? "Arauco" : "Externo"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-2 pt-2 text-xs">
                    <Link href={`/tareas/${g.otId}`} className="text-brand underline-offset-2 hover:underline">
                      Abrir OT en órdenes de trabajo →
                    </Link>
                  </p>
                </div>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}
