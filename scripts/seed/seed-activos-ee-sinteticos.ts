/**
 * Crea (o actualiza) un activo sintético de Eléctrico General por cada centro conocido.
 * El ID de documento es determinista: `ee-gral-{centro_en_minúsculas}` (ej. `ee-gral-pc01`).
 * El import de avisos usa ese mismo ID como fallback para filas ELECTRICO sin UT en catálogo.
 *
 *   npm run seed:ee-sintetico
 */

import { getAdminDb } from "@/firebase/firebaseAdmin";
import { ASSETS_COLLECTION } from "@/lib/firestore/collections";
import { FieldValue } from "firebase-admin/firestore";
import { syntheticEeAssetId } from "@/scripts/seed/synthetic-ee-asset-id";

const CENTROS = ["PC01", "PF01", "PM02", "PT01"];

async function main() {
  const db = getAdminDb();
  const col = db.collection(ASSETS_COLLECTION);

  for (const centro of CENTROS) {
    const id = syntheticEeAssetId(centro);
    const ref = col.doc(id);
    const snap = await ref.get();

    const data: Record<string, unknown> = {
      codigo_nuevo: "EE-GRAL",
      denominacion: "Eléctrico General",
      ubicacion_tecnica: `EE-GRAL-${centro}`,
      centro,
      especialidad_predeterminada: "ELECTRICO",
      activo_operativo: true,
      updated_at: FieldValue.serverTimestamp(),
    };
    if (!snap.exists) {
      data.created_at = FieldValue.serverTimestamp();
    }

    await ref.set(data, { merge: true });
    console.log(`${snap.exists ? "actualizado" : "creado  "} assets/${id}  (centro ${centro})`);
  }
  console.log("\nListo:", CENTROS.length, "activos sintéticos EE.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
