/**
 * Detecta avisos duplicados en Firestore (mismo centro + mismo número SAP normalizado)
 * y opcionalmente borra los documentos sobrantes + `plan_mantenimiento/{mismoId}` asociados.
 *
 * Criterio de “ganador” (documento que se conserva):
 * 1. Si solo uno del grupo tiene `work_order_id`, ese.
 * 2. Si varios tienen órdenes distintas → no borra (revisión manual).
 * 3. Si ninguno tiene OT → ID = `preferredNumericAvisoId(n_aviso)` si existe en el grupo;
 *    si no, el primero según `candidateAvisoDocIds`; si no, el id lexicográfico menor.
 *
 * Por defecto solo lista (simulación). Requiere `--apply` para borrar.
 *
 * Uso:
 *   npx tsx scripts/cleanup-duplicados-avisos.ts
 *   npx tsx scripts/cleanup-duplicados-avisos.ts --centro PC01
 *   npx tsx scripts/cleanup-duplicados-avisos.ts --limit 80000
 *   npx tsx scripts/cleanup-duplicados-avisos.ts --apply --centro PT01
 *
 * Entorno: `.env.local` + credenciales Admin (como otros scripts en `scripts/`).
 *
 * Nota: si el programa semanal publicado guarda `avisoFirestoreId` del doc borrado,
 * conviene republicar o corregir esa celda; el script no toca `programa_semanal`.
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  candidateAvisoDocIds,
  normalizeNAvisoCompare,
  preferredNumericAvisoId,
} from "@/lib/import/aviso-numero-canonical";

type Row = { id: string; data: Record<string, unknown> };

const MAX_BATCH_OPS = 500;

function parseArgs() {
  const argv = process.argv.slice(2);
  let apply = false;
  let centro = "";
  let limit = 100_000;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--apply") apply = true;
    if (a === "--centro" || a === "-c") centro = (argv[++i] ?? "").trim();
    if (a === "--limit" || a === "-l") limit = Math.max(1, parseInt(argv[++i] ?? "100000", 10) || 100_000);
  }
  return { apply, centro, limit };
}

function woId(d: Record<string, unknown>): string {
  return String(d.work_order_id ?? "").trim();
}

function tipoAviso(d: Record<string, unknown>): string {
  return String(d.tipo ?? "").trim();
}

function pickWinner(
  group: Row[],
  nAvisoEjemplo: string,
): { winner: Row; losers: Row[] } | { skip: string } {
  const tipos = new Set(group.map((g) => tipoAviso(g.data)));
  tipos.delete("");
  if (tipos.size > 1) {
    return { skip: `tipos distintos en el grupo: ${[...tipos].join(", ")}` };
  }

  const withWo = group.filter((g) => woId(g.data));
  if (withWo.length > 1) {
    const otIds = new Set(withWo.map((g) => woId(g.data)));
    if (otIds.size > 1) {
      return { skip: `varias OTs distintas: ${[...otIds].join(", ")}` };
    }
  }

  let winner: Row;
  if (withWo.length === 1) {
    winner = withWo[0]!;
  } else {
    const pref = preferredNumericAvisoId(nAvisoEjemplo);
    const byPref = pref ? group.find((g) => g.id === pref) : undefined;
    if (byPref) {
      winner = byPref;
    } else {
      const order = candidateAvisoDocIds(nAvisoEjemplo);
      const byOrder = order.map((id) => group.find((g) => g.id === id)).find(Boolean);
      winner = byOrder ?? group.slice().sort((a, b) => a.id.localeCompare(b.id))[0]!;
    }
  }

  const losers = group.filter((g) => g.id !== winner.id);
  return { winner, losers };
}

async function main() {
  const { apply, centro, limit } = parseArgs();
  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.avisos);
  const planCol = db.collection(COLLECTIONS.plan_mantenimiento);

  const base = centro ? col.where("centro", "==", centro) : col;
  const snap = await base.limit(limit).get();
  console.log(`Documentos leídos: ${snap.size}${centro ? ` (centro=${centro})` : ""}`);

  const logicalKeyToRows = new Map<string, Row[]>();
  for (const d of snap.docs) {
    const data = d.data();
    const na = String(data.n_aviso ?? "").trim();
    const c = String(data.centro ?? "").trim();
    if (!na || !c) continue;
    const key = `${c}\u0000${normalizeNAvisoCompare(na)}`;
    const row: Row = { id: d.id, data };
    if (!logicalKeyToRows.has(key)) logicalKeyToRows.set(key, []);
    logicalKeyToRows.get(key)!.push(row);
  }

  const duplicates = [...logicalKeyToRows.entries()].filter(([, rows]) => rows.length > 1);
  console.log(`Grupos con más de un documento (mismo centro + n_aviso normalizado): ${duplicates.length}`);

  const toDeleteAviso: string[] = [];
  const skipped: string[] = [];

  for (const [key, rows] of duplicates) {
    const nEjemplo = String(rows[0]!.data.n_aviso ?? "").trim();
    const [c] = key.split("\u0000");
    const res = pickWinner(rows, nEjemplo);
    if ("skip" in res) {
      skipped.push(
        `centro=${c} n≈${nEjemplo} ids=${rows.map((r) => r.id).join(", ")} → ${res.skip}`,
      );
      continue;
    }
    const { winner, losers } = res;
    console.log(
      `[MANTENER] centro=${c} n_aviso=${nEjemplo} id=${winner.id}` +
        (woId(winner.data) ? ` work_order=${woId(winner.data)}` : ""),
    );
    for (const l of losers) {
      console.log(`  [BORRAR${apply ? "" : " (simulación)"}] aviso id=${l.id} plan_mantenimiento/${l.id}`);
      toDeleteAviso.push(l.id);
    }
  }

  if (skipped.length) {
    console.log("\n--- Omitidos (revisión manual) ---");
    for (const s of skipped) console.log(s);
  }

  if (!apply) {
    console.log(
      `\nModo simulación: no se borró nada. Duplicados a eliminar: ${toDeleteAviso.length}.` +
        ` Ejecutá de nuevo con --apply para persistir.`,
    );
    return;
  }

  if (!toDeleteAviso.length) {
    console.log("Nada que borrar.");
    return;
  }

  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const id of toDeleteAviso) {
    batch.delete(planCol.doc(id));
    batch.delete(col.doc(id));
    ops += 2;
    if (ops >= MAX_BATCH_OPS) await flush();
  }
  await flush();
  console.log(`Listo: eliminados ${toDeleteAviso.length} avisos duplicados y sus planes homónimos.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
