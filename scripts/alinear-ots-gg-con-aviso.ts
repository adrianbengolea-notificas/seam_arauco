/* eslint-disable no-console */
/**
 * Alinea OTs en GG cuyo aviso vinculado ya tiene especialidad concreta (AA/ELECTRICO/HG).
 *
 *   npx tsx --env-file=.env.local scripts/alinear-ots-gg-con-aviso.ts --centro PT01
 *   npx tsx --env-file=.env.local scripts/alinear-ots-gg-con-aviso.ts --centro PT01 --apply
 */
import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { AVISOS_COLLECTION, COLLECTIONS } from "@/lib/firestore/collections";

const apply = process.argv.includes("--apply");
const centroIdx = process.argv.indexOf("--centro");
const centro = centroIdx >= 0 ? process.argv[centroIdx + 1]?.trim().toUpperCase() : null;

async function main() {
  const db = getAdminDb();
  let q = db.collection(COLLECTIONS.work_orders).where("especialidad", "==", "GG");
  if (centro) q = q.where("centro", "==", centro);
  const ots = await q.get();

  const patches: { id: string; n_ot: string; esp: string; texto: string }[] = [];
  for (const d of ots.docs) {
    const avisoId = String(d.get("aviso_id") ?? "").trim();
    if (!avisoId) continue;
    const av = await db.collection(AVISOS_COLLECTION).doc(avisoId).get();
    if (!av.exists) continue;
    const esp = String(av.get("especialidad") ?? "");
    if (esp === "AA" || esp === "ELECTRICO" || esp === "HG") {
      patches.push({
        id: d.id,
        n_ot: String(d.get("n_ot") ?? d.id),
        esp,
        texto: String(d.get("texto_trabajo") ?? "").slice(0, 45),
      });
    }
  }

  console.log(`Modo: ${apply ? "APLICAR" : "dry-run"}  Centro: ${centro ?? "(todos)"}`);
  console.log(`OTs GG a alinear con su aviso: ${patches.length}`);
  for (const p of patches) console.log(`  ${p.n_ot}  GG -> ${p.esp}  ${p.texto}`);

  if (!apply) {
    console.log("\nDry-run. Agregá --apply para escribir.");
    return;
  }

  const batch = db.batch();
  for (const p of patches) {
    batch.update(db.collection(COLLECTIONS.work_orders).doc(p.id), {
      especialidad: p.esp,
      updated_at: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log(`\nListo: ${patches.length} OTs actualizadas.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
