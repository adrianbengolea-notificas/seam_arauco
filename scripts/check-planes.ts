/* eslint-disable no-console */
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";

async function main() {
const db = getAdminDb();

for (const centro of ["PC01", "PF01", "PM02", "PT01"]) {
  const [planesSnap, avisosSnap] = await Promise.all([
    db.collection(COLLECTIONS.plan_mantenimiento).where("centro", "==", centro).get(),
    db.collection(COLLECTIONS.avisos).where("centro", "==", centro).get(),
  ]);

  const byAviso: Record<string, string[]> = {};
  for (const d of planesSnap.docs) {
    const n = String(d.data().n_aviso ?? "(sin n_aviso)");
    byAviso[n] = [...(byAviso[n] ?? []), d.id];
  }

  const avisosIds = new Set(avisosSnap.docs.map((d) => d.id));
  const planesHuerfanos = planesSnap.docs.filter((d) => !avisosIds.has(d.id));
  const duplicados = Object.entries(byAviso).filter(([, ids]) => ids.length > 1);

  console.log(`\n=== ${centro} ===`);
  console.log(`  Avisos:           ${avisosSnap.size}`);
  console.log(`  Planes total:     ${planesSnap.size}`);
  console.log(`  Planes huérfanos: ${planesHuerfanos.length}  (plan sin aviso correspondiente)`);
  console.log(`  n_aviso duplicado: ${duplicados.length}`);
  if (duplicados.length) console.log("  Ejemplos dup:", duplicados.slice(0, 3));
}
}

void main().catch(console.error);
