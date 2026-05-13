/* eslint-disable no-console */
import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });

import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";

async function main() {
  const db = getAdminDb();

  const avisosSnap = await db.collection(COLLECTIONS.avisos).where("centro", "==", "PT01").get();
  console.log(`\n=== Avisos PT01 en Firestore: ${avisosSnap.size} ===`);
  for (const d of avisosSnap.docs.slice(0, 10)) {
    const data = d.data() as Record<string, unknown>;
    console.log(
      `  ${d.id} | n_aviso=${data.n_aviso} | tipo=${data.tipo} | frec=${data.frecuencia} | estado=${data.estado} | ut=${String(data.ubicacion_tecnica ?? "").slice(0, 25)} | asset=${String(data.asset_id ?? "(vacío)").slice(0, 20)}`,
    );
  }

  if (avisosSnap.size === 0) {
    console.log("  → NO hay avisos PT01. Importar primero.");
    return;
  }

  // Planes
  const CHUNK = 30;
  const avisoIds = avisosSnap.docs.map((d) => d.id);
  const planDocs: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (let i = 0; i < avisoIds.length; i += CHUNK) {
    const chunk = avisoIds.slice(i, i + CHUNK);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.plan_mantenimiento).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (s.exists) planDocs.push({ id: s.id, data: s.data() as Record<string, unknown> });
    }
  }
  console.log(`\n=== Planes PT01: ${planDocs.length}/${avisosSnap.size} ===`);
  for (const p of planDocs) {
    const d = p.data;
    const pend = d.incluido_en_ot_pendiente;
    const enPool =
      d.activo !== false &&
      (pend == null || String(pend).trim() === "") &&
      String(d.asset_id ?? "").trim() !== "";
    console.log(
      `  ${p.id} | centro=${d.centro} | activo=${d.activo} | asset=${String(d.asset_id ?? "(vacío)").slice(0, 18)} | pend=${pend ?? "null"} | enPool=${enPool}`,
    );
  }

  const enPool = planDocs.filter((p) => {
    const d = p.data;
    const pend = d.incluido_en_ot_pendiente;
    return d.activo !== false && (pend == null || String(pend).trim() === "") && String(d.asset_id ?? "").trim() !== "";
  });
  console.log(`\nPool elegible (activo + sin OT pendiente + con asset_id): ${enPool.length}/${planDocs.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
