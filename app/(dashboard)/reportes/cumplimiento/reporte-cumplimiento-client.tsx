"use client";

import {
  actionGetReporteCumplimiento,
  type CentroResumen,
  type DisciplinaLabel,
  type DisciplinaMetrica,
  type ReporteCumplimientoData,
  type SitioLabel,
} from "@/app/actions/reporte-cumplimiento";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_CENTRO, KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

// ─── Constantes ───────────────────────────────────────────────────────────────

const MESES = [
  { v: 1, l: "Enero" }, { v: 2, l: "Febrero" }, { v: 3, l: "Marzo" },
  { v: 4, l: "Abril" }, { v: 5, l: "Mayo" }, { v: 6, l: "Junio" },
  { v: 7, l: "Julio" }, { v: 8, l: "Agosto" }, { v: 9, l: "Septiembre" },
  { v: 10, l: "Octubre" }, { v: 11, l: "Noviembre" }, { v: 12, l: "Diciembre" },
];

const DISC_LABELS: Record<DisciplinaLabel, string> = {
  AA: "Aire Acondicionado",
  ELECTRICO: "Eléctrico",
  GG: "Grupos Generadores",
};

const DISC_COLOR: Record<DisciplinaLabel, string> = {
  AA: "text-blue-700 bg-blue-50 border-blue-200",
  ELECTRICO: "text-amber-700 bg-amber-50 border-amber-200",
  GG: "text-green-700 bg-green-50 border-green-200",
};

/** Colores hex para gráficos (recharts), alineados con las tarjetas por disciplina */
const CORR_ESP_PIE_COLORS: Record<DisciplinaLabel | "otro", string> = {
  AA: "#2563eb",
  ELECTRICO: "#d97706",
  GG: "#16a34a",
  otro: "#71717a",
};

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

