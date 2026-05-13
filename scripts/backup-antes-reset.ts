/* eslint-disable no-console */
/**
 * Exporta a JSON local las colecciones que se van a borrar en el reset.
 * Incluye subcolecciones de work_orders.
 *
 * Uso:  npx tsx scripts/backup-antes-reset.ts
 * Output: scripts/backup/ (carpeta creada automáticamente)
 */
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS, WORK_ORDER_SUB } from "@/lib/firestore/collections";
import * as fs from "fs";
import * as path from "path";

const BACKUP_DIR = path.join(process.cwd(), "scripts", "backup");

function escribirJson(nombre: string, data: unknown) {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const archivo = path.join(BACKUP_DIR, `${nombre}.json`);
  fs.writeFileSync(archivo, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  ✓ ${nombre}.json — ${Array.isArray(data) ? data.length : "?"} docs`);
}

async function exportarColeccion(db: FirebaseFirestore.Firestore, coleccion: string) {
  const snap = await db.collection(coleccion).get();
  return snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
}

async function exportarWorkOrdersConSubs(db: FirebaseFirestore.Firestore) {
  const snap = await db.collection(COLLECTIONS.work_orders).get();
  const docs = [];

  for (const doc of snap.docs) {
    const base = { _id: doc.id, ...doc.data() } as Record<string, unknown>;

    // Exportar subcolecciones
    for (const sub of Object.values(WORK_ORDER_SUB)) {
      const subSnap = await doc.ref.collection(sub).get();
      if (!subSnap.empty) {
        base[`_sub_${sub}`] = subSnap.docs.map((s) => ({ _id: s.id, ...s.data() }));
      }
    }

    docs.push(base);
  }

  return docs;
}

async function main() {
  const db = getAdminDb();

  console.log("\n=== BACKUP antes del reset ===\n");
  console.log(`Destino: ${BACKUP_DIR}\n`);

  // work_orders con todas sus subcolecciones
  console.log("Exportando work_orders (con subcolecciones)...");
  const wos = await exportarWorkOrdersConSubs(db);
  escribirJson("work_orders", wos);

  // propuestas_semana
  console.log("Exportando propuestas_semana...");
  const propuestas = await exportarColeccion(db, COLLECTIONS.propuestas_semana);
  escribirJson("propuestas_semana", propuestas);

  // programa_semanal con subcolecciones aprendizaje e historial_eventos
  console.log("Exportando programa_semanal...");
  const psSnap = await db.collection(COLLECTIONS.programa_semanal).get();
  const programas = [];
  for (const doc of psSnap.docs) {
    const base = { _id: doc.id, ...doc.data() } as Record<string, unknown>;
    for (const sub of ["aprendizaje", "historial_eventos"]) {
      const subSnap = await doc.ref.collection(sub).get();
      if (!subSnap.empty) {
        base[`_sub_${sub}`] = subSnap.docs.map((s) => ({ _id: s.id, ...s.data() }));
      }
    }
    programas.push(base);
  }
  escribirJson("programa_semanal", programas);

  // weekly_schedule con subcolecciones
  console.log("Exportando weekly_schedule...");
  const wsSnap = await db.collection(COLLECTIONS.weekly_schedule).get();
  const schedules = [];
  for (const doc of wsSnap.docs) {
    const base = { _id: doc.id, ...doc.data() } as Record<string, unknown>;
    for (const sub of ["slots", "plan_rows"]) {
      const subSnap = await doc.ref.collection(sub).get();
      if (!subSnap.empty) {
        base[`_sub_${sub}`] = subSnap.docs.map((s) => ({ _id: s.id, ...s.data() }));
      }
    }
    schedules.push(base);
  }
  escribirJson("weekly_schedule", schedules);

  // motor_ot_diario_runs
  console.log("Exportando motor_ot_diario_runs...");
  const runs = await exportarColeccion(db, COLLECTIONS.motor_ot_diario_runs);
  escribirJson("motor_ot_diario_runs", runs);

  // incluido_en_ot_pendiente en plan_mantenimiento (solo ese campo, para restaurar si hace falta)
  console.log("Exportando snapshot de plan_mantenimiento (campos incluido_en_ot_pendiente)...");
  const planesSnap = await db.collection(COLLECTIONS.plan_mantenimiento).get();
  const planesSnapshot = planesSnap.docs
    .filter((d) => d.data().incluido_en_ot_pendiente)
    .map((d) => ({ _id: d.id, incluido_en_ot_pendiente: d.data().incluido_en_ot_pendiente }));
  escribirJson("plan_mantenimiento_ot_pendiente_snapshot", planesSnapshot);

  console.log("\n=== BACKUP COMPLETO ===");
  console.log(`Archivos en: ${BACKUP_DIR}`);
  console.log("\nRevisá los archivos antes de correr el script de reset.\n");
}

void main().catch((e) => {
  console.error("ERROR en backup:", e);
  process.exit(1);
});
