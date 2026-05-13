import * as XLSX from "xlsx";
import type { WorkBook, WorkSheet } from "xlsx";
import { getIsoWeekId } from "@/modules/scheduling/iso-week";
import type { WeeklyPlanRow } from "@/modules/scheduling/types";

export type ParsedWeekPlan = {
  weekId: string;
  sheetName: string;
  rows: Array<Pick<WeeklyPlanRow, "dia_semana" | "localidad" | "especialidad" | "texto" | "orden">>;
};

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

function normCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v > 20000 && v < 60000) {
      const d = excelSerialToDate(v);
      return d ? d.toISOString().slice(0, 10) : String(v);
    }
    return String(v);
  }
  return String(v).replace(/\r\n/g, "\n").trim();
}

/** Serial Excel → Date UTC (compatible con hojas exportadas). */
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const utc = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isNoiseText(t: string): boolean {
  const x = t.trim();
  if (!x) return true;
  if (/^[\s;.,:-]+$/.test(x)) return true;
  return false;
}

/**
 * Interpreta libros con el mismo patrón que "Programas semanales": fila con
 * "Localidad" / "Especialidad", columnas Lunes→Sábado y fechas en esa fila.
 * Ignora la hoja "PENDIENTES" y similares.
 */
export function parseProgramaSemanalWorkbook(wb: WorkBook): ParsedWeekPlan[] {
  const out: ParsedWeekPlan[] = [];

  for (const sheetName of wb.SheetNames) {
    const low = sheetName.trim().toLowerCase();
    if (low.includes("pendiente")) continue;

    const sh = wb.Sheets[sheetName];
    if (!sh) continue;

    const aoa: unknown[][] = sheetToMatrix(sh);
    const hdr = findLocalidadEspecialidadRow(aoa);
    if (!hdr) continue;

    const { rowIdx, dayStartCol } = hdr;
    const headerRow = aoa[rowIdx - 1];
    if (!headerRow || rowIdx < 1) continue;

    const mondayCol = findMondayColumn(headerRow, Math.max(0, dayStartCol));
    if (mondayCol < 0) continue;

    const dateCell = aoa[rowIdx]?.[mondayCol];
    const weekId = weekIdFromFirstDayCell(dateCell);
    if (!weekId) continue;

    const rows: ParsedWeekPlan["rows"] = [];
    const ordenPorDia = new Map<number, number>();
    let currentLocal = normCell(aoa[rowIdx + 1]?.[0]);

    for (let r = rowIdx + 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row) break;

      const col0 = normCell(row[0]);
      if (col0) currentLocal = col0;

      const esp = normCell(row[1]);
      if (!esp) continue;

      let anyDay = false;
      for (let d = 0; d < 6; d++) {
        const texto = normCell(row[mondayCol + d]);
        if (isNoiseText(texto)) continue;
        anyDay = true;
        const dia_semana = (d + 1) as WeeklyPlanRow["dia_semana"];
        const orden = ordenPorDia.get(dia_semana) ?? 0;
        ordenPorDia.set(dia_semana, orden + 1);
        rows.push({
          dia_semana,
          localidad: currentLocal || "—",
          especialidad: esp,
          texto,
          orden,
        });
      }

      if (!anyDay && !col0 && !normCell(row[mondayCol])) {
        const rest = row.slice(mondayCol).every((cell) => !normCell(cell));
        if (rest && r > rowIdx + 15) break;
      }
    }

    if (rows.length) {
      out.push({ weekId, sheetName, rows });
    }
  }

  return out;
}

function sheetToMatrix(sh: WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sh, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
}

function findLocalidadEspecialidadRow(aoa: unknown[][]): { rowIdx: number; dayStartCol: number } | null {
  for (let r = 0; r < Math.min(aoa.length, 40); r++) {
    const row = aoa[r];
    if (!row || row.length < 4) continue;
    for (let c = 0; c < row.length - 2; c++) {
      const a = stripDiacritics(normCell(row[c])).toLowerCase();
      const b = stripDiacritics(normCell(row[c + 1])).toLowerCase();
      if (a === "localidad" && b === "especialidad") {
        return { rowIdx: r, dayStartCol: c };
      }
    }
  }
  return null;
}

function findMondayColumn(headerRow: unknown[], approxStart: number): number {
  for (let c = Math.max(0, approxStart); c < headerRow.length; c++) {
    const h = stripDiacritics(normCell(headerRow[c])).toLowerCase();
    if (h.startsWith("lunes")) return c;
  }
  return approxStart;
}

function weekIdFromFirstDayCell(cell: unknown): string | null {
  if (cell === null || cell === undefined || cell === "") return null;
  if (typeof cell === "number") {
    const d = excelSerialToDate(cell);
    return d ? getIsoWeekId(d) : null;
  }
  const s = normCell(cell);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return getIsoWeekId(d);
  }
  const d2 = new Date(s);
  if (!Number.isNaN(d2.getTime())) {
    return getIsoWeekId(d2);
  }
  return null;
}
