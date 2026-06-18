"use client";

import type { DisciplinaLabel, DisciplinaMetrica, ReporteCumplimientoData } from "@/lib/reportes/cumplimiento-metrics";
import { META_CERTIFICACION } from "@/lib/reportes/certificacion-objetivos";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { nombreCentro } from "@/lib/config/app-config";
import { formulaPctText, SITIOS_REPORTE } from "@/lib/reportes/cumplimiento-metrics";
import { useState } from "react";

export const DISC_LABELS: Record<DisciplinaLabel, string> = {
  AA: "Aire Acondicionado",
  ELECTRICO: "Eléctrico",
  GG: "Grupos Generadores",
};

export const DISC_COLOR: Record<DisciplinaLabel, string> = {
  AA: "text-blue-700 bg-blue-50 border-blue-200",
  ELECTRICO: "text-amber-700 bg-amber-50 border-amber-200",
  GG: "text-green-700 bg-green-50 border-green-200",
};

export function pctBadge(pct: number) {
  const p = Math.round(pct * 100);
  const cls =
    p >= 90 ? "bg-green-100 text-green-800 border-green-200" :
    p >= 70 ? "bg-amber-100 text-amber-800 border-amber-200" :
    "bg-red-100 text-red-800 border-red-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {p}%
    </span>
  );
}

