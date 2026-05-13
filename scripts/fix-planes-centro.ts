/* eslint-disable no-console */
/**
 * Corrige 95 planes de plan_mantenimiento que tienen centro: "PC01" pero
 * pertenecen a PF01 (ubicacion_tecnica BOSS/GARI/YPOR y aviso en PF01).
 *
 * Modo seguro: primero muestra qué va a cambiar, luego aplica con --apply.
 */
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { FieldValue } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");

async function main() {
  const db = getAdminDb();

  const [avisosPC01, planesPC01, avisosPF01] = await Promise.all([
    db.collection(COLLECTIONS.avisos).where("centro", "==", "PC01").get(),
    db.collection(COLLECTIONS.plan_mantenimiento).where("centro", "==", "PC01").get(),
    db.collection(COLLECTIONS.avisos).where("centro", "==", "PF01").get(),
  ]);

  const avisosPC01Ids = new Set(avisosPC01.docs.map((d) => d.id));
  const avisosPF01Ids = new Set(avisosPF01.docs.map((d) => d.id));

  // Huérfanos = plan en PC01 cuyo ID no existe como aviso en PC01, pero sí en PF01
  const aCorregir = planesPC01.docs.filter(
    (d) => !avisosPC01Ids.has(d.id) && avisosPF01Ids.has(d.id),
  );

  console.log(`Planes a corregir (PC01 → PF01): ${aCorregir.length}`);

  if (!APPLY) {
    console.log("\nModo DRY-RUN — no se modifica nada.");
    console.log("Primeros 5:");
    for (const d of aCorregir.slice(0, 5)) {
      const data = d.data() as { descripcion?: string; ubicacion_tecnica?: string };
      console.log(`  ${d.id} | ${data.descripcion} | ${data.ubicacion_tecnica}`);
    }
    console.log("\nPara aplicar: npx tsx --env-file=.env.local scripts/fix-planes-centro.ts --apply");
    return;
  }

  // Aplicar en lotes de 400
  let n = 0;
  let batch = db.batch();
  for (const d of aCorregir) {
    batch.update(d.ref, { centro: "PF01", updated_at: FieldValue.serverTimestamp() });
    n++;
    if (n % 400 === 0) {
      await batch.commit();
      batch = db.batch();
      console.log(`  Commiteado lote hasta doc ${n}`);
    }
  }
  if (n % 400 !== 0) await batch.commit();

  console.log(`\n✓ Corregidos ${n} planes: centro PC01 → PF01`);
}

void main().catch(console.error);