const SITIOS: SitioLabel[] = ["Esperanza", "Bossetti", "Yporá", "Piray", "Garita", "Otro"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pctBadge(pct: number) {
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

function pctBar(pct: number) {
  const p = Math.min(100, Math.round(pct * 100));
  const color = p >= 90 ? "bg-green-500" : p >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-muted">
      <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${p}%` }} />
    </div>
  );
}

function etiquetaEspecialidadCorrectivo(raw: string) {
  if (raw === "AA" || raw === "ELECTRICO" || raw === "GG") return DISC_LABELS[raw];
  return raw || "—";
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function DisciplinaCard({ label, disc }: { label: DisciplinaLabel; disc: DisciplinaMetrica }) {
  const [expanded, setExpanded] = useState(false);
  const pct = Math.round(disc.pct * 100);
  const sitiosConDatos = disc.por_sitio.filter((s) => s.planificadas > 0 || s.ejecutadas > 0);

  return (
    <Card className={`border ${DISC_COLOR[label]}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{DISC_LABELS[label]}</CardTitle>
          {pctBadge(disc.pct)}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {pctBar(disc.pct)}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Planificadas</p>
            <p className="text-xl font-bold">{disc.planificadas}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Ejecutadas</p>
            <p className="text-xl font-bold">{disc.ejecutadas}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cumplimiento</p>
            <p className="text-xl font-bold">{pct}%</p>
          </div>
        </div>

        {sitiosConDatos.length > 0 ? (
          <>
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Ocultar por sitio" : "Ver por sitio"}
            </button>
            {expanded ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1 text-left font-medium">Sitio</th>
                    <th className="py-1 text-right font-medium">Plan.</th>
                    <th className="py-1 text-right font-medium">Ejec.</th>
                    <th className="py-1 text-right font-medium">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sitiosConDatos.map((s) => (
                    <tr key={s.sitio}>
                      <td className="py-1">{s.sitio}</td>
                      <td className="py-1 text-right">{s.planificadas}</td>
                      <td className="py-1 text-right">{s.ejecutadas}</td>
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

function CorrectivoCard({ data }: { data: ReporteCumplimientoData["correctivos"] }) {
  const [expanded, setExpanded] = useState(false);

  const pieRows = useMemo(() => {
    const por = data.por_especialidad;
    const order: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];
    const rows: { name: string; shortLabel: string; value: number; fill: string }[] = [];
    for (const k of order) {
      const v = por[k];
      if (v > 0) {
        rows.push({
          name: DISC_LABELS[k],
          shortLabel: k === "ELECTRICO" ? "Eléc." : k,
          value: v,
          fill: CORR_ESP_PIE_COLORS[k],
        });
      }
    }
    if (por.otro > 0) {
      rows.push({
        name: "Otras / sin clasificar",
        shortLabel: "Otras",
        value: por.otro,
        fill: CORR_ESP_PIE_COLORS.otro,
      });
    }
    return rows;
  }, [data.por_especialidad]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Correctivos</CardTitle>
          {pctBadge(data.pct_cumplimiento)}
        </div>
        <CardDescription className="text-xs">
          Total: {data.total} · Planificados: {data.planificados} · No planificados: {data.no_planificados}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {pctBar(data.pct_cumplimiento)}
        {data.total > 0 && pieRows.length > 0 ? (
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              Distribución por especialidad (AA · Eléctrico · GG)
            </p>
            <div className="h-[240px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Pie
                    data={pieRows}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={82}
                    paddingAngle={2}
                    label={(props) => {
                      const i = props.index ?? 0;
                      const row = pieRows[i];
                      if (!row) return "";
                      const pct = (props.percent ?? 0) * 100;
                      return `${row.shortLabel} ${pct.toFixed(0)}% (${row.value})`;
                    }}
                    labelLine={{ stroke: "var(--border)", strokeWidth: 1 }}
                  >
                    {pieRows.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} stroke="var(--surface)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    {...chartTooltip}
                    formatter={(value, name) => [`${value as number} correctivo(s)`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : null}
        {data.detalle.length > 0 ? (
          <>
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Ocultar detalle" : `Ver ${data.detalle.length} correctivo(s)`}
            </button>
            {expanded ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[540px] text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 text-left font-medium">OT</th>
                      <th className="py-1 text-left font-medium">Descripción</th>
                      <th className="py-1 text-left font-medium">Sitio</th>
                      <th className="py-1 text-left font-medium">Especialidad</th>
                      <th className="py-1 text-left font-medium">Tipo</th>
                      <th className="py-1 text-left font-medium">Estado</th>
                      <th className="py-1 text-left font-medium">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.detalle.map((c, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="py-1 font-mono">{c.n_ot || "—"}</td>
                        <td className="max-w-[180px] truncate py-1">{c.descripcion || "—"}</td>
                        <td className="py-1">{c.sitio}</td>
                        <td className="py-1">{etiquetaEspecialidadCorrectivo(c.especialidad)}</td>
                        <td className="py-1">
                          <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-medium ${
                            c.planificado ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                          }`}>
                            {c.planificado ? "Con aviso" : "Sin aviso"}
                          </span>
                        </td>
                        <td className="py-1">
                          <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-medium ${
                            c.ejecutado ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                          }`}>
                            {c.ejecutado ? "Cerrado" : "Pendiente"}
                          </span>
                        </td>
                        <td className="py-1 text-muted-foreground">{c.fecha ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Sin correctivos en el período.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ResumenTable({ data }: { data: ReporteCumplimientoData }) {
  const disciplinas: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Disciplina</th>
            {SITIOS.map((s) => (
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
                {SITIOS.map((s) => {
                  const sp = d.por_sitio.find((x) => x.sitio === s);
                  return (
                    <td key={s} className="px-3 py-2 text-right text-xs">
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
                <td className="px-3 py-2 text-right font-medium">
                  {d.ejecutadas}/{d.planificadas}
                </td>
                <td className="px-3 py-2 text-right">{pctBadge(d.pct)}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 bg-muted/30 font-semibold">
            <td className="px-4 py-2">TOTAL PREVENTIVOS</td>
            {SITIOS.map((s) => {
              const totalPlan = disciplinas.reduce((acc, d) => {
                const sp = data.disciplinas[d].por_sitio.find((x) => x.sitio === s);
                return acc + (sp?.planificadas ?? 0);
              }, 0);
              const totalEjec = disciplinas.reduce((acc, d) => {
                const sp = data.disciplinas[d].por_sitio.find((x) => x.sitio === s);
                return acc + (sp?.ejecutadas ?? 0);
              }, 0);
              return (
                <td key={s} className="px-3 py-2 text-right text-xs">
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
            <td className="px-3 py-2 text-right">
              {data.totales.preventivos_ejecutados}/{data.totales.preventivos_planificados}
            </td>
            <td className="px-3 py-2 text-right">{pctBadge(data.totales.pct_general)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Tabla comparativa de todos los centros */
function PorCentroTable({ centros }: { centros: CentroResumen[] }) {
  const disciplinas: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Centro</th>
            {disciplinas.map((d) => (
              <th key={d} className="px-3 py-2.5 text-right font-medium">{DISC_LABELS[d]}</th>
            ))}
            <th className="px-3 py-2.5 text-right font-medium">Preventivos</th>
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
                <td key={d} className="px-3 py-2 text-right text-xs">
                  {c.disciplinas[d].planificadas > 0 ? (
                    <span className="space-x-1">
                      <span className="font-medium">{c.disciplinas[d].ejecutadas}</span>
                      <span className="text-muted-foreground">/{c.disciplinas[d].planificadas}</span>
                      <span>{pctBadge(c.disciplinas[d].pct)}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              ))}
              <td className="px-3 py-2 text-right text-xs">
                {c.totales.preventivos_ejecutados}/{c.totales.preventivos_planificados}{" "}
                {pctBadge(c.totales.pct_general)}
              </td>
              <td className="px-3 py-2 text-right text-xs">{c.correctivos.total}</td>
              <td className="px-3 py-2 text-right">{pctBadge(c.totales.pct_certificacion)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Excel export con colores (exceljs) ───────────────────────────────────────

async function exportarExcel(data: ReporteCumplimientoData) {
  // Dynamic import to keep bundle lean
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SEAM CMMS";

  const centroLabel = data.centro === "todas" ? "TODOS LOS CENTROS" : nombreCentro(data.centro);

  // ── Colores ──────────────────────────────────────────────────────────────
  const C = {
    navyFg:   "FFFFFFFF",
    navyBg:   "FF1F3864",
    blueBg:   "FFDEEAF1",
    blueFg:   "FF1F3864",
    amberBg:  "FFFFF2CC",
    amberFg:  "FF7F6000",
    greenBg:  "FFE2EFDA",
    greenFg:  "FF375623",
    grayBg:   "FFD9D9D9",
    grayFg:   "FF000000",
    headerBg: "FF2F5496",
    pctGreenBg: "FFC6EFCE", pctGreenFg: "FF375623",
    pctAmberBg: "FFFFEB9C", pctAmberFg: "FF9C6500",
    pctRedBg:   "FFFFC7CE", pctRedFg:   "FF9C0006",
    white:    "FFFFFFFF",
    border:   "FFB8B8B8",
  };

  function pctFill(pct: number): { fgColor: { argb: string }; bgColor: { argb: string } } {
    if (pct >= 0.9) return { fgColor: { argb: C.pctGreenBg }, bgColor: { argb: C.pctGreenBg } };
    if (pct >= 0.7) return { fgColor: { argb: C.pctAmberBg }, bgColor: { argb: C.pctAmberBg } };
    return { fgColor: { argb: C.pctRedBg }, bgColor: { argb: C.pctRedBg } };
  }

  function pctFontColor(pct: number): string {
    if (pct >= 0.9) return C.pctGreenFg;
    if (pct >= 0.7) return C.pctAmberFg;
    return C.pctRedFg;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ERow = any;

  function applyHeaderStyle(
    row: ERow,
    bgArgb: string,
    fgArgb: string = C.navyFg,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.eachCell((cell: any) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
      cell.font = { bold: true, color: { argb: fgArgb }, name: "Calibri", size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: C.border } },
        left: { style: "thin", color: { argb: C.border } },
        bottom: { style: "thin", color: { argb: C.border } },
        right: { style: "thin", color: { argb: C.border } },
      };
    });
  }

  function applyRowStyle(row: ERow, bgArgb: string, fgArgb: string = C.grayFg) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.eachCell((cell: any) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
      cell.font = { color: { argb: fgArgb }, name: "Calibri", size: 10 };
      cell.border = {
        top: { style: "thin", color: { argb: C.border } },
        left: { style: "thin", color: { argb: C.border } },
        bottom: { style: "thin", color: { argb: C.border } },
        right: { style: "thin", color: { argb: C.border } },
      };
    });
  }

  const disciplinas: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];

  // ── Hoja 1: Resumen ───────────────────────────────────────────────────────
  const ws1 = wb.addWorksheet("Resumen");
  const numCols = 2 + SITIOS.length + 3; // disciplina + sitios + total plan + total ejec + %

  // Título
  ws1.mergeCells(1, 1, 1, numCols);
  const titleCell = ws1.getCell(1, 1);
  titleCell.value = `REPORTE DE CUMPLIMIENTO — ${data.periodo.label.toUpperCase()} — ${centroLabel}`;
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navyBg } };
  titleCell.font = { bold: true, color: { argb: C.navyFg }, name: "Calibri", size: 14 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws1.getRow(1).height = 30;

  // Subtítulo: Índice de certificación
  ws1.mergeCells(2, 1, 2, numCols);
  const certCell = ws1.getCell(2, 1);
  const pctCert = Math.round(data.totales.pct_certificacion * 100);
  certCell.value = `ÍNDICE DE CERTIFICACIÓN: ${pctCert}%   (AA×50% + Eléctrico×40% + GG×10%)`;
  certCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: pctCert >= 90 ? C.pctGreenBg : pctCert >= 70 ? C.pctAmberBg : C.pctRedBg } };
  certCell.font = { bold: true, color: { argb: pctFontColor(data.totales.pct_certificacion) }, name: "Calibri", size: 12 };
  certCell.alignment = { horizontal: "center", vertical: "middle" };
  ws1.getRow(2).height = 22;

  // Fila vacía
  ws1.addRow([]);

  // Headers tabla preventivos
  const headers = ["Disciplina", ...SITIOS, "Total Plan.", "Total Ejec.", "% Cumplimiento"];
  const hRow = ws1.addRow(headers);
  applyHeaderStyle(hRow, C.headerBg);
  ws1.getRow(hRow.number).height = 18;

  // Filas por disciplina
  const discColors: Record<DisciplinaLabel, { bg: string; fg: string }> = {
    AA:       { bg: C.blueBg,  fg: C.blueFg  },
    ELECTRICO:{ bg: C.amberBg, fg: C.amberFg },
    GG:       { bg: C.greenBg, fg: C.greenFg },
  };

  for (const disc of disciplinas) {
    const d = data.disciplinas[disc];
    const sitioVals = SITIOS.map((s) => {
      const sp = d.por_sitio.find((x) => x.sitio === s);
      return sp && sp.planificadas > 0 ? `${sp.ejecutadas}/${sp.planificadas}` : "—";
    });
    const row = ws1.addRow([
      DISC_LABELS[disc],
      ...sitioVals,
      d.planificadas,
      d.ejecutadas,
      `${Math.round(d.pct * 100)}%`,
    ]);
    applyRowStyle(row, discColors[disc].bg, discColors[disc].fg);
    row.getCell(1).font = { bold: true, color: { argb: discColors[disc].fg }, name: "Calibri", size: 10 };
    // Color en columna %
    const pctCell2 = row.getCell(numCols);
    pctCell2.fill = { type: "pattern", pattern: "solid", fgColor: pctFill(d.pct).fgColor };
    pctCell2.font = { bold: true, color: { argb: pctFontColor(d.pct) }, name: "Calibri", size: 10 };
  }

  // Fila totales preventivos
  const totRow = ws1.addRow([
    "TOTAL PREVENTIVOS",
    ...SITIOS.map((s) => {
      const p = disciplinas.reduce((a, d) => a + (data.disciplinas[d].por_sitio.find((x) => x.sitio === s)?.planificadas ?? 0), 0);
      const e = disciplinas.reduce((a, d) => a + (data.disciplinas[d].por_sitio.find((x) => x.sitio === s)?.ejecutadas ?? 0), 0);
      return p > 0 ? `${e}/${p}` : "—";
    }),
    data.totales.preventivos_planificados,
    data.totales.preventivos_ejecutados,
    `${Math.round(data.totales.pct_general * 100)}%`,
  ]);
  applyRowStyle(totRow, C.grayBg);
  totRow.eachCell((cell) => { cell.font = { bold: true, name: "Calibri", size: 10 }; });
  const totPctCell = totRow.getCell(numCols);
  totPctCell.fill = { type: "pattern", pattern: "solid", fgColor: pctFill(data.totales.pct_general).fgColor };
  totPctCell.font = { bold: true, color: { argb: pctFontColor(data.totales.pct_general) }, name: "Calibri", size: 10 };

  // Espacio
  ws1.addRow([]);

  // Sección certificación detallada
  const certHRow = ws1.addRow(["ÍNDICE DE CERTIFICACIÓN (SEAM)", "", "", "", "", "", "", "", "", `${pctCert}%`]);
  applyHeaderStyle(certHRow, C.navyBg);

  for (const [disc, peso] of [["AA", "50%"], ["ELECTRICO", "40%"], ["GG", "10%"]] as const) {
    const p = Math.round(data.disciplinas[disc].pct * 100);
    const row = ws1.addRow([`  ${DISC_LABELS[disc]}`, `Peso: ${peso}`, "", "", "", "", "", "", "", `${p}%`]);
    const bg = discColors[disc].bg;
    const fg = discColors[disc].fg;
    applyRowStyle(row, bg, fg);
    const pc = row.getCell(numCols);
    pc.fill = { type: "pattern", pattern: "solid", fgColor: pctFill(data.disciplinas[disc].pct).fgColor };
    pc.font = { bold: true, color: { argb: pctFontColor(data.disciplinas[disc].pct) }, name: "Calibri", size: 10 };
  }

  // Espacio
  ws1.addRow([]);

  // Sección correctivos
  const corrHRow = ws1.addRow(["CORRECTIVOS DEL PERÍODO", "", "", "", "", "", "", "", "", data.correctivos.total.toString()]);
  applyHeaderStyle(corrHRow, C.headerBg);

  ws1.addRow([`  Con aviso (planificados)`, "", "", "", "", "", "", "", "", data.correctivos.planificados.toString()]);
  ws1.addRow([`  Sin aviso (no planificados)`, "", "", "", "", "", "", "", "", data.correctivos.no_planificados.toString()]);
  const corrPctRow = ws1.addRow([`  % Cumplimiento`, "", "", "", "", "", "", "", "", `${Math.round(data.correctivos.pct_cumplimiento * 100)}%`]);
  const corrPct = corrPctRow.getCell(numCols);
  corrPct.fill = { type: "pattern", pattern: "solid", fgColor: pctFill(data.correctivos.pct_cumplimiento).fgColor };
  corrPct.font = { bold: true, color: { argb: pctFontColor(data.correctivos.pct_cumplimiento) }, name: "Calibri", size: 10 };

  // Anchos columnas
  ws1.getColumn(1).width = 30;
  for (let i = 2; i <= 1 + SITIOS.length; i++) ws1.getColumn(i).width = 14;
  ws1.getColumn(2 + SITIOS.length).width = 14;
  ws1.getColumn(3 + SITIOS.length).width = 14;
  ws1.getColumn(4 + SITIOS.length).width = 16;

  // ── Hoja 2: Por centro (solo modo "todas") ────────────────────────────────
  if (data.por_centro && data.por_centro.length > 0) {
    const ws2 = wb.addWorksheet("Por Centro");

    ws2.mergeCells(1, 1, 1, 8);
    const t2 = ws2.getCell(1, 1);
    t2.value = `COMPARATIVO POR CENTRO — ${data.periodo.label.toUpperCase()}`;
    t2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navyBg } };
    t2.font = { bold: true, color: { argb: C.navyFg }, name: "Calibri", size: 13 };
    t2.alignment = { horizontal: "center", vertical: "middle" };
    ws2.getRow(1).height = 28;

    ws2.addRow([]);

    const h2 = ws2.addRow([
      "Centro", "Nombre",
      "AA ejec/plan", "AA %",
      "Eléctrico ejec/plan", "Eléctrico %",
      "GG ejec/plan", "GG %",
      "Prev. total", "Prev. %",
      "Correctivos", "Índice Certif.",
    ]);
    applyHeaderStyle(h2, C.headerBg);
    ws2.getRow(h2.number).height = 18;

    for (const cr of data.por_centro) {
      const row = ws2.addRow([
        cr.centro,
        nombreCentro(cr.centro),
        `${cr.disciplinas.AA.ejecutadas}/${cr.disciplinas.AA.planificadas}`,
        `${Math.round(cr.disciplinas.AA.pct * 100)}%`,
        `${cr.disciplinas.ELECTRICO.ejecutadas}/${cr.disciplinas.ELECTRICO.planificadas}`,
        `${Math.round(cr.disciplinas.ELECTRICO.pct * 100)}%`,
        `${cr.disciplinas.GG.ejecutadas}/${cr.disciplinas.GG.planificadas}`,
        `${Math.round(cr.disciplinas.GG.pct * 100)}%`,
        `${cr.totales.preventivos_ejecutados}/${cr.totales.preventivos_planificados}`,
        `${Math.round(cr.totales.pct_general * 100)}%`,
        cr.correctivos.total,
        `${Math.round(cr.totales.pct_certificacion * 100)}%`,
      ]);
      applyRowStyle(row, C.white);

      // Colorear columnas de %
      for (const [colOffset, pctVal] of [
        [4, cr.disciplinas.AA.pct],
        [6, cr.disciplinas.ELECTRICO.pct],
        [8, cr.disciplinas.GG.pct],
        [10, cr.totales.pct_general],
        [12, cr.totales.pct_certificacion],
      ] as [number, number][]) {
        const c = row.getCell(colOffset);
        c.fill = { type: "pattern", pattern: "solid", fgColor: pctFill(pctVal).fgColor };
        c.font = { bold: true, color: { argb: pctFontColor(pctVal) }, name: "Calibri", size: 10 };
      }
    }

    ws2.getColumn(1).width = 10;
    ws2.getColumn(2).width = 24;
    for (let i = 3; i <= 12; i++) ws2.getColumn(i).width = 18;
  }

  // ── Hoja Preventivos ─────────────────────────────────────────────────────
  const wsPrev = wb.addWorksheet("Preventivos");
  const prevHeaders = [
    "N° OT", "N° Aviso", "Descripción", "Especialidad", "Frecuencia",
    "Sitio", "Ubicación técnica", "Estado", "Planificada", "Ejecutada",
    "Fecha ejecución", "Fecha creación",
  ];
  const pH = wsPrev.addRow(prevHeaders);
  applyHeaderStyle(pH, C.headerBg);

  for (const o of data.ots_detalle.filter((x) => x.tipo === "preventivo")) {
    const row = wsPrev.addRow([
      o.n_ot, o.aviso_numero, o.descripcion, o.especialidad, o.frecuencia,
      o.sitio, o.ubicacion, o.estado,
      o.planificada ? "Sí" : "No",
      o.ejecutada ? "Sí" : "No",
      o.fecha_ejecucion ?? "—",
      o.fecha_creacion,
    ]);
    const bg = o.ejecutada ? "FFE2EFDA" : "FFFFC7CE";
    row.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    row.getCell(10).font = { color: { argb: o.ejecutada ? C.pctGreenFg : C.pctRedFg }, name: "Calibri", size: 9 };
    row.eachCell((cell) => {
      if (!cell.fill || (cell.fill as { fgColor?: { argb?: string } })?.fgColor?.argb === undefined) {
        cell.font = { name: "Calibri", size: 9 };
      }
      cell.border = {
        top: { style: "hair", color: { argb: C.border } },
        left: { style: "hair", color: { argb: C.border } },
        bottom: { style: "hair", color: { argb: C.border } },
        right: { style: "hair", color: { argb: C.border } },
      };
    });
  }

  [8, 12, 40, 14, 12, 14, 36, 16, 10, 10, 14, 14].forEach((w, i) => {
    wsPrev.getColumn(i + 1).width = w;
  });

  // ── Hoja Correctivos ─────────────────────────────────────────────────────
  const wsCorr = wb.addWorksheet("Correctivos");
  const corrHeaders = [
    "N° OT", "N° Aviso", "Descripción", "Especialidad",
    "Sitio", "Ubicación técnica", "Planificado", "Ejecutado", "Fecha",
  ];
  const cH = wsCorr.addRow(corrHeaders);
  applyHeaderStyle(cH, C.headerBg);

  for (const c of data.correctivos.detalle) {
    const row = wsCorr.addRow([
      c.n_ot, c.aviso_numero, c.descripcion, c.especialidad,
      c.sitio, c.ubicacion,
      c.planificado ? "Sí" : "No",
      c.ejecutado ? "Sí" : "No",
      c.fecha ?? "—",
    ]);
    row.getCell(8).fill = {
      type: "pattern", pattern: "solid",
      fgColor: { argb: c.ejecutado ? "FFE2EFDA" : "FFFFC7CE" },
    };
    row.getCell(8).font = {
      color: { argb: c.ejecutado ? C.pctGreenFg : C.pctRedFg }, name: "Calibri", size: 9,
    };
    row.eachCell((cell) => {
      cell.font = cell.font ?? { name: "Calibri", size: 9 };
      cell.border = {
        top: { style: "hair", color: { argb: C.border } },
        left: { style: "hair", color: { argb: C.border } },
        bottom: { style: "hair", color: { argb: C.border } },
        right: { style: "hair", color: { argb: C.border } },
      };
    });
  }

  [8, 12, 40, 14, 14, 36, 12, 12, 14].forEach((w, i) => {
    wsCorr.getColumn(i + 1).width = w;
  });

  // ── Descargar ─────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeLabel = data.periodo.label.replace(" ", "_");
  const safeCentro = data.centro === "todas" ? "TODOS" : data.centro;
  a.download = `Cumplimiento_${safeCentro}_${safeLabel}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ReporteCumplimientoClient() {
  const now = new Date();
  const { user } = useAuthUser();
  const { profile } = useUserProfile(user?.uid);
  const { puede, rol } = usePermisos();

  const esSuperadmin = rol === "superadmin";
  const centroPerfil = profile?.centro?.trim() || DEFAULT_CENTRO;

  const [mes, setMes] = useState(now.getMonth() + 1);
  const [año, setAño] = useState(now.getFullYear());
  const [centro, setCentro] = useState(centroPerfil);
  const [data, setData] = useState<ReporteCumplimientoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  if (!puede("reportes:ver_cumplimiento")) {
    return (
      <Card className="mx-auto max-w-sm">
        <CardHeader>
          <CardTitle>Sin acceso</CardTitle>
          <CardDescription>
            Este reporte está reservado para supervisión o administración. Si necesitás los números, pedí acceso a tu responsable.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  async function generarReporte() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const tok = await getClientIdToken();
      if (!tok) throw new Error("Sin sesión");
      const centros_lista = centro === "todas" ? [...KNOWN_CENTROS] : undefined;
      const res = await actionGetReporteCumplimiento(tok, { centro, mes, año, centros_lista });
      if (!res.ok) throw new Error(res.error.message);
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar el reporte");
    } finally {
      setLoading(false);
    }
  }

  async function handleExportar() {
    if (!data) return;
    setExportando(true);
    try {
      await exportarExcel(data);
    } finally {
      setExportando(false);
    }
  }

  const esTodos = data?.centro === "todas";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Reportes</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Reporte de cumplimiento</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          OTs preventivas planificadas vs ejecutadas por disciplina y sitio. Correctivos del período.
          Exportable a Excel para la certificación mensual.
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Período y centro</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Mes
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={mes}
                onChange={(e) => setMes(Number(e.target.value))}
                disabled={loading}
              >
                {MESES.map((m) => (
                  <option key={m.v} value={m.v}>{m.l}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Año
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={año}
                onChange={(e) => setAño(Number(e.target.value))}
                disabled={loading}
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
            {esSuperadmin ? (
              <label className="flex flex-col gap-1 text-sm font-medium">
                Centro
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={centro}
                  onChange={(e) => setCentro(e.target.value)}
                  disabled={loading}
                >
                  <option value="todas">Todas las plantas</option>
                  {KNOWN_CENTROS.map((c) => (
                    <option key={c} value={c}>
                      {nombreCentro(c)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="self-end text-sm text-muted-foreground">
                Centro: <span className="font-medium">{nombreCentro(centro)}</span>
              </p>
            )}
            <Button
              type="button"
              onClick={() => void generarReporte()}
              disabled={loading}
              className="self-end"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Generar reporte
            </Button>
            {data ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleExportar()}
                disabled={exportando}
                className="self-end gap-2"
              >
                {exportando
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Download className="h-4 w-4" />}
                Exportar Excel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      ) : null}

      {data ? (
        <div className="space-y-6">
          {/* KPI global */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-2 border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-950/20 sm:col-span-2 lg:col-span-1">
              <CardContent className="pt-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  Índice de certificación
                </p>
                <p className="mt-1 text-4xl font-bold text-emerald-700 dark:text-emerald-400">
                  {Math.round(data.totales.pct_certificacion * 100)}%
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  AA×50% + Eléc×40% + GG×10%
                </p>
                <div className="mt-2 grid grid-cols-3 gap-1 text-[0.65rem] text-muted-foreground">
                  <span>AA {Math.round(data.disciplinas.AA.pct * 100)}%</span>
                  <span>Eléc {Math.round(data.disciplinas.ELECTRICO.pct * 100)}%</span>
                  <span>GG {Math.round(data.disciplinas.GG.pct * 100)}%</span>
                </div>
              </CardContent>
            </Card>
            <Card className="border-2 border-brand/30 bg-brand/5">
              <CardContent className="pt-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Cumplimiento general
                </p>
                <p className="mt-1 text-4xl font-bold text-brand">
                  {Math.round(data.totales.pct_general * 100)}%
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.totales.preventivos_ejecutados} de {data.totales.preventivos_planificados} preventivos
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Correctivos del período
                </p>
                <p className="mt-1 text-4xl font-bold">{data.correctivos.total}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.correctivos.planificados} con aviso · {data.correctivos.no_planificados} sin aviso
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Período
                </p>
                <p className="mt-1 text-2xl font-bold">{data.periodo.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {esTodos ? (
                    "Todas las plantas"
                  ) : (
                    <span>
                      Centro: <span className="font-medium">{nombreCentro(data.centro)}</span>
                    </span>
                  )}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Tabla comparativa por centro (modo "todas") */}
          {esTodos && data.por_centro && data.por_centro.length > 0 ? (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Comparativo por centro
              </h2>
              <PorCentroTable centros={data.por_centro} />
            </div>
          ) : null}

          {/* Cards por disciplina */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Cumplimiento por disciplina {esTodos ? "(consolidado)" : ""}
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {(["AA", "ELECTRICO", "GG"] as DisciplinaLabel[]).map((d) => (
                <DisciplinaCard key={d} label={d} disc={data.disciplinas[d]} />
              ))}
            </div>
          </div>

          {/* Tabla resumen disciplina × sitio */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Resumen ejecutadas / planificadas por disciplina y sitio
            </h2>
            <ResumenTable data={data} />
          </div>

          {/* Correctivos */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Trabajos correctivos
            </h2>
            <CorrectivoCard data={data.correctivos} />
          </div>

          <p className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <strong>Exportar Excel</strong> genera un archivo con{esTodos ? " cuatro" : " tres"} hojas:
            Resumen con colores por disciplina y semáforo de cumplimiento
            {esTodos ? ", Comparativo por centro" : ""},
            Preventivos (detalle con estado coloreado) y Correctivos.
          </p>
        </div>
      ) : !loading ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Seleccioná el período y pulsá <strong>Generar reporte</strong>.
          </p>
        </div>
      ) : null}
    </div>
  );
}
