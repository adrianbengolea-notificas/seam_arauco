/* eslint-disable no-console */
/**
 * Corrige el asset_id de OTs ELECTRICO que quedaron vinculadas a un activo real
 * del catálogo (ej. un activo AA) en vez del sintético `ee-gral-{centro}`.
 *
 * Campos que actualiza:
 *   asset_id              → ee-gral-{centro}
 *   equipo_codigo         → "EE-GRAL"  (solo si el campo existe en el doc)
 *   codigo_activo_snapshot → "EE-GRAL"  (solo si el campo existe en el doc)
 *
 * Uso:
 *   npx tsx scripts/fix-asset-id-ots-electrico.ts            <- solo lista
 *   npx tsx scripts/fix-asset-id-ots-electrico.ts --fix      <- aplica con confirmacion
 */

import { config as loadEnv } from "dotenv";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { syntheticEeAssetId } from "@/scripts/seed/synthetic-ee-asset-id";
import * as readline from "readline";

loadEnv();
loadEnv({ path: ".env.local", override: true });

const FIX = process.argv.includes("--fix");

async function confirmar(pregunta: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(pregunta, (resp) => {
      rl.close();
      resolve(resp.trim().toLowerCase() === "si");
    });
  });
}

async function main() {
  const db = getAdminDb();

  console.log("Buscando OTs ELECTRICO con asset_id incorrecto...\n");

  const snap = await db
    .collection(COLLECTIONS.work_orders)
    .where("especialidad", "==", "ELECTRICO")
    .get();

  console.log(`OTs ELECTRICO encontradas: ${snap.size}`);

  type Afectada = {
    id: string;
    aviso: string;
    centro: string;
    assetIdActual: string;
    assetIdCorrecto: string;
    tieneEquipoCodigo: boolean;
    tieneCodigoActivo: boolean;
    estado: string;
  };

  const afectadas: Afectada[] = [];

  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const centro = String(d.centro ?? "").toUpperCase();
    const assetIdActual = String(d.asset_id ?? "");
    const assetIdCorrecto = syntheticEeAssetId(centro);

    if (!centro || assetIdActual === assetIdCorrecto) continue;

    afectadas.push({
      id: doc.id,
      aviso: String(d.aviso_numero ?? d.n_ot ?? doc.id),
      centro,
      assetIdActual,
      assetIdCorrecto,
      tieneEquipoCodigo: "equipo_codigo" in d,
      tieneCodigoActivo: "codigo_activo_snapshot" in d,
      estado: String(d.estado ?? "?"),
    });
  }

  if (afectadas.length === 0) {
    console.log("\nNo hay OTs con asset_id incorrecto. Todo OK.");
    return;
  }

  console.log(`\nOTs afectadas (${afectadas.length}):\n`);
  for (const a of afectadas) {
    console.log(`  Aviso ${a.aviso}  [${a.estado}]  centro=${a.centro}`);
    console.log(`    asset_id: ${a.assetIdActual} → ${a.assetIdCorrecto}`);
    if (a.tieneEquipoCodigo) console.log(`    equipo_codigo → "EE-GRAL"`);
    if (a.tieneCodigoActivo) console.log(`    codigo_activo_snapshot → "EE-GRAL"`);
  }

  if (!FIX) {
    console.log("\nEjecuta con --fix para corregirlas:");
    console.log("  npx tsx scripts/fix-asset-id-ots-electrico.ts --fix");
    return;
  }

  const ok = await confirmar(`\nCorregir ${afectadas.length} OTs? (si/no): `);
  if (!ok) {
    console.log("Cancelado.");
    return;
  }

  // Firestore batch max 500 ops
  const CHUNK = 400;
  let total = 0;
  for (let i = 0; i < afectadas.length; i += CHUNK) {
    const chunk = afectadas.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const a of chunk) {
      const patch: Record<string, unknown> = { asset_id: a.assetIdCorrecto };
      if (a.tieneEquipoCodigo) patch.equipo_codigo = "EE-GRAL";
      if (a.tieneCodigoActivo) patch.codigo_activo_snapshot = "EE-GRAL";
      batch.update(db.collection(COLLECTIONS.work_orders).doc(a.id), patch);
    }
    await batch.commit();
    total += chunk.length;
    console.log(`  ${total}/${afectadas.length} actualizadas...`);
  }

  console.log(`\n✓ ${afectadas.length} OTs corregidas.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
