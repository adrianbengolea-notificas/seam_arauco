/* eslint-disable no-console */
/**
 * Borra todas las OTs y datos de programación.
 * CONSERVA: plan_mantenimiento, avisos, activos, centros, usuarios.
 *
 * REQUISITO: correr backup-antes-reset.ts primero.
 *
 * Uso:  npx tsx scripts/reset-a-cero.ts
 *
 * Pide confirmación por consola antes de borrar.
 */
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS, WORK_ORDER_SUB } from "@/lib/firestore/collections";
import * as readline from "readline";

async function confirmar(pregunta: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(pregunta, (resp) => {
      rl.close();
      resolve(resp.trim().toLowerCase() === "si");
    });
  });
}

async function borrarColeccionEnLotes(
  db: FirebaseFirestore.Firestore,
  coleccion: string,
  lote = 400,
): Promise<number> {
  let total = 0;
  let snap = await db.collection(coleccion).limit(lote).get();

  while (!snap.empty) {
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    total += snap.size;
    process.stdout.write(`\r  Borrados: ${total}...`);
    if (snap.size < lote) break;
    snap = await db.collection(coleccion).limit(lote).get();
  }

  console.log(`\r  ✓ ${coleccion}: ${total} documentos eliminados`);
  return total;
}

async function borrarSubcoleccionesWorkOrders(db: FirebaseFirestore.Firestore) {
  const snap = await db.collection(COLLECTIONS.work_orders).get();
  let totalSubs = 0;

  for (const doc of snap.docs) {
    for (const sub of Object.values(WORK_ORDER_SUB)) {
      const subSnap = await doc.ref.collection(sub).limit(500).get();
      if (subSnap.empty) continue;
      const batch = db.batch();
      for (const s of subSnap.docs) batch.delete(s.ref);
      await batch.commit();
      totalSubs += subSnap.size;
    }
  }

  if (totalSubs > 0) console.log(`  ✓ Subcolecciones work_orders: ${totalSubs} docs eliminados`);
}

async function borrarSubcoleccionesProgramaSemanal(db: FirebaseFirestore.Firestore) {
  const snap = await db.collection(COLLECTIONS.programa_semanal).get();
  let totalSubs = 0;

  for (const doc of snap.docs) {
    for (const sub of ["aprendizaje", "historial_eventos"]) {
      const subSnap = await doc.ref.collection(sub).limit(500).get();
      if (subSnap.empty) continue;
      const batch = db.batch();
      for (const s of subSnap.docs) batch.delete(s.ref);
      await batch.commit();
      totalSubs += subSnap.size;
    }
  }

  if (totalSubs > 0)
    console.log(`  ✓ Subcolecciones programa_semanal: ${totalSubs} docs eliminados`);
}

async function borrarSubcoleccionesWeeklySchedule(db: FirebaseFirestore.Firestore) {
  const snap = await db.collection(COLLECTIONS.weekly_schedule).get();
  let totalSubs = 0;

  for (const doc of snap.docs) {
    for (const sub of ["slots", "plan_rows"]) {
      const subSnap = await doc.ref.collection(sub).limit(500).get();
      if (subSnap.empty) continue;
      const batch = db.batch();
      for (const s of subSnap.docs) batch.delete(s.ref);
      await batch.commit();
      totalSubs += subSnap.size;
    }
  }

  if (totalSubs > 0)
    console.log(`  ✓ Subcolecciones weekly_schedule: ${totalSubs} docs eliminados`);
}

