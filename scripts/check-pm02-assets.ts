/* eslint-disable no-console */
import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { ASSETS_COLLECTION, COLLECTIONS } from "@/lib/firestore/collections";

async function main() {
  const db = getAdminDb();
  const avisosSnap = await db.collection(COLLECTIONS.avisos).where("centro", "==", "PM02").limit(5).get();
  console.log("Avisos PM02 (ut → asset_id):");
  for (const d of avisosSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    console.log(`  ut=${data.ubicacion_tecnica} | asset=${data.asset_id}`);
  }

  const assetsSnap = await db.collection(ASSETS_COLLECTION).get();
  const boss = assetsSnap.docs.filter((d) =>
    String(d.data().ubicacion_tecnica ?? "").toUpperCase().startsWith("BOSS"),
  );
  console.log(`\nActivos BOSS*: ${boss.length}`);
  for (const d of boss.slice(0, 5)) {
    const data = d.data() as Record<string, unknown>;
    console.log(`  ${d.id} | ut=${data.ubicacion_tecnica} | codigo=${data.codigo_nuevo}`);
  }

  // Ver qué UTs de avisos PT01 del Excel no tienen match
  const piraUts = ["PIRA-PIR", "PIRA-PIR-CAB", "PIRA-PIR-HOT", "PIRA-PIR-BVR", "PIRA-PIR-MDF-BALANZ"];
  const allAssets = assetsSnap.docs.map((d) => ({
    id: d.id,
    ut: String(d.data().ubicacion_tecnica ?? "").trim(),
    codigo: String(d.data().codigo_nuevo ?? "").trim(),
  }));
  console.log("\nBúsqueda de UTs Piray en catálogo:");
  for (const ut of piraUts) {
    const match = allAssets.find((a) => a.ut.toUpperCase() === ut.toUpperCase() || a.codigo.toUpperCase() === ut.toUpperCase());
    console.log(`  ${ut} → ${match ? match.id : "SIN MATCH"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
