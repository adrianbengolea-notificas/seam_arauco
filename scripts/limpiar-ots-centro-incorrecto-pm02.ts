/* eslint-disable no-console */
/**
 * Limpia las OTs de planes PM02 que fueron creadas con centro incorrecto (PC01 o PF01).
 *
 * Por cada OT afectada (centro ≠ PM02):
 *  1. Anula la OT (estado → ANULADA)
 *  2. Limpia plan_mantenimiento.incluido_en_ot_pendiente → null
 *  3. Resetea aviso.estado → "ABIERTO" y aviso.work_order_id → null
 *
 * Las OTs con centro=PM02 se respetan (motor las omite correctamente).
 *
 * Por defecto: dry-run (solo muestra qué haría).
 * Para aplicar: --commit
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/limpiar-ots-centro-incorrecto-pm02.ts
 *   npx tsx --env-file=.env.local scripts/limpiar-ots-centro-incorrecto-pm02.ts --commit
 */
import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";

const COMMIT = process.argv.includes("--commit");
const CHUNK = 30;

async function main() {
  const db = getAdminDb();

  // 1. Obtener planes de PM02
  const avisosSnap = await db.collection(COLLECTIONS.avisos).where("centro", "==", "PM02").get();
  const avisoIds = avisosSnap.docs.map((d) => d.id);

  // 2. Leer los planes y capturar otIds
  type Entry = { planId: string; avisoId: string; otId: string };
  const entries: Entry[] = [];

  for (let i = 0; i < avisoIds.length; i += CHUNK) {
    const chunk = avisoIds.slice(i, i + CHUNK);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.plan_mantenimiento).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const pend = String(s.data()?.incluido_en_ot_pendiente ?? "").trim();
      if (pend) entries.push({ planId: s.id, avisoId: s.id, otId: pend });
    }
  }

  // 3. Leer las OTs para saber su centro
  const otIds = entries.map((e) => e.otId);
  const otCentro = new Map<string, string>();

  for (let i = 0; i < otIds.length; i += CHUNK) {
    const chunk = otIds.slice(i, i + CHUNK);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.work_orders).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const c = String(s.data()?.centro ?? "").trim();
      otCentro.set(s.id, c);
    }
  }

  // 4. Filtrar solo las OTs con centro ≠ PM02
  const aLimpiar = entries.filter((e) => {
    const c = otCentro.get(e.otId) ?? "";
    return c !== "PM02";
  });
  const aRespetar = entries.filter((e) => {
    const c = otCentro.get(e.otId) ?? "";
    return c === "PM02";
  });

  console.log(`\nPlanes PM02 con OT pendiente: ${entries.length}`);
  console.log(`  A limpiar (OT con centro ≠ PM02): ${aLimpiar.length}`);
  console.log(`  A respetar (OT con centro=PM02): ${aRespetar.length}`);

  console.log("\nDetalle de lo que se va a limpiar:");
  for (const e of aLimpiar) {
    const c = otCentro.get(e.otId) ?? "?";
    console.log(`  plan=${e.planId} | ot=${e.otId} | centro_ot=${c} → ANULAR + limpiar plan + resetear aviso`);
  }

  if (!COMMIT) {
    console.log("\nModo DRY-RUN — no se modificó nada.");
    console.log("Para aplicar: npx tsx --env-file=.env.local scripts/limpiar-ots-centro-incorrecto-pm02.ts --commit");
    return;
  }

  if (aLimpiar.length === 0) {
    console.log("\nNada que limpiar.");
    return;
  }

  const BATCH_MAX = 400;
  let n = 0;

  // Procesar en lotes de a 3 ops por entrada (OT + plan + aviso)
  let batch = db.batch();

  const flush = async (force = false) => {
    if (n > 0 && (n >= BATCH_MAX || force)) {
      await batch.commit();
      batch = db.batch();
      console.log(`  Commit lote (${n} ops)`);
      n = 0;
    }
  };

  for (const e of aLimpiar) {
    // 1. Anular OT
    batch.update(db.collection(COLLECTIONS.work_orders).doc(e.otId), {
      estado: "ANULADA",
      updated_at: FieldValue.serverTimestamp(),
    });
    n++;

    // 2. Limpiar plan
    batch.update(db.collection(COLLECTIONS.plan_mantenimiento).doc(e.planId), {
      incluido_en_ot_pendiente: null,
      updated_at: FieldValue.serverTimestamp(),
    });
    n++;

    // 3. Resetear aviso
    batch.update(db.collection(COLLECTIONS.avisos).doc(e.avisoId), {
      estado: "ABIERTO",
      work_order_id: null,
      updated_at: FieldValue.serverTimestamp(),
    });
    n++;

    await flush();
  }
  await flush(true);

  console.log(`\n✓ Limpieza completada: ${aLimpiar.length} OTs anuladas, planes y avisos reseteados.`);
  console.log("  Ahora podés hacer Regenerar en la UI para PM02 — el motor debería generar propuestas.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
