/**
 * Corrige duplicados en `programa_semanal` tras el bug de alta de OT:
 * chip fantasma `OT-{n_ot}` (u `OT-ID-…`) en una celda y aviso SAP en otra (o sin `workOrderId`).
 *
 * Por cada fantasma con OT resoluble:
 * - Vincula `workOrderId` en el chip SAP del mismo documento (mismo aviso / mismo nº).
 * - Quita el chip fantasma de la grilla.
 * No borra documentos en `work_orders` ni en `avisos`.
 *
 * Simulación (default):
 *   npx tsx scripts/fusionar-chips-ot-fantasma-programa.ts
 * Una planta:
 *   npx tsx scripts/fusionar-chips-ot-fantasma-programa.ts --centro PM02
 * Aplicar:
 *   npx tsx scripts/fusionar-chips-ot-fantasma-programa.ts --commit
 *   npx tsx scripts/fusionar-chips-ot-fantasma-programa.ts --centro PT01 --commit --json reporte-fusion-ot.json
 *
 * Opciones:
 *   --centro CODE           Solo documentos `programa_semanal` cuyo id empieza con CODE_
 *   --programa-doc-id ID    Un solo documento (ej. PT01_2026-W20)
 *   --commit                Escribe en Firestore (sin esto, solo informe)
 *   --muestra N             Filas de detalle por categoría (default 25)
 *   --json PATH             Guarda reporte JSON
 *   --limit N               Máx. documentos programa a revisar (default 500)
 *   --solo-quitar-fantasma  Si no hay chip SAP en el mismo documento, igual quita el `OT-…`
 *                           (casos SKIP_SIN_CHIP_SAP). No borra la OT en `work_orders`.
 *
 * Ejemplo PT01 (fusionar W14 + quitar huérfano W23):
 *   npx tsx scripts/fusionar-chips-ot-fantasma-programa.ts --centro PT01 --solo-quitar-fantasma --commit
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";
import * as fs from "node:fs";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { parseIsoWeekIdFromSemanaParam } from "@/modules/scheduling/iso-week";
import type { AvisoSlot, DiaSemanaPrograma, EspecialidadPrograma, SlotSemanal } from "@/modules/scheduling/types";

type Resultado =
  | "FUSION_OK"
  | "SOLO_QUITA_FANTASMA"
  | "QUITA_FANTASMA_SIN_SAP"
  | "SKIP_SIN_CHIP_SAP"
  | "SKIP_CONFLICTO_WO"
  | "SKIP_SIN_WO"
  | "SKIP_VARIOS_SAP"
  | "SKIP_SIN_CAMBIOS";

type DetalleFila = {
  resultado: Resultado;
  programaDocId: string;
  centro: string;
  semanaIso: string;
  phantom: {
    numero: string;
    dia: DiaSemanaPrograma;
    localidad: string;
    especialidad: EspecialidadPrograma;
    workOrderId: string;
  };
  sap?: {
    numero: string;
    dia: DiaSemanaPrograma;
    localidad: string;
    especialidad: EspecialidadPrograma;
    workOrderIdAntes?: string;
  };
  workOrder?: { id: string; n_ot: string; aviso_id: string; aviso_numero: string };
  nota?: string;
};

type WoLite = {
  id: string;
  n_ot: string;
  aviso_id: string;
  aviso_numero: string;
  archivada: boolean;
};

function parseArgs(): {
  centro: string | null;
  programaDocId: string | null;
  commit: boolean;
  soloQuitarFantasma: boolean;
  muestra: number;
  jsonPath: string | null;
  limit: number;
} {
  const argv = process.argv.slice(2);
  let centro: string | null = null;
  let programaDocId: string | null = null;
  let commit = false;
  let soloQuitarFantasma = false;
  let muestra = 25;
  let jsonPath: string | null = null;
  let limit = 500;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--centro" && argv[i + 1]) {
      centro = argv[++i]!.trim();
    } else if (a === "--programa-doc-id" && argv[i + 1]) {
      programaDocId = argv[++i]!.trim();
    } else if (a === "--commit") {
      commit = true;
    } else if (a === "--solo-quitar-fantasma") {
      soloQuitarFantasma = true;
    } else if (a === "--muestra" && argv[i + 1]) {
      muestra = Math.max(0, parseInt(argv[++i]!, 10) || 0);
    } else if (a === "--json" && argv[i + 1]) {
      jsonPath = argv[++i]!.trim();
    } else if (a === "--limit" && argv[i + 1]) {
      limit = Math.max(1, parseInt(argv[++i]!, 10) || 500);
    }
  }
  return { centro, programaDocId, commit, soloQuitarFantasma, muestra, jsonPath, limit };
}

function isChipFantasmaOt(numero: string): boolean {
  const t = numero.trim();
  return t.startsWith("OT-") || t.startsWith("OT-ID-");
}

function parseNumeroFantasma(numero: string): { n_ot?: string; woIdPrefix?: string } {
  const t = numero.trim();
  if (t.startsWith("OT-ID-")) {
    return { woIdPrefix: t.slice("OT-ID-".length) };
  }
  if (t.startsWith("OT-")) {
    const n_ot = t.slice(3).trim();
    if (n_ot) return { n_ot };
  }
  return {};
}

function centroDesdeProgramaDocId(docId: string): string {
  const iso = parseIsoWeekIdFromSemanaParam(docId);
  if (!iso) return "";
  const pref = docId.slice(0, docId.length - iso.length - 1).trim();
  return pref;
}

function semanaIsoDesdeProgramaDocId(docId: string): string {
  return parseIsoWeekIdFromSemanaParam(docId) ?? "";
}

function cloneSlots(slots: SlotSemanal[]): SlotSemanal[] {
  return slots.map((s) => ({
    ...s,
    avisos: [...(s.avisos ?? [])],
  }));
}

function ubicacionLabel(slot: SlotSemanal): string {
  return (slot.localidad?.trim() || "—").trim() || "—";
}

function matchesSapChip(
  aviso: AvisoSlot,
  wo: WoLite,
  avisoFirestoreDesdeDb: string | null,
): boolean {
  if (isChipFantasmaOt(aviso.numero)) return false;
  const fid = aviso.avisoFirestoreId?.trim();
  const avisoId = wo.aviso_id.trim() || avisoFirestoreDesdeDb?.trim() || "";
  if (avisoId && fid && fid === avisoId) return true;
  const nSap = wo.aviso_numero.trim();
  if (nSap && aviso.numero.trim() === nSap) return true;
  return false;
}

async function loadWorkOrder(
  db: Firestore,
  cache: Map<string, WoLite | null>,
  woId: string,
): Promise<WoLite | null> {
  const id = woId.trim();
  if (!id) return null;
  if (cache.has(id)) return cache.get(id) ?? null;
  const snap = await db.collection(COLLECTIONS.work_orders).doc(id).get();
  if (!snap.exists) {
    cache.set(id, null);
    return null;
  }
  const d = snap.data() as Record<string, unknown>;
  const lite: WoLite = {
    id: snap.id,
    n_ot: String(d.n_ot ?? "").trim(),
    aviso_id: String(d.aviso_id ?? "").trim(),
    aviso_numero: String(d.aviso_numero ?? "").trim(),
    archivada: d.archivada === true,
  };
  cache.set(id, lite);
  return lite;
}

async function resolveWorkOrderForPhantom(
  db: Firestore,
  cache: Map<string, WoLite | null>,
  phantom: AvisoSlot,
): Promise<WoLite | null> {
  const woIdChip = phantom.workOrderId?.trim();
  if (woIdChip) {
    const wo = await loadWorkOrder(db, cache, woIdChip);
    if (wo) return wo;
  }
  const parsed = parseNumeroFantasma(phantom.numero);
  if (parsed.n_ot) {
    const snap = await db
      .collection(COLLECTIONS.work_orders)
      .where("n_ot", "==", parsed.n_ot)
      .limit(3)
      .get();
    if (snap.size === 1) {
      const doc = snap.docs[0]!;
      const d = doc.data() as Record<string, unknown>;
      const lite: WoLite = {
        id: doc.id,
        n_ot: String(d.n_ot ?? "").trim(),
        aviso_id: String(d.aviso_id ?? "").trim(),
        aviso_numero: String(d.aviso_numero ?? "").trim(),
        archivada: d.archivada === true,
      };
      cache.set(doc.id, lite);
      return lite;
    }
    if (snap.size > 1) return null;
  }
  if (parsed.woIdPrefix && woIdChip) {
    return loadWorkOrder(db, cache, woIdChip);
  }
  return null;
}

type AccionDoc = {
  slots: SlotSemanal[];
  dirty: boolean;
  filas: DetalleFila[];
};

function quitarPhantomDeSlot(
  slots: SlotSemanal[],
  ph: { slotIndex: number; avisoIndex: number },
): void {
  const slotPh = slots[ph.slotIndex]!;
  const avisosPh = [...(slotPh.avisos ?? [])];
  avisosPh.splice(ph.avisoIndex, 1);
  slots[ph.slotIndex] = { ...slotPh, avisos: avisosPh };
}

function planificarDocumento(
  programaDocId: string,
  slotsRaw: SlotSemanal[],
  opts: { soloQuitarFantasma: boolean },
  getWo: (phantom: AvisoSlot) => Promise<WoLite | null>,
): Promise<AccionDoc> {
  const centro = centroDesdeProgramaDocId(programaDocId);
  const semanaIso = semanaIsoDesdeProgramaDocId(programaDocId);
  const slots = cloneSlots(slotsRaw);
  const filas: DetalleFila[] = [];
  let dirty = false;

  return (async () => {
    const phantoms: Array<{
      slotIndex: number;
      avisoIndex: number;
      aviso: AvisoSlot;
    }> = [];

    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si]!;
      for (let ai = 0; ai < (slot.avisos ?? []).length; ai++) {
        const av = slot.avisos![ai]!;
        if (isChipFantasmaOt(av.numero)) {
          phantoms.push({ slotIndex: si, avisoIndex: ai, aviso: av });
        }
      }
    }

    phantoms.sort((a, b) => {
      if (b.slotIndex !== a.slotIndex) return b.slotIndex - a.slotIndex;
      return b.avisoIndex - a.avisoIndex;
    });

    for (const ph of phantoms) {
      const slotPh = slots[ph.slotIndex]!;
      const wo = await getWo(ph.aviso);
      const woId = wo?.id ?? ph.aviso.workOrderId?.trim() ?? "";

      const base: Omit<DetalleFila, "resultado"> = {
        programaDocId,
        centro,
        semanaIso,
        phantom: {
          numero: ph.aviso.numero,
          dia: slotPh.dia,
          localidad: ubicacionLabel(slotPh),
          especialidad: slotPh.especialidad,
          workOrderId: woId,
        },
      };

      if (!wo || !woId) {
        filas.push({
          ...base,
          resultado: "SKIP_SIN_WO",
          nota: "No se resolvió OT (chip sin workOrderId válido o n_ot ambiguo)",
        });
        continue;
      }

      let avisoDbId: string | null = wo.aviso_id || null;
      if (!avisoDbId && wo.aviso_numero) {
        const q = await getAdminDb()
          .collection(COLLECTIONS.avisos)
          .where("n_aviso", "==", wo.aviso_numero)
          .limit(2)
          .get();
        if (q.size === 1) avisoDbId = q.docs[0]!.id;
      }

      const sapHits: Array<{ slotIndex: number; avisoIndex: number; aviso: AvisoSlot }> = [];
      for (let si = 0; si < slots.length; si++) {
        const slot = slots[si]!;
        for (let ai = 0; ai < (slot.avisos ?? []).length; ai++) {
          const av = slot.avisos![ai]!;
          if (ph.slotIndex === si && ph.avisoIndex === ai) continue;
          if (matchesSapChip(av, wo, avisoDbId)) {
            sapHits.push({ slotIndex: si, avisoIndex: ai, aviso: av });
          }
        }
      }

      if (sapHits.length === 0) {
        if (opts.soloQuitarFantasma) {
          quitarPhantomDeSlot(slots, ph);
          dirty = true;
          filas.push({
            ...base,
            resultado: "QUITA_FANTASMA_SIN_SAP",
            workOrder: wo,
            nota: wo.archivada
              ? "Sin chip SAP en este documento; quitó fantasma (OT archivada)"
              : "Sin chip SAP en este documento; quitó solo el fantasma",
          });
        } else {
          filas.push({
            ...base,
            resultado: "SKIP_SIN_CHIP_SAP",
            workOrder: wo,
            nota: "No hay chip SAP en este programa para la misma OT/aviso",
          });
        }
        continue;
      }

      if (sapHits.length > 1) {
        filas.push({
          ...base,
          resultado: "SKIP_VARIOS_SAP",
          workOrder: wo,
          nota: `${sapHits.length} chips SAP candidatos — revisión manual`,
        });
        continue;
      }

      const sap = sapHits[0]!;
      const slotSap = slots[sap.slotIndex]!;
      const sapAviso = slotSap.avisos![sap.avisoIndex]!;
      const woSap = sapAviso.workOrderId?.trim();

      const sapInfo = {
        numero: sapAviso.numero,
        dia: slotSap.dia,
        localidad: ubicacionLabel(slotSap),
        especialidad: slotSap.especialidad,
        workOrderIdAntes: woSap || undefined,
      };

      if (woSap && woSap !== woId) {
        filas.push({
          ...base,
          resultado: "SKIP_CONFLICTO_WO",
          sap: sapInfo,
          workOrder: wo,
          nota: `Chip SAP ya tiene otra OT (${woSap})`,
        });
        continue;
      }

      quitarPhantomDeSlot(slots, ph);

      let resultado: Resultado = "SOLO_QUITA_FANTASMA";

      /** Fantasma y SAP en la misma celda: no reescribir con `slotSap` previo al splice (reintroducía el OT-*). */
      if (ph.slotIndex === sap.slotIndex) {
        if (!woSap || woSap !== woId) {
          const slot = slots[sap.slotIndex]!;
          const avisos = [...(slot.avisos ?? [])];
          const idx = avisos.findIndex((a) => matchesSapChip(a, wo, avisoDbId));
          if (idx >= 0) {
            avisos[idx] = { ...avisos[idx]!, workOrderId: woId };
            slots[sap.slotIndex] = { ...slot, avisos };
            resultado = "FUSION_OK";
          }
        }
      } else {
        const avisosSap = [...(slotSap.avisos ?? [])];
        if (!woSap || woSap !== woId) {
          avisosSap[sap.avisoIndex] = { ...sapAviso, workOrderId: woId };
          resultado = "FUSION_OK";
        }
        slots[sap.slotIndex] = { ...slotSap, avisos: avisosSap };
      }

      dirty = true;
      filas.push({
        ...base,
        resultado,
        sap: sapInfo,
        workOrder: wo,
        nota:
          resultado === "FUSION_OK"
            ? "Vinculó workOrderId en chip SAP y quitó fantasma"
            : "Chip SAP ya tenía la OT; solo quitó fantasma",
      });
    }

    return { slots, dirty, filas };
  })();
}

