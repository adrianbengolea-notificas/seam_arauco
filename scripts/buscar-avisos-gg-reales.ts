/**
 * Inventario de avisos GG reales vs falsos positivos «MTTO …-SSGG».
 * Uso: npx tsx --env-file=.env.local scripts/buscar-avisos-gg-reales.ts
 */
/* eslint-disable no-console */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { ASSETS_COLLECTION, COLLECTIONS } from "@/lib/firestore/collections";

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.replace(/^\s*export\s+/, "").trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

type ActivoGg = { id: string; codigo_nuevo: string; ubicacion_tecnica: string; centro: string };

async function loadActivosGg(): Promise<ActivoGg[]> {
  const db = getAdminDb();
  const snap = await db.collection(ASSETS_COLLECTION).where("especialidad_predeterminada", "==", "GG").get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      codigo_nuevo: String(x.codigo_nuevo ?? "").trim(),
      ubicacion_tecnica: String(x.ubicacion_tecnica ?? "").trim(),
      centro: String(x.centro ?? "").trim(),
    };
  });
}

async function main(): Promise<void> {
  loadEnvLocal();
  const db = getAdminDb();
  const activosGg = await loadActivosGg();
  const activoIds = new Set(activosGg.map((a) => a.id));
  const utGg = new Set(activosGg.map((a) => a.ubicacion_tecnica).filter(Boolean));

  console.log(`\n=== ACTIVOS GG EN CATÁLOGO (${activosGg.length}) ===\n`);
  for (const a of activosGg) {
    console.log(`  ${a.id.padEnd(22)}  ${a.centro}  ${a.ubicacion_tecnica}`);
  }

  const snapGg = await db.collection(COLLECTIONS.avisos).where("especialidad", "==", "GG").get();
  const avisosGg = snapGg.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));

  const vinculadosGenerador = avisosGg.filter((a) => {
    const asset = String((a as { asset_id?: string }).asset_id ?? "").trim();
    if (asset && activoIds.has(asset)) return true;
    const ut = String((a as { ubicacion_tecnica?: string }).ubicacion_tecnica ?? "").trim();
    if (!ut) return false;
    for (const u of utGg) {
      if (ut === u || ut.startsWith(`${u}-`) || u.startsWith(`${ut}-`)) return true;
    }
    return false;
  });

  const ssggFalsos = await db
    .collection(COLLECTIONS.avisos)
    .where("texto_corto", ">=", "MTTO")
    .where("texto_corto", "<=", "MTTO\uf8ff")
    .get();
  const ssggAmbiguos = ssggFalsos.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }))
    .filter((a) => {
      const t = String((a as { texto_corto?: string }).texto_corto ?? "").toUpperCase();
      return t.includes("SSGG") && (a as { especialidad?: string }).especialidad !== "GG";
    });

  console.log(`\n=== AVISOS CON especialidad=GG (${avisosGg.length}) ===\n`);
  if (!avisosGg.length) {
    console.log("  Ninguno en Firestore.");
  } else {
    for (const a of avisosGg.slice(0, 30)) {
      const row = a as {
        n_aviso?: string;
        texto_corto?: string;
        asset_id?: string;
        ubicacion_tecnica?: string;
        centro?: string;
        estado?: string;
      };
      const enCat = activoIds.has(String(row.asset_id ?? "").trim()) ? " [activo GG]" : "";
      console.log(
        `  ${String(row.n_aviso ?? a.id).padEnd(12)} ${String(row.centro ?? "").padEnd(6)} ${String(row.estado ?? "").padEnd(12)} ${(row.texto_corto ?? "").slice(0, 55)}${enCat}`,
      );
    }
    if (avisosGg.length > 30) console.log(`  … y ${avisosGg.length - 30} más`);
  }

  console.log(`\n=== AVISOS GG VINCULADOS A LOS ${activosGg.length} GENERADORES (${vinculadosGenerador.length}) ===\n`);
  if (!vinculadosGenerador.length) {
    console.log("  Ningún preventivo con especialidad GG ligado al catálogo de generadores.");
  } else {
    for (const a of vinculadosGenerador) {
      const row = a as {
        n_aviso?: string;
        texto_corto?: string;
        asset_id?: string;
        ubicacion_tecnica?: string;
        estado?: string;
      };
      console.log(
        `  ${String(row.n_aviso ?? a.id)}  asset=${row.asset_id ?? "—"}  ${row.ubicacion_tecnica ?? ""}  ${row.texto_corto ?? ""}`,
      );
    }
  }

  console.log(`\n=== FALSOS POSITIVOS «…SSGG…» (especialidad ≠ GG): ${ssggAmbiguos.length} ===\n`);
  const porEsp = new Map<string, number>();
  for (const a of ssggAmbiguos) {
    const e = String((a as { especialidad?: string }).especialidad ?? "?");
    porEsp.set(e, (porEsp.get(e) ?? 0) + 1);
  }
  for (const [e, n] of [...porEsp.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${e}: ${n}`);
  }
  console.log("\n  (Estos ya no aparecerán en el filtro GG de Vencimientos tras el fix del substring.)\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
