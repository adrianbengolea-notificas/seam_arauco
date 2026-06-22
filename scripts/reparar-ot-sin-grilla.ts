/**
 * Repara OTs con `OT_SIN_GRILLA`: publica chip en `programa_semanal`.
 *
 * Uso:
 *   npx tsx scripts/reparar-ot-sin-grilla.ts --centro PM02
 *   npx tsx scripts/reparar-ot-sin-grilla.ts --wo AXLubv0rZxDBQFxy2kMD --commit
 *   npx tsx scripts/reparar-ot-sin-grilla.ts --centro PM02 --commit --limit 50
 */
/* eslint-disable no-console */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { numeroChipProgramaDesdeWorkOrder, programarWorkOrderManualCompleto } from "@/modules/scheduling/service";
import type { ProgramaSemana, SlotSemanal } from "@/modules/scheduling/types";

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.replace(/^\s*export\s+/, "").trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

function parseArgs(): { centro?: string; woId?: string; commit: boolean; limit: number } {
  const argv = process.argv.slice(2);
  let centro: string | undefined;
  let woId: string | undefined;
  let commit = false;
  let limit = 100;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--commit") commit = true;
    else if (a === "--centro" && argv[i + 1]) centro = argv[++i]!.trim();
    else if (a === "--wo" && argv[i + 1]) woId = argv[++i]!.trim();
    else if (a === "--limit" && argv[i + 1]) limit = Math.max(1, parseInt(argv[++i]!, 10) || 100);
  }
  return { centro, woId, commit, limit };
}

function chipEnPrograma(
  slots: SlotSemanal[] | undefined,
  wo: { id: string; n_ot: string; aviso_numero: string },
): boolean {
  const nums = new Set<string>();
  const chip = numeroChipProgramaDesdeWorkOrder({
    id: wo.id,
    n_ot: wo.n_ot,
    aviso_numero: wo.aviso_numero,
  });
  nums.add(chip);
  const av = (wo.aviso_numero ?? wo.n_ot ?? "").trim();
  if (av) nums.add(av);
  if (av) nums.add(`OT-${av}`);
  for (const s of slots ?? []) {
    for (const a of s.avisos ?? []) {
      if (a.workOrderId?.trim() === wo.id.trim()) return true;
      if (nums.has(String(a.numero ?? "").trim())) return true;
    }
  }
  return false;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { centro, woId, commit, limit } = parseArgs();
  const db = getAdminDb();

  const candidatos: Array<{ id: string; data: FirebaseFirestore.DocumentData }> = [];

  if (woId) {
    const snap = await db.collection(COLLECTIONS.work_orders).doc(woId).get();
    if (snap.exists) candidatos.push({ id: snap.id, data: snap.data()! });
  } else {
    let q = db.collection(COLLECTIONS.work_orders) as FirebaseFirestore.Query;
    if (centro) q = q.where("centro", "==", centro);
    const snap = await q.limit(limit * 3).get();
    for (const d of snap.docs) {
      const st = String(d.data().estado ?? "");
      if (st === "ANULADA" || st === "CERRADA" || d.data().archivada === true) continue;
      candidatos.push({ id: d.id, data: d.data() });
      if (candidatos.length >= limit) break;
    }
  }

  console.log(`\nRevisando ${candidatos.length} OT(s)… commit=${commit}\n`);

  const progCache = new Map<string, ProgramaSemana | null>();
  async function slotsCentro(c: string): Promise<SlotSemanal[]> {
    if (progCache.has(c)) {
      const all = progCache.get(c);
      return all?.slots ?? [];
    }
    const snap = await db.collection(COLLECTIONS.programa_semanal).where("centro", "==", c).limit(30).get();
    const merged: SlotSemanal[] = [];
    for (const d of snap.docs) {
      const p = d.data() as ProgramaSemana;
      merged.push(...(p.slots ?? []));
    }
    progCache.set(c, { slots: merged } as ProgramaSemana);
    return merged;
  }

  let sinGrilla = 0;
  let reparadas = 0;
  let errores = 0;

  for (const { id, data } of candidatos) {
    const c = String(data.centro ?? "").trim();
    if (!c) continue;
    const wo = {
      id,
      n_ot: String(data.n_ot ?? ""),
      aviso_numero: String(data.aviso_numero ?? ""),
    };
    const slots = await slotsCentro(c);
    if (chipEnPrograma(slots, wo)) continue;
    sinGrilla++;
    const label = `${wo.n_ot || id} (${c})`;
    if (!commit) {
      console.log(`  [dry-run] OT_SIN_GRILLA: ${label}`);
      continue;
    }
    try {
      const r = await programarWorkOrderManualCompleto(id);
      reparadas++;
      console.log(`  ✓ ${label} → semana ${r.weekId}${r.soloProgramaPublicado ? " (solo programa publicado)" : ""}`);
    } catch (e) {
      errores++;
      console.error(`  ✗ ${label}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`\nResumen: ${sinGrilla} sin grilla | ${reparadas} reparadas | ${errores} errores`);
  if (!commit && sinGrilla > 0) {
    console.log("Ejecutá con --commit para publicar en programa_semanal.\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
