/* eslint-disable no-console */
/**
 * Lista las UTs únicas de los avisos PT01 en los Excel,
 * y muestra cuáles ya tienen activo en el catálogo.
 */
import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });
import * as XLSX from "xlsx";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { ASSETS_COLLECTION } from "@/lib/firestore/collections";
import { buildUbicacionToAssetIdLookup } from "@/lib/import/asset-ut-lookup";
import { resolveAssetIdFromLookup } from "@/lib/import/asset-ut-lookup";

const FILES = [
  "C:/Users/Adrian/Downloads/Listado avisos Semestral-Anual.xlsx",
  "C:/Users/Adrian/Downloads/Listado Avisos mensual-trim.xlsx",
  "C:/Users/Adrian/Downloads/MENSUALES MARZO 2026 (1).xlsx",
];

async function main() {
  const db = getAdminDb();
  const snap = await db.collection(ASSETS_COLLECTION).get();
  const utToAsset = buildUbicacionToAssetIdLookup(snap.docs);

  const utMap = new Map<string, { denom: string; centros: Set<string>; count: number }>();

  for (const f of FILES) {
    let wb: XLSX.WorkBook;
    try { wb = XLSX.readFile(f); } catch { continue; }
    const ws = wb.Sheets[wb.SheetNames[0]!];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    for (const r of rows) {
      const cepl = String(r["CePl"] ?? "").trim();
      if (cepl !== "PT01") continue;
      const ut = String(r["Ubicación técnica"] ?? "").trim();
      const denom = String(r["Denom.ubic.técnica"] ?? "").trim();
      if (!ut) continue;
      const existing = utMap.get(ut) ?? { denom, centros: new Set(), count: 0 };
      existing.centros.add(cepl);
      existing.count++;
      utMap.set(ut, existing);
    }
  }

  console.log(`\nUTs únicas de avisos PT01 (${utMap.size} distintas):\n`);
  for (const [ut, info] of [...utMap.entries()].sort()) {
    const assetId = resolveAssetIdFromLookup(utToAsset, ut);
    const status = assetId ? `✓ ${assetId}` : "✗ SIN ACTIVO";
    console.log(`  [${status}] ${ut} (${info.count} avisos) — "${info.denom}"`);
  }

  const sinActivo = [...utMap.entries()].filter(([ut]) => !resolveAssetIdFromLookup(utToAsset, ut));
  console.log(`\n→ ${sinActivo.length}/${utMap.size} UTs sin activo en catálogo.`);
  console.log("  Crear activos sintéticos para estas UTs permite importar los avisos PT01.");
}
main().catch((e) => { console.error(e); process.exit(1); });
