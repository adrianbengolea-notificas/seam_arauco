/* eslint-disable no-console */
/**
 * Muestra las OTs vinculadas a los planes de PM02 (campo incluido_en_ot_pendiente).
 * Determina si están abiertas (legítimas) o son huérfanas/stale (candidatas a limpiar).
 *
 * Uso: npx tsx --env-file=.env.local scripts/diagnostico-ots-pm02.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });

import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";

async function main() {
  const db = getAdminDb();

  const avisosSnap = await db.collection(COLLECTIONS.avisos).where("centro", "==", "PM02").get();
  const avisoIds = avisosSnap.docs.map((d) => d.id);

  // Leer los planes para obtener los IDs de OT
  const CHUNK = 30;
  const otIds: string[] = [];
  const planPorOtId = new Map<string, string>(); // otId → planId

  for (let i = 0; i < avisoIds.length; i += CHUNK) {
    const chunk = avisoIds.slice(i, i + CHUNK);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.plan_mantenimiento).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const pend = String(s.data()?.incluido_en_ot_pendiente ?? "").trim();
      if (pend) {
        otIds.push(pend);
        planPorOtId.set(pend, s.id);
      }
    }
  }

  console.log(`\nOTs referenciadas en planes PM02: ${otIds.length}`);

  // Buscar esas órdenes en work_orders
  const encontradas: Array<{ id: string; planId: string; estado: string; centro: string; sub_tipo: string; titulo: string }> = [];
  const noEncontradas: Array<{ otId: string; planId: string }> = [];

  for (let i = 0; i < otIds.length; i += CHUNK) {
    const chunk = otIds.slice(i, i + CHUNK);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.work_orders).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      const planId = planPorOtId.get(s.id) ?? "?";
      if (!s.exists) {
        noEncontradas.push({ otId: s.id, planId });
      } else {
        const d = s.data() as Record<string, unknown>;
        encontradas.push({
          id: s.id,
          planId,
          estado: String(d.estado ?? "?"),
          centro: String(d.centro ?? "?"),
          sub_tipo: String(d.sub_tipo ?? "?"),
          titulo: String(d.titulo ?? d.descripcion ?? "?").slice(0, 50),
        });
      }
    }
  }

  // Clasificar
  const abiertas = encontradas.filter((o) => o.estado === "ABIERTA" || o.estado === "EN_EJECUCION");
  const cerradas = encontradas.filter((o) => o.estado === "CERRADA" || o.estado === "ANULADA");

  console.log(`\n=== ÓRDENES DE SERVICIO ENCONTRADAS: ${encontradas.length} ===`);
  for (const o of encontradas) {
    console.log(`  plan=${o.planId} | ot=${o.id} | estado=${o.estado} | centro_ot=${o.centro} | "${o.titulo}"`);
  }

  console.log(`\n=== ÓRDENES DE SERVICIO NO ENCONTRADAS (huérfanas): ${noEncontradas.length} ===`);
  for (const o of noEncontradas) {
    console.log(`  plan=${o.planId} | ot=${o.otId}`);
  }

  console.log(`\n=== RESUMEN ===`);
  console.log(`  Abiertas/En ejecución (bloquean el motor legítimamente): ${abiertas.length}`);
  console.log(`  Cerradas/Anuladas (incluido_en_ot_pendiente debería limpiarse):  ${cerradas.length}`);
  console.log(`  Huérfanas (OT no existe — incluido_en_ot_pendiente stale): ${noEncontradas.length}`);

  const aLimpiar = [...cerradas, ...noEncontradas];
  if (aLimpiar.length > 0) {
    console.log(`\n⚠ ${aLimpiar.length} planes tienen incluido_en_ot_pendiente stale (OT cerrada o inexistente).`);
    console.log("  Para limpiarlos y liberar el pool del motor, ejecutá:");
    console.log("  npx tsx --env-file=.env.local scripts/limpiar-planes-pendiente-pm02.ts --commit");
  }
  if (abiertas.length > 0) {
    console.log(`\nℹ ${abiertas.length} planes tienen OTs abiertas reales — el motor los omite correctamente.`);
    if (abiertas.some((o) => o.centro !== "PM02")) {
      console.log("  ⚠ Algunas OTs abiertas tienen centro distinto a PM02 (fueron creadas antes de la corrección):");
      for (const o of abiertas.filter((x) => x.centro !== "PM02")) {
        console.log(`    ot=${o.id} centro=${o.centro} estado=${o.estado}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