async function main() {
  const { centro, programaDocId, commit, soloQuitarFantasma, muestra, jsonPath, limit } = parseArgs();
  const db = getAdminDb();
  const woCache = new Map<string, WoLite | null>();

  console.log(commit ? "=== MODO APLICAR (--commit) ===" : "=== SIMULACIÓN (agregar --commit para escribir) ===");
  if (centro) console.log(`Centro filtro: ${centro}`);
  if (programaDocId) console.log(`Documento: ${programaDocId}`);
  if (soloQuitarFantasma) {
    console.log("Modo: --solo-quitar-fantasma (también quita OT-* sin chip SAP en el mismo documento)");
  }
  console.log("");

  let docs: Array<{ id: string; data: () => Record<string, unknown> }> = [];

  if (programaDocId) {
    const snap = await db.collection(COLLECTIONS.programa_semanal).doc(programaDocId).get();
    if (!snap.exists) {
      console.error(`No existe programa_semanal/${programaDocId}`);
      process.exit(1);
    }
    docs = [{ id: snap.id, data: () => snap.data() as Record<string, unknown> }];
  } else {
    const snap = await db.collection(COLLECTIONS.programa_semanal).limit(limit).get();
    docs = snap.docs.filter((d) => {
      if (!centro) return true;
      const c = centroDesdeProgramaDocId(d.id);
      return c === centro.trim();
    }).map((d) => ({ id: d.id, data: () => d.data() as Record<string, unknown> }));
  }

  const conteo: Record<Resultado, number> = {
    FUSION_OK: 0,
    SOLO_QUITA_FANTASMA: 0,
    QUITA_FANTASMA_SIN_SAP: 0,
    SKIP_SIN_CHIP_SAP: 0,
    SKIP_CONFLICTO_WO: 0,
    SKIP_SIN_WO: 0,
    SKIP_VARIOS_SAP: 0,
    SKIP_SIN_CAMBIOS: 0,
  };

  const todasFilas: DetalleFila[] = [];
  let docsActualizados = 0;
  let phantomsVistos = 0;

  for (const docSnap of docs) {
    const raw = docSnap.data();
    const slotsRaw = ((raw.slots as SlotSemanal[] | undefined) ?? []) as SlotSemanal[];
    const tieneFantasma = slotsRaw.some((s) =>
      (s.avisos ?? []).some((a) => isChipFantasmaOt(a.numero)),
    );
    if (!tieneFantasma) continue;

    phantomsVistos += slotsRaw.reduce(
      (n, s) => n + (s.avisos ?? []).filter((a) => isChipFantasmaOt(a.numero)).length,
      0,
    );

    const plan = await planificarDocumento(
      docSnap.id,
      slotsRaw,
      { soloQuitarFantasma },
      (phantom) => resolveWorkOrderForPhantom(db, woCache, phantom),
    );

    todasFilas.push(...plan.filas);
    for (const f of plan.filas) {
      conteo[f.resultado] = (conteo[f.resultado] ?? 0) + 1;
    }

    if (plan.dirty && commit) {
      await db.collection(COLLECTIONS.programa_semanal).doc(docSnap.id).update({
        slots: plan.slots,
        updated_at: FieldValue.serverTimestamp(),
      });
      docsActualizados += 1;
    } else if (plan.dirty) {
      docsActualizados += 1;
    }
  }

  console.log(`Documentos programa revisados: ${docs.length}`);
  console.log(`Chips fantasma OT-* detectados: ${phantomsVistos}`);
  console.log(`Documentos con cambios planificados: ${docsActualizados}`);
  console.log("");
  console.log("Resultados por ítem:");
  for (const [k, v] of Object.entries(conteo)) {
    if (v > 0) console.log(`  ${k}: ${v}`);
  }

  const ordenMuestra: Resultado[] = [
    "FUSION_OK",
    "SOLO_QUITA_FANTASMA",
    "QUITA_FANTASMA_SIN_SAP",
    "SKIP_CONFLICTO_WO",
    "SKIP_VARIOS_SAP",
    "SKIP_SIN_CHIP_SAP",
    "SKIP_SIN_WO",
  ];

  if (muestra > 0) {
    console.log("");
    console.log(`--- Muestra (hasta ${muestra} por categoría) ---`);
    for (const cat of ordenMuestra) {
      const rows = todasFilas.filter((r) => r.resultado === cat).slice(0, muestra);
      if (!rows.length) continue;
      console.log(`\n[${cat}]`);
      for (const r of rows) {
        const sapTxt = r.sap
          ? `SAP ${r.sap.numero} @ ${r.sap.dia}/${r.sap.localidad}`
          : "—";
        const phTxt = `OT ${r.phantom.numero} @ ${r.phantom.dia}/${r.phantom.localidad}`;
        console.log(
          `  ${r.programaDocId} | ${phTxt} → ${sapTxt} | wo=${r.phantom.workOrderId}${r.nota ? ` | ${r.nota}` : ""}`,
        );
      }
    }
  }

  if (jsonPath) {
    const reporte = {
      generadoEn: new Date().toISOString(),
      commit,
      filtros: { centro, programaDocId, limit, soloQuitarFantasma },
      conteo,
      docsActualizados,
      phantomsVistos,
      filas: todasFilas,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(reporte, null, 2), "utf8");
    console.log(`\nReporte JSON: ${jsonPath}`);
  }

  if (!commit && docsActualizados > 0) {
    console.log("\nPara aplicar: agregá --commit (recomendado antes: revisar muestra o --json).");
  }

  const centrosConocidos = centro ? [centro] : [...KNOWN_CENTROS];
  if (!programaDocId && centro && !centrosConocidos.includes(centro)) {
    console.warn(`\nAdvertencia: --centro ${centro} no está en KNOWN_CENTROS; filtro por prefijo de id.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
