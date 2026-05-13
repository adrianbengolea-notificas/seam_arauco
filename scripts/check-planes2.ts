/* eslint-disable no-console */
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";

async function main() {
  const db = getAdminDb();
  const avisosSnap = await db.collection(COLLECTIONS.avisos).where("centro", "==", "PC01").get();
  const avisosIds = new Set(avisosSnap.docs.map((d) => d.id));

  const planesSnap = await db.collection(COLLECTIONS.plan_mantenimiento).where("centro", "==", "PC01").get();
  const huerfanos = planesSnap.docs.filter((d) => !avisosIds.has(d.id));
  const activos = planesSnap.docs.filter((d) => avisosIds.has(d.id));

  console.log("Ejemplo plan HUÉRFANO (id no está en avisos):");
  const h = huerfanos[0];
  if (h) console.log({ id: h.id, ...h.data() });

  console.log("\nEjemplo plan ACTIVO (id está en avisos):");
  const a = activos[0];
  if (a) console.log({ id: a.id, ...a.data() });
}

void main().catch(console.error);
