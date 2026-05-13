/* eslint-disable no-console */
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

// Buscar archivos que matcheen "AVISOS PREVENTIVOS"
const dir = "C:/Users/Adrian/Downloads";
const files = fs.readdirSync(dir).filter((f) =>
  f.toLowerCase().includes("avisos preventivos") || f.toLowerCase().includes("avisos_preventivos"),
);
console.log("Archivos encontrados:", files);

for (const fname of files) {
  const fpath = path.join(dir, fname);
  console.log(`\n=== ${fname} ===`);
  const wb = XLSX.readFile(fpath);
  console.log("Hojas:", wb.SheetNames.join(", "));
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]!;
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1 }) as unknown[][];
    console.log(`  Hoja "${sheetName}": ${rows.length} filas`);
    if (rows.length > 0) {
      console.log("  Cabecera:", rows[0]!.slice(0, 10).join(" | "));
    }
    // Muestra 2 filas de datos
    for (const row of rows.slice(1, 3)) {
      console.log("  Fila:", row.slice(0, 8).join(" | "));
    }
  }
}
