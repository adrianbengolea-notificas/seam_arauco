import * as XLSX from "xlsx";

export type Matrix = (string | number | null | undefined)[][];

export function normHeader(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function str(cell: string | number | null | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number" && !Number.isNaN(cell)) {
    if (Math.abs(cell - Math.round(cell)) < 1e-9 && Math.abs(cell) > 1e6) {
      return String(Math.round(cell));
    }
  }
  return String(cell).trim();
}

export function sheetMatrix(sheet: XLSX.WorkSheet): Matrix {
  return XLSX.utils.sheet_to_json<Matrix[0]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as Matrix;
}

export function headerIndexMap(headerRow: Matrix[0]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < (headerRow?.length ?? 0); i++) {
    const key = normHeader(String(headerRow[i] ?? ""));
    if (key && !m.has(key)) m.set(key, i);
  }
  return m;
}

export function findHeaderRowByKeys(matrix: Matrix, mustIncludeAll: string[], maxRows = 50): number {
  const need = mustIncludeAll.map((t) => normHeader(t));
  const max = Math.min(matrix.length, maxRows);
  for (let r = 0; r < max; r++) {
    const cells = (matrix[r] ?? []).map((c) => normHeader(String(c ?? "")));
    const hit = need.every((k) => cells.some((c) => c.includes(k)));
    if (hit) return r;
  }
  return -1;
}