async function limpiarIncluido_en_ot_pendiente(db: FirebaseFirestore.Firestore) {
  // Limpia el campo que marca los planes como "ya incluidos en una OT"
  // para que el motor pueda volver a proponerlos
  const { FieldValue } = await import("firebase-admin/firestore");
  const snap = await db
    .collection(COLLECTIONS.plan_mantenimiento)
    .where("incluido_en_ot_pendiente", "!=", null)
    .get();

  if (snap.empty) {
    console.log("  ✓ plan_mantenimiento: ningún plan tenía incluido_en_ot_pendiente");
    return;
  }

  let total = 0;
  const LOTE = 400;
  const docs = snap.docs;

  for (let i = 0; i < docs.length; i += LOTE) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + LOTE)) {
      batch.update(doc.ref, { incluido_en_ot_pendiente: FieldValue.delete() });
    }
    await batch.commit();
    total += Math.min(LOTE, docs.length - i);
  }

  console.log(`  ✓ plan_mantenimiento: ${total} planes liberados (incluido_en_ot_pendiente limpiado)`);
}

async function main() {
  const db = getAdminDb();

  console.log("\n=== RESET A CERO ===\n");
  console.log("Este script va a ELIMINAR permanentemente:");
  console.log("  • work_orders (+ subcolecciones: checklist, materiales, evidencias, historial, etc.)");
  console.log("  • propuestas_semana");
  console.log("  • programa_semanal (+ aprendizaje, historial_eventos)");
  console.log("  • weekly_schedule (+ slots, plan_rows)");
  console.log("  • motor_ot_diario_runs");
  console.log("  • campo incluido_en_ot_pendiente en plan_mantenimiento (liberar planes)\n");
  console.log("Se CONSERVA: plan_mantenimiento, avisos, activos, centros, usuarios.\n");

  // Contar documentos antes
  const [woCount, propCount, progCount, wsCount, runCount] = await Promise.all([
    db.collection(COLLECTIONS.work_orders).count().get(),
    db.collection(COLLECTIONS.propuestas_semana).count().get(),
    db.collection(COLLECTIONS.programa_semanal).count().get(),
    db.collection(COLLECTIONS.weekly_schedule).count().get(),
    db.collection(COLLECTIONS.motor_ot_diario_runs).count().get(),
  ]);

  console.log("Documentos encontrados:");
  console.log(`  work_orders:         ${woCount.data().count}`);
  console.log(`  propuestas_semana:   ${propCount.data().count}`);
  console.log(`  programa_semanal:    ${progCount.data().count}`);
  console.log(`  weekly_schedule:     ${wsCount.data().count}`);
  console.log(`  motor_ot_diario_runs: ${runCount.data().count}`);
  console.log();

  const ok = await confirmar('¿Confirmás el borrado? Escribí exactamente "si" y Enter: ');
  if (!ok) {
    console.log("\nOperación cancelada. No se borró nada.\n");
    process.exit(0);
  }

  console.log("\nBorrando...\n");

  // 1. Subcolecciones primero (Firestore no las borra automáticamente)
  console.log("Limpiando subcolecciones de work_orders...");
  await borrarSubcoleccionesWorkOrders(db);

  console.log("Limpiando subcolecciones de programa_semanal...");
  await borrarSubcoleccionesProgramaSemanal(db);

  console.log("Limpiando subcolecciones de weekly_schedule...");
  await borrarSubcoleccionesWeeklySchedule(db);

  // 2. Colecciones raíz
  await borrarColeccionEnLotes(db, COLLECTIONS.work_orders);
  await borrarColeccionEnLotes(db, COLLECTIONS.propuestas_semana);
  await borrarColeccionEnLotes(db, COLLECTIONS.programa_semanal);
  await borrarColeccionEnLotes(db, COLLECTIONS.weekly_schedule);
  await borrarColeccionEnLotes(db, COLLECTIONS.motor_ot_diario_runs);

  // 3. Limpiar campo en plan_mantenimiento
  await limpiarIncluido_en_ot_pendiente(db);

  console.log("\n=== RESET COMPLETO ===");
  console.log("La base quedó con avisos y planes SAP intactos, sin OTs.\n");
}

void main().catch((e) => {
  console.error("\nERROR:", e);
  process.exit(1);
});
