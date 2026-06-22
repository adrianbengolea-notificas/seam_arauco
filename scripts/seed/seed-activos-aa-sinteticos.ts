/**
 * Crea (o actualiza) un activo sintético de Aire General por cada centro conocido.
 * El ID de documento es determinista: `aa-gral-{centro_en_minúsculas}` (ej. `aa-gral-pc01`).
 * El import de avisos usa ese mismo ID como fallback para filas AA sin UT en catálogo.
 *
 *   npm run seed:aa-sintetico
 */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import {
  CODIGO_AA_GRAL,
  syntheticAaAssetId,
} from "@/lib/assets/synthetic-gral-asset";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { ASSETS_COLLECTION } from "@/lib/firestore/collections";
import { FieldValue } from "firebase-admin/firestore";

const CENTROS = ["PC01", "PF01", "PM02", "PT01"];

async function main() {
  const db = getAdminDb();
  const col = db.collection(ASSETS_COLLECTION);

  for (const centro of CENTROS) {
    const id = syntheticAaAssetId(centro);
    const ref = col.doc(id);
    const snap = await ref.get();

    const data: Record<string, unknown> = {
      codigo_nuevo: CODIGO_AA_GRAL,
      denominacion: "Aire General",
      ubicacion_tecnica: `${CODIGO_AA_GRAL}-${centro}`,
      centro,
      especialidad_predeterminada: "AA",
      activo_operativo: true,
      updated_at: FieldValue.serverTimestamp(),
    };
    if (!snap.exists) {
      data.created_at = FieldValue.serverTimestamp();
    }

    await ref.set(data, { merge: true });
    console.log(`${snap.exists ? "actualizado" : "creado  "} assets/${id}  (centro ${centro})`);
  }
  console.log("\nListo:", CENTROS.length, "activos sintéticos AA.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
