"use client";

import {
  actionGetReporteCumplimiento,
  type DisciplinaLabel,
  type ReporteCumplimientoData,
} from "@/app/actions/reporte-cumplimiento";
import {
  DetalleCalculoPanel,
  DisciplinaCard,
  DISC_LABELS,
  KpiPreventivoHero,
  PorCentroTable,
  pctBar,
  ResumenSitioTable,
  TablaEspecialidadPreventivo,
} from "@/app/(dashboard)/reportes/cumplimiento/reporte-cumplimiento-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_CENTRO, KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
import { formulaPctText, SITIOS_REPORTE } from "@/lib/reportes/cumplimiento-metrics";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { Download, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

// ─── Constantes ───────────────────────────────────────────────────────────────

const MESES = [
  { v: 1, l: "Enero" }, { v: 2, l: "Febrero" }, { v: 3, l: "Marzo" },
  { v: 4, l: "Abril" }, { v: 5, l: "Mayo" }, { v: 6, l: "Junio" },
  { v: 7, l: "Julio" }, { v: 8, l: "Agosto" }, { v: 9, l: "Septiembre" },
  { v: 10, l: "Octubre" }, { v: 11, l: "Noviembre" }, { v: 12, l: "Diciembre" },
];

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

/** Etiquetas de UI: en vista cliente se usa «especialidad» en lugar de «disciplina». */
function terminoReporte(esCliente: boolean) {
  return {
    columna: esCliente ? "Especialidad" : "Disciplina",
    porSitio: esCliente ? "por especialidad y sitio (UT)" : "por disciplina y sitio (UT)",
    porCap: esCliente ? "Cumplimiento por especialidad" : "Cumplimiento por disciplina",
    resumenPor: esCliente
      ? "Desglose por sitio (ubicación técnica)"
      : "Desglose por sitio (ubicación técnica)",
    exportNota: esCliente
      ? "KPI preventivo, especialidad y sitio"
      : "KPI preventivo, disciplina y sitio",
  };
}

function etiquetaEspecialidadCorrectivo(raw: string) {
  if (raw === "AA" || raw === "ELECTRICO" || raw === "GG") return DISC_LABELS[raw];
  return raw || "—";
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
        <CardTitle className="text-sm font-semibold">Correctivos del período</CardTitle>
        <CardDescription className="text-xs">
          Bloque aparte del KPI preventivo. Realizados = cierre (fecha_fin_ejecucion) en el mes.
          Pendientes = creadas en el mes sin ese cierre.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-bold tabular-nums">{data.total}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Realizados</p>
            <p className="text-xl font-bold tabular-nums text-green-700">{data.realizados}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pendientes</p>
            <p className="text-xl font-bold tabular-nums text-amber-700">{data.pendientes}</p>
          </div>
        </div>
        <p className="text-center font-mono text-xs text-muted-foreground">
          {data.realizados} realizados + {data.pendientes} pendientes = {data.total} en el período
        </p>
        <p className="text-xs text-muted-foreground">
          Con aviso: {data.planificados} · Sin aviso: {data.no_planificados}
        </p>
        {data.total > 0 && pieRows.length > 0 ? (
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              Realizados por especialidad (solo cerrados en el mes)
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

// ─── Excel export con colores (exceljs) ───────────────────────────────────────

async function exportarExcel(
  data: ReporteCumplimientoData,
  opciones?: { columnaEsp: string },
) {
  const columnaEsp = opciones?.columnaEsp ?? "Disciplina";
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
  const numCols = 2 + SITIOS_REPORTE.length + 4;

  ws1.mergeCells(1, 1, 1, numCols);
  const titleCell = ws1.getCell(1, 1);
  titleCell.value = `REPORTE DE CUMPLIMIENTO — ${data.periodo.label.toUpperCase()} — ${centroLabel}`;
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navyBg } };
  titleCell.font = { bold: true, color: { argb: C.navyFg }, name: "Calibri", size: 14 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws1.getRow(1).height = 30;

  ws1.mergeCells(2, 1, 2, numCols);
  const kpiCell = ws1.getCell(2, 1);
  const pctPrev = Math.round(data.totales.pct_general * 100);
  kpiCell.value = `CUMPLIMIENTO PREVENTIVO (KPI): ${pctPrev}% — ${formulaPctText(
    data.totales.preventivos_ejecutados,
    data.totales.preventivos_planificados,
  )} · Pendientes: ${data.totales.preventivos_pendientes}`;
  kpiCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: pctPrev >= 90 ? C.pctGreenBg : pctPrev >= 70 ? C.pctAmberBg : C.pctRedBg },
  };
  kpiCell.font = {
    bold: true,
    color: { argb: pctFontColor(data.totales.pct_general) },
    name: "Calibri",
    size: 12,
  };
  kpiCell.alignment = { horizontal: "center", vertical: "middle" };
  ws1.getRow(2).height = 22;

  ws1.mergeCells(3, 1, 3, numCols);
  const certCell = ws1.getCell(3, 1);
  const pctCert = Math.round(data.totales.pct_certificacion * 100);
  certCell.value = `Índice de certificación (contrato): ${pctCert}% (AA×50% + Eléctrico×40% + GG×10%)`;
  certCell.font = { italic: true, name: "Calibri", size: 10 };
  certCell.alignment = { horizontal: "center", vertical: "middle" };

  // Fila vacía
  ws1.addRow([]);

  // Headers tabla preventivos
  const headers = [
    columnaEsp,
    ...SITIOS_REPORTE,
    "Programados",
    "Ejecutados",
    "Pendientes",
    "% Cumplimiento",
  ];
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
    const sitioVals = SITIOS_REPORTE.map((s) => {
      const sp = d.por_sitio.find((x) => x.sitio === s);
      return sp && sp.planificadas > 0 ? `${sp.ejecutadas}/${sp.planificadas}` : "—";
    });
    const row = ws1.addRow([
      DISC_LABELS[disc],
      ...sitioVals,
      d.planificadas,
      d.ejecutadas,
      d.pendientes,
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
    ...SITIOS_REPORTE.map((s) => {
      const p = disciplinas.reduce((a, d) => a + (data.disciplinas[d].por_sitio.find((x) => x.sitio === s)?.planificadas ?? 0), 0);
      const e = disciplinas.reduce((a, d) => a + (data.disciplinas[d].por_sitio.find((x) => x.sitio === s)?.ejecutadas ?? 0), 0);
      return p > 0 ? `${e}/${p}` : "—";
    }),
    data.totales.preventivos_planificados,
    data.totales.preventivos_ejecutados,
    data.totales.preventivos_pendientes,
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

  ws1.addRow([`  Realizados (fecha cierre en mes)`, "", "", "", "", "", "", "", "", data.correctivos.realizados.toString()]);
  ws1.addRow([`  Pendientes (creadas en mes, sin cierre en mes)`, "", "", "", "", "", "", "", "", data.correctivos.pendientes.toString()]);
  ws1.addRow([`  Con aviso`, "", "", "", "", "", "", "", "", data.correctivos.planificados.toString()]);
  ws1.addRow([`  Sin aviso`, "", "", "", "", "", "", "", "", data.correctivos.no_planificados.toString()]);
  const corrPctRow = ws1.addRow([`  % cerrados`, "", "", "", "", "", "", "", "", `${Math.round(data.correctivos.pct_cumplimiento * 100)}%`]);
  const corrPct = corrPctRow.getCell(numCols);
  corrPct.fill = { type: "pattern", pattern: "solid", fgColor: pctFill(data.correctivos.pct_cumplimiento).fgColor };
  corrPct.font = { bold: true, color: { argb: pctFontColor(data.correctivos.pct_cumplimiento) }, name: "Calibri", size: 10 };

  // Anchos columnas
  ws1.getColumn(1).width = 30;
  for (let i = 2; i <= 1 + SITIOS_REPORTE.length; i++) ws1.getColumn(i).width = 14;
  ws1.getColumn(2 + SITIOS_REPORTE.length).width = 14;
  ws1.getColumn(3 + SITIOS_REPORTE.length).width = 14;
  ws1.getColumn(4 + SITIOS_REPORTE.length).width = 14;
  ws1.getColumn(5 + SITIOS_REPORTE.length).width = 16;

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
        `${cr.correctivos.realizados}/${cr.correctivos.total}`,
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
  const esCliente = rol === "cliente_arauco";
  const puedeElegirCentro = esSuperadmin || esCliente;
  const term = terminoReporte(esCliente);
  const centroPerfil = profile?.centro?.trim() || DEFAULT_CENTRO;
  const centroInicializado = useRef(false);

  const [mes, setMes] = useState(now.getMonth() + 1);
  const [año, setAño] = useState(now.getFullYear());
  const [centro, setCentro] = useState(centroPerfil);

  useEffect(() => {
    if (centroInicializado.current || !rol) return;
    centroInicializado.current = true;
    setCentro(esCliente ? "todas" : centroPerfil);
  }, [rol, esCliente, centroPerfil]);
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
      await exportarExcel(data, { columnaEsp: term.columna });
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
          KPI principal: preventivos programados en el mes (fecha programada) vs ejecutados (cerrados).
          Correctivos en bloque aparte. Exportable a Excel.
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
            {puedeElegirCentro ? (
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
          <div className="grid gap-4 lg:grid-cols-3">
            <KpiPreventivoHero data={data} />
            <Card className="border border-emerald-400/40 bg-emerald-50/40 dark:bg-emerald-950/20">
              <CardContent className="space-y-2 pt-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
                  Índice de certificación (contrato)
                </p>
                <p className="text-3xl font-bold text-emerald-800 dark:text-emerald-400">
                  {Math.round(data.totales.pct_certificacion * 100)}%
                </p>
                <p className="font-mono text-xs text-muted-foreground">AA×50% + Eléc×40% + GG×10%</p>
                <div className="grid grid-cols-3 gap-1 text-[0.65rem] text-muted-foreground">
                  <span>AA {Math.round(data.disciplinas.AA.pct * 100)}%</span>
                  <span>Eléc {Math.round(data.disciplinas.ELECTRICO.pct * 100)}%</span>
                  <span>GG {Math.round(data.disciplinas.GG.pct * 100)}%</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2 pt-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Correctivos (aparte)
                </p>
                <p className="font-mono text-sm font-semibold">
                  {data.correctivos.realizados} / {data.correctivos.total} realizados
                </p>
                <p className="text-xs text-muted-foreground">
                  Pendientes: {data.correctivos.pendientes} · {data.periodo.label}
                  {esTodos ? " · Todas las plantas" : ` · ${nombreCentro(data.centro)}`}
                </p>
              </CardContent>
            </Card>
          </div>

          <DetalleCalculoPanel data={data} />

          {/* Tabla comparativa por centro (modo "todas") */}
          {esTodos && data.por_centro && data.por_centro.length > 0 ? (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Comparativo por centro
              </h2>
              <PorCentroTable centros={data.por_centro} />
            </div>
          ) : null}

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Preventivos por {term.columna.toLowerCase()} {esTodos ? "(consolidado)" : ""}
            </h2>
            <TablaEspecialidadPreventivo data={data} columnaLabel={term.columna} />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {term.porCap} {esTodos ? "(consolidado)" : ""}
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {(["AA", "ELECTRICO", "GG"] as DisciplinaLabel[]).map((d) => (
                <DisciplinaCard key={d} label={d} disc={data.disciplinas[d]} />
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {term.resumenPor}
            </h2>
            <ResumenSitioTable data={data} columnaEspLabel={term.columna} />
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
            {term.exportNota}
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
