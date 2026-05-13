/** RFC4180-style: comillas y escapado de comillas internas. */
export function csvEscapeCell(value: string): string {
  const s = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscapeCell).join(",")).join("\r\n") + "\r\n";
}
