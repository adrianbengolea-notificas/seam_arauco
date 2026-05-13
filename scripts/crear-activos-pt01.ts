/* eslint-disable no-console */
/**
 * Crea activos sintéticos para las UTs de Piray (PT01) que no tienen activo en el catálogo.
 * Usa los datos de los Excel de avisos para obtener UT → descripción.
 *
 * Por defecto: dry-run. Aplicar con --commit.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/crear-activos-pt01.ts
 *   npx tsx --env-file=.env.local scripts/crear-activos-pt01.ts --commit
 */
import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });

import * as XLSX from "xlsx";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { ASSETS_COLLECTION } from "@/lib/firestore/collections";
import { buildUbicacionToAssetIdLookup, resolveAssetIdFromLookup } from "@/lib/import/asset-ut-lookup";

const COMMIT = process.argv.includes("--commit");

const FILES = [
  "C:/Users/Adrian/Downloads/Listado avisos Semestral-Anual.xlsx",
  "C:/Users/Adrian/Downloads/Listado Avisos mensual-trim.xlsx",
  "C:/Users/Adrian/Downloads/MENSUALES MARZO 2026 (1).xlsx",
];

/** Genera un ID de activo corto y legible a partir de la UT de Piray. */
function utToAssetId(ut: string): string {
  // PIRA-PIR → PT01PIR
  // PIRA-PIR-HOT → PT01HOT
  // PIRA-PIR-HOT-HOTEL1-HABIT001 → PT01HOTHAB001
  const suffix = ut.replace(/^PIRA-PIR-?/i, "").trim();
  if (!suffix) return "PT01PIR";
  // Tomar segmentos, abreviar, limitar a 15 chars
  const parts = suffix.split("-");
  let code = "PT01";
  for (const p of parts) {
    // Tomar primeros 3-4 chars de cada segmento
    const abbrev = p.replace(/[^A-Z0-9]/gi, "").slice(0, 5).toUpperCase();
    if (abbrev) code += abbrev;
    if (code.length >= 18) break;
  }
  return code.slice(0, 20);
}

async function main() {
  const db = getAdminDb();
  const assetsSnap = await db.collection(ASSETS_COLLECTION).get();
  const utToAsset = buildUbicacionToAssetIdLookup(assetsSnap.docs);

  // Recopilar UTs únicas de Excel para PT01
  const utInfo = new Map<string, { denom: string; count: number }>();
  for (const f of FILES) {
    let wb: XLSX.WorkBook;
    try { wb = XLSX.readFile(f); } catch { continue; }
    const ws = wb.Sheets[wb.SheetNames[0]!];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    for (const r of rows) {
      if (String(r["CePl"] ?? "").trim() !== "PT01") continue;
      const ut = String(r["Ubicación técnica"] ?? "").trim();
      const denom = String(r["Denom.ubic.técnica"] ?? "").trim();
      if (!ut) continue;
      const existing = utInfo.get(ut) ?? { denom, count: 0 };
      existing.count++;
      utInfo.set(ut, existing);
    }
  }

  // Filtrar solo las que no tienen activo
  const sinActivo = [...utInfo.entries()].filter(
    ([ut]) => !resolveAssetIdFromLookup(utToAsset, ut),
  );

  console.log(`\nUTs PT01 sin activo: ${sinActivo.length}`);

  // Verificar colisiones de ID generado
  const idMap = new Map<string, string>(); // id → ut
  const toCreate: Array<{ id: string; ut: string; denom: string }> = [];
  for (const [ut, info] of sinActivo) {
    let id = utToAssetId(ut);
    // Si hay colisión, agregar sufijo numérico
    let attempt = 0;
    while (idMap.has(id) && idMap.get(id) !== ut) {
      attempt++;
      id = `${utToAssetId(ut).slice(0, 17)}${attempt.toString().padStart(2, "0")}`;
    }
    idMap.set(id, ut);
    toCreate.push({ id, ut, denom: info.denom });
    console.log(`  ${id.padEnd(22)} ← ${ut} (${info.count} avisos) — "${info.denom}"`);
  }

  if (!COMMIT) {
    console.log(`\nModo DRY-RUN — se crearían ${toCreate.length} activos.`);
    console.log("Para aplicar: npx tsx --env-file=.env.local scripts/crear-activos-pt01.ts --commit");
    return;
  }

  if (toCreate.length === 0) {
    console.log("\nNada que crear.");
    return;
  }

  // Verificar cuáles ya existen en Firestore por ID
  const existingIds = new Set<string>();
  const col = db.collection(ASSETS_COLLECTION);
  for (let i = 0; i < toCreate.length; i += 30) {
    const chunk = toCreate.slice(i, i + 30);
    const snaps = await db.getAll(...chunk.map((c) => col.doc(c.id)));
    for (const s of snaps) if (s.exists) existingIds.add(s.id);
  }

  const batch = db.batch();
  let n = 0;
  for (const { id, ut, denom } of toCreate) {
    const ref = col.doc(id);
    if (existingIds.has(id)) {
      console.log(`  SKIP (ya existe): ${id}`);
      continue;
    }
    batch.set(ref, {
      codigo_nuevo: id,
      ubicacion_tecnica: ut,
      descripcion: denom || ut,
      centro: "PT01",
      tipo: "INSTALACION",
      activo: true,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    n++;
  }

  if (n > 0) {
    await batch.commit();
    console.log(`\n✓ ${n} activos PT01 creados.`);
    console.log("  Ahora importá los avisos PT01 desde Configuración → Importación.");
  } else {
    console.log("\nTodos los activos ya existían.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
