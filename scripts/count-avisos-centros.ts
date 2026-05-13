/* eslint-disable no-console */
import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";

async function main() {
  const db = getAdminDb();
  for (const c of ["PC01", "PF01", "PM02", "PT01"]) {
    const snap = await db.collection(COLLECTIONS.avisos).where("centro", "==", c).get();
    const tipos = new Map<string, number>();
    for (const d of snap.docs) {
      const t = String(d.data().tipo ?? "?");
      tipos.set(t, (tipos.get(t) ?? 0) + 1);
    }
    const resumen = [...tipos.entries()].map(([k, v]) => `${k}:${v}`).join(", ");
    console.log(`${c}: ${snap.size} avisos (${resumen || "vacío"})`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
