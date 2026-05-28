/**
 * Importa filas del Excel vigente que no están en Firestore y actualiza centro
 * cuando el número SAP ya existe pero con planta distinta (BOSS→PF01 vs PM02, etc.).
 *
 * Uso:
 *   npx tsx scripts/importar-y-corregir-preventivos-excel.ts "ruta.xlsx"
 *   npx tsx scripts/importar-y-corregir-preventivos-excel.ts --apply
 *   npx tsx scripts/importar-y-corregir-preventivos-excel.ts --apply --solo-mayo
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { ensurePlansForCentro } from "@/lib/plan-mantenimiento/admin";
import { deriveCentroPlantCodeFromUbicacionTecnica, normalizeCentro } from "@/lib/firestore/derive-centro";
import { commitParsedAvisoRows } from "@/lib/import/commit-parsed-avisos";
import { normalizeNAvisoCompare } from "@/lib/import/aviso-numero-canonical";
import {
  buildUbicacionToAssetIdLookup,
  resolveAssetIdFromLookup,
} from "@/lib/import/asset-ut-lookup";
import { parseAvisosPorModo } from "@/lib/import/parse-avisos-excel";
import type { ParsedAvisoRow } from "@/lib/import/parse-avisos-excel";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

const ACTOR_UID = process.env.SCRIPT_ACTOR_UID?.trim() || "script-importar-preventivos-excel";

function parseArgs() {
  const argv = process.argv.slice(2);
  let excelPath = path.join(
    process.env.USERPROFILE ?? "",
    "Documents",
    "Downloads",
    "AVISOS PREVENTIVOS Abril 26 - Marzo 27.xlsx",
  );
  let apply = false;
  let soloMayo = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--apply") apply = true;
    if (a === "--solo-mayo") soloMayo = true;
    else if (!a.startsWith("-") && (a.endsWith(".xlsx") || a.endsWith(".xls"))) excelPath = a;
  }
  return { excelPath, apply, soloMayo };
}

function buildAvisoIndex(docs: QueryDocumentSnapshot[]) {
  const byNorm = new Map<string, { id: string; centro: string }>();
  for (const d of docs) {
    const na = String(d.get("n_aviso") ?? "").trim();
    const c = String(d.get("centro") ?? "").trim();
    if (!na) continue;
    const norm = normalizeNAvisoCompare(na);
    if (!byNorm.has(norm)) byNorm.set(norm, { id: d.id, centro: c });
  }
  return byNorm;
}

async function main() {
  const { excelPath, apply, soloMayo } = parseArgs();
  if (!fs.existsSync(excelPath)) {
    console.error("No existe:", excelPath);
    process.exit(1);
  }

  console.log("=== Importar / corregir preventivos desde Excel ===\n");
  console.log("Archivo:", excelPath);
  console.log("Modo:", apply ? "APLICAR" : "SIMULACIÓN (--apply para persistir)");
  if (soloMayo) console.log("Filtro: solo filas con número 113845… (hoja Mayo)");

  const buf = fs.readFileSync(excelPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = await parseAvisosPorModo(ab as ArrayBuffer, "preventivos_todas");
  if (parsed.fatal) {
    console.error("Parse fatal:", parsed.fatal);
    process.exit(1);
  }

  const db = getAdminDb();
  const assetsSnap = await db.collection(COLLECTIONS.assets).get();
  const utToAsset = buildUbicacionToAssetIdLookup(assetsSnap.docs);
  const codigoByAsset = new Map<string, string>();
  for (const d of assetsSnap.docs) {
    const c = String(d.get("codigo_nuevo") ?? "").trim();
    if (c) codigoByAsset.set(d.id, c);
  }

  const avisosSnap = await db.collection(COLLECTIONS.avisos).limit(120_000).get();
  const avisoByNum = buildAvisoIndex(avisosSnap.docs);

  const rowsNuevas: ParsedAvisoRow[] = [];
  const rowsCentro: Array<{
    avisoId: string;
    numero: string;
    de: string;
    a: string;
    row: ParsedAvisoRow;
  }> = [];

  for (const row of parsed.avisos) {
    if (row.tipo !== "preventivo" || !row.numero?.trim()) continue;
    if (soloMayo && !row.numero.trim().startsWith("113845")) continue;
    const ut = (row.ubicacionTecnica ?? "").trim();
    const mtsa = row.frecuencia;
    if (!ut || !mtsa) continue;

    const assetId = resolveAssetIdFromLookup(utToAsset, ut) ?? "";
    const codigo = assetId ? codigoByAsset.get(assetId) : undefined;
    const centroUt = deriveCentroPlantCodeFromUbicacionTecnica(ut);
    const centroCalc = normalizeCentro(String(row.centro ?? ""), ut, codigo);
    const numero = row.numero.trim();
    const existing = avisoByNum.get(normalizeNAvisoCompare(numero));

    if (!existing) {
      rowsNuevas.push({ ...row, centro: centroCalc });
      continue;
    }
    if (existing.centro !== centroUt) {
      rowsCentro.push({
        avisoId: existing.id,
        numero,
        de: existing.centro,
        a: centroUt,
        row: { ...row, centro: centroUt },
      });
    }
  }

  console.log(`\nFilas parseadas preventivo: ${parsed.avisos.filter((a) => a.tipo === "preventivo").length}`);
  console.log(`A sincronizar: ${rowsNuevas.length + rowsCentro.length}`);
  console.log(`  Nuevas (sin doc): ${rowsNuevas.length}`);
  console.log(`  Corregir centro (update directo): ${rowsCentro.length}`);

  const byMtsa = new Map<string, number>();
  for (const r of [...rowsNuevas, ...rowsCentro.map((c) => c.row)]) {
    const m = r.frecuencia ?? "?";
    byMtsa.set(m, (byMtsa.get(m) ?? 0) + 1);
  }
  console.log("  Por frecuencia:", Object.fromEntries(byMtsa));

  console.log("\nMuestra (primeras 12):");
  for (const c of rowsCentro.slice(0, 6)) {
    console.log(`  centro ${c.de}→${c.a} | ${c.numero} | ${c.row.frecuencia}`);
  }
  for (const r of rowsNuevas.slice(0, 6)) {
    console.log(`  nuevo | ${r.numero} | ${r.centro} | ${r.frecuencia}`);
  }

  if (!apply) {
    console.log("\nSimulación terminada. Re-ejecutá con --apply.");
    return;
  }

  if (!rowsNuevas.length && !rowsCentro.length) {
    console.log("\nNada que importar/actualizar.");
    return;
  }

  let importados = 0;
  let actualizados = 0;
  const errores: string[] = [];
  const centrosTocados = new Set<string>();

  if (rowsNuevas.length) {
    const result = await commitParsedAvisoRows({
      modo: "preventivos_todas",
      rows: rowsNuevas,
      actorUid: ACTOR_UID,
    });
    importados = result.importados;
    actualizados += result.actualizados;
    errores.push(...result.errores);
    for (const r of rowsNuevas) {
      const c = r.centro;
      if (typeof c === "string" && c.trim()) centrosTocados.add(c.trim());
    }
    console.log("\n--- Importación (commit) ---");
    console.log("Importados:", result.importados, "| Sin activo UT:", result.sinActivoUt);
    if (result.errores.length) {
      for (const e of result.errores.slice(0, 10)) console.log("  ", e);
    }
  }

  if (rowsCentro.length) {
    const avisosCol = db.collection(COLLECTIONS.avisos);
    const planCol = db.collection(COLLECTIONS.plan_mantenimiento);
    const bloqueados: string[] = [];
    let ok = 0;

    for (const c of rowsCentro) {
      const clash = await avisosCol
        .where("centro", "==", c.a)
        .where("n_aviso", "==", c.numero)
        .limit(2)
        .get();
      const otros = clash.docs.filter((d) => d.id !== c.avisoId);
      if (otros.length) {
        bloqueados.push(
          `${c.avisoId} (${c.numero}): ya hay aviso en ${c.a} (ids ${otros.map((d) => d.id).join(", ")})`,
        );
        continue;
      }
      await avisosCol.doc(c.avisoId).update({
        centro: c.a,
        updated_at: FieldValue.serverTimestamp(),
      });
      const planSnap = await planCol.doc(c.avisoId).get();
      if (planSnap.exists) {
        await planCol.doc(c.avisoId).update({
          centro: c.a,
          activo: true,
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      centrosTocados.add(c.a);
      centrosTocados.add(c.de);
      ok++;
      console.log(`  centro ${c.de}→${c.a} | ${c.numero} (id ${c.avisoId})`);
    }

    actualizados += ok;
    console.log(`\n--- Corrección centro ---`);
    console.log(`Actualizados: ${ok} | Bloqueados: ${bloqueados.length}`);
    for (const b of bloqueados) console.log(`  ✗ ${b}`);
    errores.push(...bloqueados);
  }

  for (const c of centrosTocados) {
    await ensurePlansForCentro(c);
  }

  const logPath = path.join(process.cwd(), "importar-preventivos-excel-log.json");
  fs.writeFileSync(
    logPath,
    JSON.stringify(
      {
        generado: new Date().toISOString(),
        excelPath,
        importados,
        centrosCorregidos: rowsCentro.length,
        actualizados,
        errores,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log("\nLog:", logPath);
  console.log("=== Fin ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
