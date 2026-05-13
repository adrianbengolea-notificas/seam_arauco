/* eslint-disable no-console */
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";

async function main() {
  const db = getAdminDb();

  const [avisosPC01, planesPC01, avisosPF01] = await Promise.all([
    db.collection(COLLECTIONS.avisos).where("centro", "==", "PC01").get(),
    db.collection(COLLECTIONS.plan_mantenimiento).where("centro", "==", "PC01").get(),
    db.collection(COLLECTIONS.avisos).where("centro", "==", "PF01").get(),
  ]);

  const avisosPC01Ids = new Set(avisosPC01.docs.map((d) => d.id));
  const avisosPF01Ids = new Set(avisosPF01.docs.map((d) => d.id));

  const huerfanos = planesPC01.docs.filter((d) => !avisosPC01Ids.has(d.id));

  // Agrupar huérfanos por prefijo de ubicacion_tecnica
  const porPrefijo: Record<string, number> = {};
  let tienenAvisoEnPF01 = 0;

  for (const d of huerfanos) {
    const data = d.data() as { ubicacion_tecnica?: string };
    const prefijo = data.ubicacion_tecnica?.split("-")[0] ?? "(sin prefijo)";
    porPrefijo[prefijo] = (porPrefijo[prefijo] ?? 0) + 1;
    if (avisosPF01Ids.has(d.id)) tienenAvisoEnPF01++;
  }

  console.log(`\nPlanes huérfanos de PC01: ${huerfanos.length}`);
  console.log("Prefijos de ubicación técnica:");
  for (const [p, n] of Object.entries(porPrefijo).sort()) {
    console.log(`  ${p}: ${n} planes`);
  }
  console.log(`\nDe esos huérfanos, ¿cuántos tienen aviso en PF01?: ${tienenAvisoEnPF01}`);
  console.log(`Avisos en PF01: ${avisosPF01.size}`);
}

void main().catch(console.error);
