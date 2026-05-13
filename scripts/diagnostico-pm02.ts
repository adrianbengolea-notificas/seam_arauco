/* eslint-disable no-console */
/**
 * Diagnóstico rápido PM02:
 * - Estado de los 20 avisos
 * - Estado de los planes correspondientes (pueden estar bajo PF01)
 * - Pool motor simulado (los mismos filtros que buildPropuestaGreedyMotor)
 *
 * Uso: npx tsx --env-file=.env.local scripts/diagnostico-pm02.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });

import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";

async function main() {
  const db = getAdminDb();

  // 1. Avisos PM02
  const avisosSnap = await db.collection(COLLECTIONS.avisos).where("centro", "==", "PM02").get();
  console.log(`\n=== Avisos PM02: ${avisosSnap.size} ===`);
  const avisoIds = avisosSnap.docs.map((d) => d.id);
  for (const d of avisosSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    console.log(
      `  ${d.id} | n_aviso=${data.n_aviso} | tipo=${data.tipo} | frecuencia=${data.frecuencia} | estado=${data.estado} | asset_id=${String(data.asset_id ?? "").slice(0, 20)} | ut=${String(data.ubicacion_tecnica ?? "").slice(0, 20)}`,
    );
  }

  // 2. Planes para esos IDs (en cualquier centro)
  const CHUNK = 30;
  const planDocs: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (let i = 0; i < avisoIds.length; i += CHUNK) {
    const chunk = avisoIds.slice(i, i + CHUNK);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.plan_mantenimiento).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (s.exists) planDocs.push({ id: s.id, data: s.data() as Record<string, unknown> });
    }
  }
  console.log(`\n=== Planes encontrados para esos IDs (en cualquier centro): ${planDocs.length} ===`);
  for (const p of planDocs) {
    const d = p.data;
    const pend = d.incluido_en_ot_pendiente;
    const enPool =
      d.activo !== false &&
      (pend == null || String(pend).trim() === "") &&
      String(d.asset_id ?? "").trim() !== "";
    console.log(
      `  ${p.id} | centro=${d.centro} | activo=${d.activo} | asset_id=${String(d.asset_id ?? "").slice(0, 18)} | pend=${pend ?? "null"} | enPool=${enPool}`,
    );
  }

  const enPool = planDocs.filter((p) => {
    const d = p.data;
    const pend = d.incluido_en_ot_pendiente;
    return (
      d.activo !== false &&
      (pend == null || String(pend).trim() === "") &&
      String(d.asset_id ?? "").trim() !== ""
    );
  });
  console.log(`\nPool elegible (activo, sin OT pendiente, con asset_id): ${enPool.length}/${planDocs.length}`);

  if (planDocs.length === 0) {
    console.log("\n⚠ No existe ningún plan_mantenimiento para los IDs de los avisos PM02.");
    console.log(
      "  Esto confirma que ensurePlansForCentro no creó planes aún. Reiniciá el servidor y regenerá.",
    );
  } else if (planDocs.some((p) => p.data.centro !== "PM02")) {
    console.log("\n⚠ Hay planes con centro distinto a PM02 (el fix aún no corrió):");
    for (const p of planDocs.filter((p) => p.data.centro !== "PM02")) {
      console.log(`  ${p.id} → centro=${p.data.centro}`);
    }
  } else {
    console.log("\n✓ Todos los planes ya tienen centro=PM02.");
    if (enPool.length === 0) {
      console.log("⚠ Pero ninguno pasa el filtro del motor (activo/asset_id/OT pendiente). Revisá arriba.");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