export function pctBar(pct: number) {
  const p = Math.min(100, Math.round(pct * 100));
  const color = p >= 90 ? "bg-green-500" : p >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-muted">
      <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${p}%` }} />
    </div>
  );
}

export function OperativoHero({ data }: { data: ReporteCumplimientoData }) {
  const { operativo } = data;
  const disciplinas: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];

  return (
    <Card className="border-2 border-brand/40 bg-brand/5">
      <CardContent className="space-y-4 pt-5">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            Preventivos ejecutados en el período
          </p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-brand">
            {operativo.total_ejecutados}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{operativo.descripcion}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {disciplinas.map((d) => (
            <div
              key={d}
              className={`rounded-lg border px-3 py-4 text-center ${DISC_COLOR[d]}`}
            >
              <p className="text-xs font-medium opacity-80">{DISC_LABELS[d]}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {operativo.ejecutados_por_especialidad[d]}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function CertificacionPanel({ data }: { data: ReporteCumplimientoData }) {
  const { certificacion } = data;
  const disciplinas: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];

  if (!certificacion.configurada) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Certificación contractual</CardTitle>
          <CardDescription className="text-xs">
            No hay metas configuradas para {certificacion.año}. Cargá objetivos por especialidad en
            el sistema o usá el año 2026 (valores por defecto del contrato).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pesoLabel = (d: DisciplinaLabel) => `${Math.round(certificacion.pesos[d] * 100)}%`;

  return (
    <div className="space-y-4">
      <Card className="border border-emerald-400/40 bg-emerald-50/40 dark:bg-emerald-950/20">
        <CardContent className="space-y-2 pt-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
            Índice de certificación (contrato)
          </p>
          <p className="text-4xl font-bold text-emerald-800 dark:text-emerald-400">
            {Math.round(certificacion.indice * 100)}%
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            AA×{pesoLabel("AA")} + Eléc×{pesoLabel("ELECTRICO")} + GG×{pesoLabel("GG")}
          </p>
          <p className="text-xs text-muted-foreground">{META_CERTIFICACION}</p>
          {certificacion.fuente === "default" ? (
            <p className="text-[0.65rem] text-muted-foreground">
              Metas: valores por defecto (certificación Arauco {certificacion.año})
            </p>
          ) : (
            <p className="text-[0.65rem] text-muted-foreground">
              Metas cargadas en el sistema ({certificacion.año})
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {disciplinas.map((d) => {
          const c = certificacion.por_especialidad[d];
          const planes = c.planes;
          return (
            <Card key={d} className={`border ${DISC_COLOR[d]}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{DISC_LABELS[d]}</CardTitle>
                <CardDescription className="font-mono text-xs">
                  Especialidad: {Math.round(c.pct_especialidad * 100)}% (prom. 4 niveles)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span>Mensual</span>
                  <span className="font-mono tabular-nums">
                    {c.ejecutados.mes.M} / {planes.mensual} → {Math.round(c.pct_mensual * 100)}%
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Trimestral (acum.)</span>
                  <span className="font-mono tabular-nums">
                    {c.ejecutados.acumTrim} / {planes.trimAcum.toFixed(1)} →{" "}
                    {Math.round(c.pct_trimestral * 100)}%
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Semestral (acum.)</span>
                  <span className="font-mono tabular-nums">
                    {c.ejecutados.acumSem} / {planes.semAcum.toFixed(1)} →{" "}
                    {Math.round(c.pct_semestral * 100)}%
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Anual (acum.)</span>
                  <span className="font-mono tabular-nums">
                    {c.ejecutados.acumAnual} / {planes.anualAcum.toFixed(1)} →{" "}
                    {Math.round(c.pct_anual * 100)}%
                  </span>
                </div>
                <p className="border-t pt-2 text-muted-foreground">
                  Total cerrados en el mes: {c.ejecutados.totalMes}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** @deprecated Vista legacy OT programadas vs ejecutadas — oculta en UI principal */
export function KpiPreventivoHero({ data }: { data: ReporteCumplimientoData }) {
  const { totales } = data;
  return (
    <Card className="border-2 border-brand/40 bg-brand/5 sm:col-span-2">
      <CardContent className="space-y-3 pt-5">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-brand">
          Cumplimiento preventivo (KPI principal)
        </p>
        <p className="text-center font-mono text-4xl font-bold tabular-nums text-brand">
          {Math.round(totales.pct_general * 100)}%
        </p>
        <p className="text-center font-mono text-sm font-semibold tabular-nums text-foreground">
          {formulaPctText(totales.preventivos_ejecutados, totales.preventivos_planificados)}
        </p>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md border bg-surface px-2 py-2">
            <p className="text-muted-foreground">Programados</p>
            <p className="text-lg font-bold tabular-nums">{totales.preventivos_planificados}</p>
          </div>
          <div className="rounded-md border bg-surface px-2 py-2">
            <p className="text-muted-foreground">Ejecutados</p>
            <p className="text-lg font-bold tabular-nums">{totales.preventivos_ejecutados}</p>
          </div>
          <div className="rounded-md border bg-surface px-2 py-2">
            <p className="text-muted-foreground">Pendientes</p>
            <p className="text-lg font-bold tabular-nums">{totales.preventivos_pendientes}</p>
          </div>
        </div>
        {pctBar(totales.pct_general)}
      </CardContent>
    </Card>
  );
}

export function DetalleCalculoPanel({ data }: { data: ReporteCumplimientoData }) {
  const [open, setOpen] = useState(false);
  const disciplinas: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Criterios y detalle del cálculo</CardTitle>
        <CardDescription className="text-xs">{data.meta.programados}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs text-muted-foreground">
        <ul className="list-inside list-disc space-y-1">
          <li>{data.meta.ejecutados}</li>
          <li>{data.meta.pendientes}</li>
          <li>{data.meta.pct}</li>
        </ul>
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-2"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Ocultar composición por especialidad" : "Ver detalle del cálculo"}
        </button>
        {open ? (
          <div className="rounded-md border bg-muted/20 p-3 font-mono text-foreground">
            <p className="mb-2 font-sans text-xs font-semibold text-muted-foreground">
              Cumplimiento preventivo = {data.totales.preventivos_ejecutados} (suma ejecutados)
            </p>
            {disciplinas.map((d) => {
              const disc = data.disciplinas[d];
              if (disc.planificadas === 0 && disc.ejecutadas === 0) return null;
              return (
                <p key={d}>
                  · {DISC_LABELS[d]}: {disc.ejecutadas} ejecutados / {disc.planificadas} programados
                  {disc.planificadas > 0 ? ` (${Math.round(disc.pct * 100)}%)` : ""}
                </p>
              );
            })}
            <p className="mt-2 border-t pt-2 font-semibold">
              Total ejecutados = {data.totales.preventivos_ejecutados} · Programados ={" "}
              {data.totales.preventivos_planificados}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function TablaEspecialidadPreventivo({
  data,
  columnaLabel,
}: {
  data: ReporteCumplimientoData;
  columnaLabel: string;
}) {
  const disciplinas: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">{columnaLabel}</th>
            <th className="px-3 py-2.5 text-right font-medium">Programados</th>
            <th className="px-3 py-2.5 text-right font-medium">Ejecutados</th>
            <th className="px-3 py-2.5 text-right font-medium">Pendientes</th>
            <th className="px-3 py-2.5 text-right font-medium">Cumplimiento</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {disciplinas.map((disc) => {
            const d = data.disciplinas[disc];
            return (
              <tr key={disc} className="hover:bg-muted/20">
                <td className="px-4 py-2 font-medium">{DISC_LABELS[disc]}</td>
                <td className="px-3 py-2 text-right tabular-nums">{d.planificadas}</td>
                <td className="px-3 py-2 text-right tabular-nums">{d.ejecutadas}</td>
                <td className="px-3 py-2 text-right tabular-nums">{d.pendientes}</td>
                <td className="px-3 py-2 text-right">
                  <span className="block font-mono text-xs">{formulaPctText(d.ejecutadas, d.planificadas)}</span>
                  {d.planificadas > 0 ? <span className="mt-0.5 inline-block">{pctBadge(d.pct)}</span> : null}
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 bg-muted/30 font-semibold">
            <td className="px-4 py-2">Total preventivos</td>
            <td className="px-3 py-2 text-right tabular-nums">{data.totales.preventivos_planificados}</td>
            <td className="px-3 py-2 text-right tabular-nums">{data.totales.preventivos_ejecutados}</td>
            <td className="px-3 py-2 text-right tabular-nums">{data.totales.preventivos_pendientes}</td>
            <td className="px-3 py-2 text-right">
              {formulaPctText(
                data.totales.preventivos_ejecutados,
                data.totales.preventivos_planificados,
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function DisciplinaCard({ label, disc }: { label: DisciplinaLabel; disc: DisciplinaMetrica }) {
  const [expanded, setExpanded] = useState(false);
  const sitiosConDatos = disc.por_sitio.filter((s) => s.planificadas > 0 || s.ejecutadas > 0);

  return (
    <Card className={`border ${DISC_COLOR[label]}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">{DISC_LABELS[label]}</CardTitle>
          {disc.planificadas > 0 ? pctBadge(disc.pct) : null}
        </div>
        {disc.planificadas > 0 ? (
          <CardDescription className="font-mono text-xs">
            {formulaPctText(disc.ejecutadas, disc.planificadas)}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {disc.planificadas > 0 ? pctBar(disc.pct) : null}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Programados</p>
            <p className="text-xl font-bold tabular-nums">{disc.planificadas}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Ejecutados</p>
            <p className="text-xl font-bold tabular-nums">{disc.ejecutadas}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pendientes</p>
            <p className="text-xl font-bold tabular-nums">{disc.pendientes}</p>
          </div>
        </div>

        {sitiosConDatos.length > 0 ? (
          <>
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Ocultar por sitio" : "Ver por sitio (ubicación técnica)"}
            </button>
            {expanded ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1 text-left font-medium">Sitio</th>
                    <th className="py-1 text-right font-medium">Prog.</th>
                    <th className="py-1 text-right font-medium">Ejec.</th>
                    <th className="py-1 text-right font-medium">Pend.</th>
                    <th className="py-1 text-right font-medium">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sitiosConDatos.map((s) => (
                    <tr key={s.sitio}>
                      <td className="py-1">{s.sitio}</td>
                      <td className="py-1 text-right tabular-nums">{s.planificadas}</td>
                      <td className="py-1 text-right tabular-nums">{s.ejecutadas}</td>
                      <td className="py-1 text-right tabular-nums">{s.pendientes}</td>
                      <td className="py-1 text-right">{Math.round(s.pct * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ResumenSitioTable({
  data,
  columnaEspLabel,
}: {
  data: ReporteCumplimientoData;
  columnaEspLabel: string;
}) {
  const disciplinas: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">{columnaEspLabel}</th>
            {SITIOS_REPORTE.map((s) => (
              <th key={s} className="px-3 py-2.5 text-right font-medium">{s}</th>
            ))}
            <th className="px-3 py-2.5 text-right font-medium">Total</th>
            <th className="px-3 py-2.5 text-right font-medium">%</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {disciplinas.map((disc) => {
            const d = data.disciplinas[disc];
            return (
              <tr key={disc} className="hover:bg-muted/20">
                <td className="px-4 py-2 font-medium">{DISC_LABELS[disc]}</td>
                {SITIOS_REPORTE.map((s) => {
                  const sp = d.por_sitio.find((x) => x.sitio === s);
                  return (
                    <td key={s} className="px-3 py-2 text-right text-xs tabular-nums">
                      {sp && sp.planificadas > 0 ? (
                        <span>
                          <span className="font-medium text-foreground">{sp.ejecutadas}</span>
                          <span className="text-muted-foreground">/{sp.planificadas}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {d.ejecutadas}/{d.planificadas}
                </td>
                <td className="px-3 py-2 text-right">{d.planificadas > 0 ? pctBadge(d.pct) : "—"}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 bg-muted/30 font-semibold">
            <td className="px-4 py-2">TOTAL PREVENTIVOS</td>
            {SITIOS_REPORTE.map((s) => {
              const totalPlan = disciplinas.reduce((acc, d) => {
                const sp = data.disciplinas[d].por_sitio.find((x) => x.sitio === s);
                return acc + (sp?.planificadas ?? 0);
              }, 0);
              const totalEjec = disciplinas.reduce((acc, d) => {
                const sp = data.disciplinas[d].por_sitio.find((x) => x.sitio === s);
                return acc + (sp?.ejecutadas ?? 0);
              }, 0);
              return (
                <td key={s} className="px-3 py-2 text-right text-xs tabular-nums">
                  {totalPlan > 0 ? (
                    <span>
                      <span className="font-medium text-foreground">{totalEjec}</span>
                      <span className="text-muted-foreground">/{totalPlan}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              );
            })}
            <td className="px-3 py-2 text-right font-mono text-xs">
              {data.totales.preventivos_ejecutados}/{data.totales.preventivos_planificados}
            </td>
            <td className="px-3 py-2 text-right">{pctBadge(data.totales.pct_general)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function PorCentroTable({
  centros,
}: {
  centros: NonNullable<ReporteCumplimientoData["por_centro"]>;
}) {
  const disciplinas: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Centro / planta</th>
            {disciplinas.map((d) => (
              <th key={d} className="px-3 py-2.5 text-right font-medium">{DISC_LABELS[d]}</th>
            ))}
            <th className="px-3 py-2.5 text-right font-medium">Total prev.</th>
            <th className="px-3 py-2.5 text-right font-medium">Correctivos</th>
            <th className="px-3 py-2.5 text-right font-medium">Índice certif.</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {centros.map((c) => (
            <tr key={c.centro} className="hover:bg-muted/20">
              <td className="px-4 py-2 font-medium">
                <span className="text-xs">{nombreCentro(c.centro)}</span>
              </td>
              {disciplinas.map((d) => (
                <td key={d} className="px-3 py-2 text-right text-xs tabular-nums font-medium">
                  {c.operativo.ejecutados_por_especialidad[d]}
                </td>
              ))}
              <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold">
                {c.operativo.total_ejecutados}
              </td>
              <td className="px-3 py-2 text-right text-xs tabular-nums">
                {c.correctivos.realizados}/{c.correctivos.total}
              </td>
              <td className="px-3 py-2 text-right">
                {c.certificacion.configurada ? pctBadge(c.certificacion.indice) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
