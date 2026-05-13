/**
 * Importa activos desde el Excel de códigos (hojas AA y GG) a Firestore `assets`.
 *
 * Uso por planta / centro (cada corrida = un lote, típicamente un archivo o un `--centro`):
 *   npx tsx scripts/import-assets-from-xlsx.ts --file "ruta.xlsx" --centro "Centro"
 *
 * Otra planta en otro momento (mismo formato de Excel):
 *   npx tsx scripts/import-assets-from-xlsx.ts --file "otra-planta.xlsx" --centro "Piray"
 *
 * La lógica de parseo y escritura está en `modules/assets/excel-import.ts` (compartida con la UI admin).
 *
 * Requiere en el entorno: GOOGLE_APPLICATION_CREDENTIALS o FIREBASE_SERVICE_ACCOUNT_KEY,
 * más NEXT_PUBLIC_FIREBASE_PROJECT_ID (y opcionalmente NEXT_PUBLIC_FIREBASE_FIRESTORE_DATABASE_ID).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import {
  commitAssetsImportRows,
  parseAssetsWorkbook,
} from "../modules/assets/excel-import";

function parseArgs() {
  const argv = process.argv.slice(2);
  let file: string | undefined;
  let centroDefault: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true as const };
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--file" || a === "-f") {
      file = argv[++i];
      continue;
    }
    if (a === "--centro" || a === "-c") {
      centroDefault = argv[++i];
      continue;
    }
    if (!a.startsWith("-") && !file && fs.existsSync(path.resolve(a))) {
      file = a;
    }
  }
  return { help: false as const, file, centroDefault, dryRun };
}

function printHelp() {
  console.log(`
Importar activos (Firestore «assets») desde Excel.

  npm run import:assets -- --file "C:\\ruta\\archivo.xlsx" --centro "Centro"

Opciones:
  --file, -f   Ruta al .xlsx
  --centro, -c Valor por defecto de «centro» / planta para todas las filas (obligatorio salvo que cada fila tenga columna Centro o Planta en el Excel)
  --dry-run    Solo listar cantidad de filas y advertencias; no escribe en Firestore

Plantas / centros:
  Ejecutá de nuevo con otro --centro (y otro --file si aplica) para cargar equipos de otra planta.
  Si el Excel incluye columna «Centro» o «Planta», ese texto reemplaza al --centro de esa fila.

Entorno: FIREBASE_SERVICE_ACCOUNT_KEY (JSON) o GOOGLE_APPLICATION_CREDENTIALS, y NEXT_PUBLIC_FIREBASE_PROJECT_ID.
`);
}

async function main() {
  const args = parseArgs();
  if ("help" in args && args.help) {
    printHelp();
    process.exit(0);
  }

  const { file, centroDefault, dryRun } = args;
  if (!file) {
    console.error("Falta --file «ruta.xlsx» (o pasá la ruta como primer argumento).");
    printHelp();
    process.exit(1);
  }
  if (!centroDefault?.trim()) {
    console.error(
      'Falta --centro «nombre de planta». Ej.: --centro "Centro". Si el Excel tiene columna Centro/Planta en cada fila, podés usar --centro como respaldo para filas vacías.',
    );
    process.exit(1);
  }

  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`No existe el archivo: ${abs}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(abs);
  const { rows, warnings } = parseAssetsWorkbook(workbook, centroDefault.trim());

  for (const w of warnings) console.warn("⚠", w);
  console.log(`Filas listas para importar: ${rows.length}${dryRun ? " (dry-run, sin escribir)" : ""}.`);

  if (dryRun) {
    const byCentro = new Map<string, number>();
    for (const r of rows) {
      byCentro.set(r.centro, (byCentro.get(r.centro) ?? 0) + 1);
    }
    console.log("Por centro / planta:");
    for (const [c, n] of byCentro) console.log(`  ${c}: ${n}`);
    process.exit(0);
  }

  if (!rows.length) {
    console.warn("Nada que importar.");
    process.exit(0);
  }

  await commitAssetsImportRows(rows);
  console.log(`Listo: ${rows.length} documentos escritos (merge) en «assets».`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
