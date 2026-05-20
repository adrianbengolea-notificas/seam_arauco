/**
 * Diagnóstico offline: parsea Excel de avisos con la misma lógica que la UI de importación.
 * Uso: npx tsx scripts/diagnostico-excel-avisos.ts "ruta1.xlsx" ["ruta2.xlsx"]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { parseAvisosPorModo } from "@/lib/import/parse-avisos-excel";
import type { ModoImportacionAvisos } from "@/lib/import/modo-importacion";
import { normalizeHeader } from "@/lib/import/normalize-headers";

const MODOS_PREVENTIVOS: ModoImportacionAvisos[] = [
  "preventivos_todas",
  "preventivos_mensual",
  "preventivos_trimestral",
  "preventivos_semestral",
  "preventivos_anual",
  "calendario_mensual",
  "calendario_trimestral",
];

function sheetFreqFromName(sheetName: string): string | null {
  const n = normalizeHeader(sheetName);
  if (n.includes("semestral")) return "S";
  if (n.includes("anual") && !n.includes("semest")) return "A";
  if (n.includes("trim")) return "T";
  if (n.startsWith("men") || n.includes("mensual")) return "M";
  if (/^sem\b/.test(n)) return "S";
  if (/^anu\b/.test(n)) return "A";
  return null;
}

async function diagnosticoArchivo(filePath: string) {
  console.log("\n" + "=".repeat(72));
  console.log("ARCHIVO:", filePath);
  console.log("=".repeat(72));

  if (!fs.existsSync(filePath)) {
    console.log("  ✗ No existe el archivo");
    return;
  }

  const buf = fs.readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const wb = XLSX.read(ab, { type: "array", cellDates: true });

  console.log("\nHojas en el archivo:");
  for (const name of wb.SheetNames) {
    const freq = sheetFreqFromName(name);
    const sh = wb.Sheets[name]!;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: null, raw: true }) as unknown[][];
    console.log(`  - «${name}» (${matrix.length} filas)${freq ? ` → frecuencia detectada: ${freq}` : " → SIN frecuencia en nombre (hoja NO se importa en modo preventivos_*)"}`);
    // primeras 3 filas no vacías
    let shown = 0;
    for (let r = 0; r < Math.min(matrix.length, 15) && shown < 3; r++) {
      const row = matrix[r] ?? [];
      const nonEmpty = row.some((c) => c != null && String(c).trim() !== "");
      if (!nonEmpty) continue;
      console.log(`      fila ${r + 1}:`, row.slice(0, 12).map((c) => (c == null ? "" : String(c).slice(0, 30))));
      shown++;
    }
  }

  for (const modo of MODOS_PREVENTIVOS) {
    const pr = await parseAvisosPorModo(ab as ArrayBuffer, modo);
    console.log(`\n--- Modo: ${modo} ---`);
    console.log(`  Avisos parseados: ${pr.avisos.length}`);
    console.log(`  Errores: ${pr.errores.length}`);
    console.log(`  Advertencias: ${pr.advertencias.length}`);
    if (pr.fatal) console.log(`  FATAL: ${pr.fatal}`);
    if (pr.hojasProcesadas?.length) console.log(`  Hojas procesadas: ${pr.hojasProcesadas.join(", ")}`);
    if (pr.errores.length) {
      console.log("  Primeros errores:");
      for (const e of pr.errores.slice(0, 8)) {
        console.log(`    fila ${e.fila} [${e.campo}]: ${e.motivo} (valor: ${JSON.stringify(e.valor)?.slice(0, 40)})`);
      }
      if (pr.errores.length > 8) console.log(`    ... y ${pr.errores.length - 8} más`);
    }
    if (pr.advertencias.length) {
      console.log("  Primeras advertencias:");
      for (const a of pr.advertencias.slice(0, 5)) {
        console.log(`    ${a.mensaje}`);
      }
    }
    if (pr.columnasMapeadas && Object.keys(pr.columnasMapeadas).length) {
      console.log("  Columnas mapeadas:", JSON.stringify(pr.columnasMapeadas));
    }
    if (pr.columnasNoReconocidas?.length) {
      console.log("  Columnas no reconocidas:", pr.columnasNoReconocidas.slice(0, 15).join(" | "));
    }
    // muestra números de aviso de muestra
    if (pr.avisos.length) {
      const nums = pr.avisos.slice(0, 5).map((a) => a.numero);
      console.log(`  Muestra números: ${nums.join(", ")}${pr.avisos.length > 5 ? "..." : ""}`);
      const sinMes = pr.avisos.filter((a) => a.tipo === "preventivo" && (a.frecuencia === "M" || a.frecuencia === "T") && !a.meses_programados?.length);
      if (sinMes.length && modo.startsWith("calendario")) {
        console.log(`  ⚠ ${sinMes.length} preventivos M/T sin meses_programados (serían rechazados en calendario)`);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const files =
    args.length > 0
      ? args
      : [
          path.join(process.env.USERPROFILE ?? "", "Documents", "Programas semanales 2026-1.xlsx"),
          path.join(
            process.env.USERPROFILE ?? "",
            "Documents",
            "Downloads",
            "AVISOS PREVENTIVOS Abril 26 - Marzo 27.xlsx",
          ),
        ];

  for (const f of files) {
    await diagnosticoArchivo(f);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
