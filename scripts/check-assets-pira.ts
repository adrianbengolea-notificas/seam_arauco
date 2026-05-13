/* eslint-disable no-console */
import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { ASSETS_COLLECTION } from "@/lib/firestore/collections";

async function main() {
  const db = getAdminDb();
  const snap = await db.collection(ASSETS_COLLECTION).get();
  const piray = snap.docs.filter((d) => {
    const ut = String(d.data().ubicacion_tecnica ?? "");
    return ut.toUpperCase().startsWith("PIRA") || ut.toUpperCase().startsWith("PIR-");
  });
  console.log(`Total activos en catálogo: ${snap.size}`);
  console.log(`Activos con UT PIRA*: ${piray.length}`);
  for (const d of piray.slice(0, 20)) {
    const data = d.data() as Record<string, unknown>;
    console.log(`  ${d.id} | ut=${data.ubicacion_tecnica} | codigo=${data.codigo_nuevo} | desc=${String(data.descripcion ?? "").slice(0, 40)}`);
  }

  if (piray.length === 0) {
    console.log("\n→ No hay activos para Piray en el catálogo.");
    console.log("  Esto hace que los avisos PT01 se salten al importar (sin asset_id no se guardan).");
    console.log("  Solución: importar el Excel de activos de Piray o crear activos sintéticos.");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
