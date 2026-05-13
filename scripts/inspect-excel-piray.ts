/* eslint-disable no-console */
import * as XLSX from "xlsx";

const FILES = [
  "C:/Users/Adrian/Downloads/Listado avisos Semestral-Anual.xlsx",
  "C:/Users/Adrian/Downloads/Listado Avisos mensual-trim.xlsx",
  "C:/Users/Adrian/Downloads/MENSUALES MARZO 2026 (1).xlsx",
  "C:/Users/Adrian/Downloads/CORRECTIVOS-MARZO 26.xlsx",
];

for (const f of FILES) {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.readFile(f);
  } catch {
    console.log(`\n=== ${f.split("/").pop()} — NO SE PUDO LEER ===`);
    continue;
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  console.log(`\n=== ${f.split("/").pop()} (${rows.length} filas) ===`);
  if (rows.length === 0) continue;
  console.log("Columnas:", Object.keys(rows[0]).join(" | "));
  console.log("\n--- Primeras 3 filas ---");
  for (const r of rows.slice(0, 3)) console.log(JSON.stringify(r));

  // Buscar filas que tengan Piray / PT01 / PIRAY en cualquier campo
  const piray = rows.filter((r) =>
    Object.values(r).some((v) => String(v).toLowerCase().includes("piray") || String(v).includes("PT01") || String(v).includes("PIR")),
  );
  console.log(`\n--- Filas con Piray/PT01/PIR: ${piray.length} ---`);
  for (const r of piray.slice(0, 10)) console.log(JSON.stringify(r));

  // Mostrar valores únicos de columnas que parecen "centro" o "ubicación"
  const colNames = Object.keys(rows[0]);
  const candidatas = colNames.filter((c) =>
    /centro|cecos|ubicaci|ut|centro_costo|planta/i.test(c),
  );
  console.log("\n--- Columnas candidatas a centro/UT:", candidatas, "---");
  for (const col of candidatas) {
    const vals = [...new Set(rows.map((r) => String(r[col] ?? "").trim()))].filter(Boolean).slice(0, 20);
    console.log(`  ${col}:`, vals.join(", "));
  }
}
