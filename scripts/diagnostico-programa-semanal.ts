/**
 * Diagnóstico: avisos vs grilla publicada (`programa_semanal.slots`).
 *
 * Detecta el hueco típico «figura en listados / tiene OT / se puede asignar, pero no en programa semanal»:
 * - `incluido_en_semana` sin chip en ningún slot
 * - OT vinculada sin entrada en `programa_semanal`
 * - `centro` del aviso distinto al del documento de programa o al derivado por UT
 *
 * Uso (credenciales Admin en `.env.local`, igual que otros scripts):
 *   npx tsx scripts/diagnostico-programa-semanal.ts
 *   npx tsx scripts/diagnostico-programa-semanal.ts --centro PT01
 *   npx tsx scripts/diagnostico-programa-semanal.ts --centro PT01 --incluir-ut-piray-en-otros-centros
 *   npx tsx scripts/diagnostico-programa-semanal.ts --solo-correctivos --muestra 25
 *   npx tsx scripts/diagnostico-programa-semanal.ts --json reporte-piray.json
 *
 * Opciones:
 *   --centro CODE              Planta objetivo (default PT01 / Piray)
 *   --incluir-ut-piray-en-otros-centros
 *                              También revisa avisos con UT Piray/HPP pero centro ≠ PT01 (p. ej. PC01)
 *   --solo-correctivos         Solo tipo CORRECTIVO / EMERGENCIA
 *   --solo-abiertos            Solo estado ABIERTO (o vacío)
 *   --solo-hpp                 Solo UT que contenga HPP (Piray central)
 *   --limit N                  Máx. avisos por consulta Firestore (default 8000)
 *   --muestra N                Filas de detalle por categoría (default 20)
 *   --json PATH                Escribe reporte JSON
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";
import * as fs from "node:fs";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldPath } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { nombreCentro } from "@/lib/config/app-config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { normalizeCentro } from "@/lib/firestore/derive-centro";
import { parseIsoWeekIdFromSemanaParam } from "@/modules/scheduling/iso-week";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";

type DiagnosticoCategoria =
  | "EN_GRILLA_OK"
  | "INCLUIDO_EN_SEMANA_SIN_SLOT"
  | "OT_SIN_GRILLA"
  | "SIN_OT_SIN_GRILLA"
  | "EN_GRILLA_DOC_OTRO_CENTRO"
  | "CENTRO_AVISO_VS_UT"
  | "OT_CENTRO_DISTINTO";

type GrillaUbicacion = {
  programaDocId: string;
  isoSemana: string;
  centroDoc: string;
  localidad: string;
  dia: string;
  especialidad: string;
  numeroSlot: string;
};

type FilaDiagnostico = {
  avisoId: string;
  n_aviso: string;
  centro: string;
  centroEsperadoUt: string;
  tipo: string;
  estado: string;
  ubicacion_tecnica: string;
  incluido_en_semana: string | null;
  work_order_id: string | null;
  wo_centro: string | null;
  wo_fecha_programada: string | null;
  categorias: DiagnosticoCategoria[];
  grilla: GrillaUbicacion[];
};

function parseArgs(): {
  centro: string;
  incluirUtPirayOtrosCentros: boolean;
  soloCorrectivos: boolean;
  soloAbiertos: boolean;
  soloHpp: boolean;
  limit: number;
  muestra: number;
  jsonPath: string | null;
} {
  const argv = process.argv.slice(2);
  let centro = "PT01";
  let incluirUtPirayOtrosCentros = false;
  let soloCorrectivos = false;
  let soloAbiertos = false;
  let soloHpp = false;
  let limit = 8000;
  let muestra = 20;
  let jsonPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if ((a === "--centro" || a === "-c") && argv[i + 1]) {
      centro = argv[++i]!.trim();
    } else if (a === "--incluir-ut-piray-en-otros-centros") {
      incluirUtPirayOtrosCentros = true;
    } else if (a === "--solo-correctivos") {
      soloCorrectivos = true;
    } else if (a === "--solo-abiertos") {
      soloAbiertos = true;
    } else if (a === "--solo-hpp") {
      soloHpp = true;
    } else if ((a === "--limit" || a === "-l") && argv[i + 1]) {
      limit = Math.max(1, parseInt(argv[++i]!, 10) || 8000);
    } else if ((a === "--muestra" || a === "-m") && argv[i + 1]) {
      muestra = Math.max(0, parseInt(argv[++i]!, 10) || 0);
    } else if (a === "--json" && argv[i + 1]) {
      jsonPath = argv[++i]!.trim();
    }
  }

  return {
    centro,
    incluirUtPirayOtrosCentros,
    soloCorrectivos,
    soloAbiertos,
    soloHpp,
    limit,
    muestra,
    jsonPath,
  };
}

/** Segmento HPP (central hidroeléctrica), no confundir con HOT / HOTEL. */
function textoContieneHpp(s: string): boolean {
  const u = s.trim().toUpperCase();
  if (!u) return false;
  return /(?:^|[-_/])HPP(?:$|[-_/])/.test(u) || u.includes("PIR-HPP") || u.includes("HPP-");
}

function utParecePiray(ut: string): boolean {
  const u = ut.trim().toUpperCase();
  if (!u) return false;
  if (u.includes("PIRAY") || textoContieneHpp(u)) return true;
  const first = u.split(/[-_/]/)[0] ?? "";
  return first === "PIRA" || first === "PIR" || first.startsWith("PIRA");
}

function centroEsperadoDesdeAviso(ut: string, codigoEquipo: string, rawCentro: string): string {
  return normalizeCentro(rawCentro, ut, codigoEquipo || undefined);
}

function isoDesdeDocId(docId: string): string | null {
  return parseIsoWeekIdFromSemanaParam(docId);
}

function centroDesdeDocIdPrograma(docId: string): string {
  const iso = isoDesdeDocId(docId);
  if (!iso) return "";
  const suf = `_${iso}`;
  if (docId.endsWith(suf)) return docId.slice(0, docId.length - suf.length);
  return "";
}

async function indexarGrillaPrograma(centroFiltro: string | null): Promise<{
  porAvisoId: Map<string, GrillaUbicacion[]>;
  porNumero: Map<string, GrillaUbicacion[]>;
  docsPrograma: number;
  slotsConAvisos: number;
}> {
  const db = getAdminDb();
  const porAvisoId = new Map<string, GrillaUbicacion[]>();
  const porNumero = new Map<string, GrillaUbicacion[]>();
  let docsPrograma = 0;
  let slotsConAvisos = 0;

  const snap = centroFiltro
    ? await db
        .collection(COLLECTIONS.programa_semanal)
        .orderBy(FieldPath.documentId())
        .startAt(`${centroFiltro}_`)
        .endAt(`${centroFiltro}_\uf8ff`)
        .get()
    : await db.collection(COLLECTIONS.programa_semanal).get();

  for (const d of snap.docs) {
    docsPrograma += 1;
    const raw = d.data() as Record<string, unknown>;
    const centroDoc =
      (typeof raw.centro === "string" ? raw.centro.trim() : "") || centroDesdeDocIdPrograma(d.id);
    const iso = isoDesdeDocId(d.id) ?? "";
    const slots = raw.slots;
    if (!Array.isArray(slots)) continue;

    for (const slot of slots as Array<Record<string, unknown>>) {
      const avisos = slot.avisos;
      if (!Array.isArray(avisos) || avisos.length === 0) continue;
      slotsConAvisos += 1;

      const loc = typeof slot.localidad === "string" ? slot.localidad.trim() : "—";
      const dia = typeof slot.dia === "string" ? slot.dia : "?";
      const esp = typeof slot.especialidad === "string" ? slot.especialidad : "?";

      for (const av of avisos as Array<Record<string, unknown>>) {
        const numero =
          typeof av.numero === "string" ? av.numero.trim() : String(av.numero ?? "").trim();
        const aid =
          typeof av.avisoFirestoreId === "string" ? av.avisoFirestoreId.trim() : "";
        const row: GrillaUbicacion = {
          programaDocId: d.id,
          isoSemana: iso,
          centroDoc,
          localidad: loc,
          dia,
          especialidad: esp,
          numeroSlot: numero,
        };
        if (aid) {
          const cur = porAvisoId.get(aid) ?? [];
          cur.push(row);
          porAvisoId.set(aid, cur);
        }
        if (numero) {
          const curN = porNumero.get(numero) ?? [];
          curN.push(row);
          porNumero.set(numero, curN);
        }
      }
    }
  }

  return { porAvisoId, porNumero, docsPrograma, slotsConAvisos };
}

async function cargarAvisosCentro(centro: string, limit: number): Promise<
  Array<{ id: string; data: Record<string, unknown> }>
> {
  const db = getAdminDb();
  const snap = await db
    .collection(COLLECTIONS.avisos)
    .where("centro", "==", centro)
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
}

async function cargarAvisosUtPirayOtrosCentros(
  centroExcluir: string,
  limit: number,
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const db = getAdminDb();
  const centrosScan = ["PC01", "PF01", "PM02"].filter((c) => c !== centroExcluir);
  const out: Array<{ id: string; data: Record<string, unknown> }> = [];
  const perCentro = Math.ceil(limit / Math.max(centrosScan.length, 1));

  for (const c of centrosScan) {
    const snap = await db.collection(COLLECTIONS.avisos).where("centro", "==", c).limit(perCentro).get();
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const ut = String(data.ubicacion_tecnica ?? "");
      if (utParecePiray(ut)) {
        out.push({ id: d.id, data });
      }
    }
  }
  return out;
}

async function woMeta(
  woId: string,
): Promise<{ centro: string | null; fecha: string | null } | null> {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.work_orders).doc(woId).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  const centro = typeof d.centro === "string" ? d.centro.trim() : null;
  const fp = d.fecha_inicio_programada as { toDate?: () => Date } | undefined;
  const fecha =
    fp && typeof fp.toDate === "function" && !Number.isNaN(fp.toDate().getTime())
      ? fp.toDate().toISOString().slice(0, 10)
      : null;
  return { centro, fecha };
}

function clasificarFila(
  avisoId: string,
  data: Record<string, unknown>,
  grillaPorId: Map<string, GrillaUbicacion[]>,
  grillaPorNumero: Map<string, GrillaUbicacion[]>,
  centroObjetivo: string,
  wo: { centro: string | null; fecha: string | null } | null,
): FilaDiagnostico {
  const n_aviso = String(data.n_aviso ?? "").trim();
  const centro = String(data.centro ?? "").trim();
  const ut = String(data.ubicacion_tecnica ?? "").trim();
  const tipo = String(data.tipo ?? "").trim();
  const estado = String(data.estado ?? "ABIERTO").trim().toUpperCase();
  const incluido =
    typeof data.incluido_en_semana === "string" ? data.incluido_en_semana.trim() || null : null;
  const woId =
    typeof data.work_order_id === "string" ? data.work_order_id.trim() || null : null;

  const codigoEquipo = "";
  const centroEsperadoUt = centroEsperadoDesdeAviso(ut, codigoEquipo, centro);

  const grilla = [...(grillaPorId.get(avisoId) ?? [])];
  if (!grilla.length && n_aviso) {
    const porN = grillaPorNumero.get(n_aviso) ?? [];
    for (const g of porN) {
      if (!grilla.some((x) => x.programaDocId === g.programaDocId && x.numeroSlot === g.numeroSlot)) {
        grilla.push(g);
      }
    }
  }

  const categorias: DiagnosticoCategoria[] = [];

  const enGrillaCentroObjetivo = grilla.some(
    (g) => g.centroDoc === centroObjetivo || g.programaDocId.startsWith(`${centroObjetivo}_`),
  );
  const enGrillaOtroCentro = grilla.some(
    (g) => g.centroDoc && g.centroDoc !== centroObjetivo && !g.programaDocId.startsWith(`${centroObjetivo}_`),
  );

  if (centroEsperadoUt && centro && centroEsperadoUt !== centro) {
    categorias.push("CENTRO_AVISO_VS_UT");
  }

  if (wo?.centro && centro && wo.centro !== centro) {
    categorias.push("OT_CENTRO_DISTINTO");
  }

  if (grilla.length > 0) {
    if (enGrillaCentroObjetivo) {
      categorias.push("EN_GRILLA_OK");
    }
    if (enGrillaOtroCentro && !enGrillaCentroObjetivo) {
      categorias.push("EN_GRILLA_DOC_OTRO_CENTRO");
    }
    if (enGrillaOtroCentro && enGrillaCentroObjetivo) {
      categorias.push("EN_GRILLA_DOC_OTRO_CENTRO");
    }
  } else {
    if (incluido) categorias.push("INCLUIDO_EN_SEMANA_SIN_SLOT");
    if (woId) categorias.push("OT_SIN_GRILLA");
    if (!woId && !incluido) categorias.push("SIN_OT_SIN_GRILLA");
  }

  if (!categorias.length) categorias.push("SIN_OT_SIN_GRILLA");

  return {
    avisoId,
    n_aviso,
    centro,
    centroEsperadoUt,
    tipo,
    estado,
    ubicacion_tecnica: ut,
    incluido_en_semana: incluido,
    work_order_id: woId,
    wo_centro: wo?.centro ?? null,
    wo_fecha_programada: wo?.fecha ?? null,
    categorias: [...new Set(categorias)],
    grilla,
  };
}

const ETIQUETA_CATEGORIA: Record<DiagnosticoCategoria, string> = {
  EN_GRILLA_OK: "OK — figura en programa_semanal (planta objetivo)",
  INCLUIDO_EN_SEMANA_SIN_SLOT: "FANTASMA — incluido_en_semana sin chip en slots",
  OT_SIN_GRILLA: "HUECO — OT vinculada pero NO en grilla (causa típica del reporte)",
  SIN_OT_SIN_GRILLA: "Pendiente — sin OT y sin grilla",
  EN_GRILLA_DOC_OTRO_CENTRO: "Grilla en documento de OTRA planta (centro / id doc)",
  CENTRO_AVISO_VS_UT: "centro del aviso ≠ derivado por UT/equipo",
  OT_CENTRO_DISTINTO: "centro de la OT ≠ centro del aviso",
};

function imprimirMuestra(categoria: DiagnosticoCategoria, filas: FilaDiagnostico[], muestra: number): void {
  const subset = filas.filter((f) => f.categorias.includes(categoria));
  if (!subset.length) return;
  console.log(`\n── ${ETIQUETA_CATEGORIA[categoria]} (${subset.length}) ──`);
  for (const f of subset.slice(0, muestra)) {
    console.log(`  ${f.n_aviso} | aviso=${f.avisoId}`);
    console.log(
      `    centro=${f.centro} | UT→${f.centroEsperadoUt} | tipo=${f.tipo} | estado=${f.estado}`,
    );
    console.log(`    UT: ${f.ubicacion_tecnica.slice(0, 72)}${f.ubicacion_tecnica.length > 72 ? "…" : ""}`);
    console.log(
      `    incluido_en_semana=${f.incluido_en_semana ?? "—"} | OT=${f.work_order_id ?? "—"}${f.wo_centro ? ` (wo.centro=${f.wo_centro})` : ""}`,
    );
    if (f.grilla.length) {
      for (const g of f.grilla.slice(0, 3)) {
        console.log(
          `    grilla: ${g.programaDocId} | ${g.dia} | ${g.localidad.slice(0, 40)} | ${g.especialidad}`,
        );
      }
    } else if (f.incluido_en_semana) {
      const docEsperado = propuestaSemanaDocId(f.centro || "PT01", f.incluido_en_semana);
      console.log(`    doc esperado si estuviera publicado: ${docEsperado} (revisar slots vacíos)`);
    }
  }
  if (subset.length > muestra) {
    console.log(`  … y ${subset.length - muestra} más`);
  }
}

async function contarPropuestasPendientes(centro: string): Promise<{
  docs: number;
  itemsPropuesta: number;
  itemsCorrectivo: number;
}> {
  const db = getAdminDb();
  const prefix = `${centro}_`;
  const snap = await db
    .collection(COLLECTIONS.propuestas_semana)
    .orderBy(FieldPath.documentId())
    .startAt(prefix)
    .endAt(`${prefix}\uf8ff`)
    .get();

  let itemsPropuesta = 0;
  let itemsCorrectivo = 0;
  for (const d of snap.docs) {
    const raw = d.data() as Record<string, unknown>;
    if (raw.status !== "pendiente_aprobacion") continue;
    const items = raw.items;
    if (!Array.isArray(items)) continue;
    for (const it of items as Array<Record<string, unknown>>) {
      if (it.status !== "propuesta") continue;
      itemsPropuesta += 1;
      if (it.kind === "correctivo_existente") itemsCorrectivo += 1;
    }
  }
  return { docs: snap.size, itemsPropuesta, itemsCorrectivo };
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const centro = opts.centro;
  const nombre = nombreCentro(centro);

  console.log("═══════════════════════════════════════════════════════════");
  console.log(` Diagnóstico programa semanal — ${centro} (${nombre})`);
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log("Indexando grilla programa_semanal…");
  const grillaCentro = await indexarGrillaPrograma(centro);
  const grillaGlobal = await indexarGrillaPrograma(null);

  console.log(
    `  Docs ${centro}_*: ${grillaCentro.docsPrograma} | slots con avisos: ${grillaCentro.slotsConAvisos}`,
  );
  console.log(
    `  Índice global: ${grillaGlobal.docsPrograma} docs | avisos en slots (por id): ${grillaGlobal.porAvisoId.size}`,
  );

  console.log("\nCargando avisos…");
  let avisos = await cargarAvisosCentro(centro, opts.limit);
  console.log(`  Por centro=${centro}: ${avisos.length}`);

  if (opts.incluirUtPirayOtrosCentros) {
    const extra = await cargarAvisosUtPirayOtrosCentros(centro, opts.limit);
    const ids = new Set(avisos.map((a) => a.id));
    for (const a of extra) {
      if (!ids.has(a.id)) avisos.push(a);
    }
    console.log(`  + UT Piray/HPP en otros centros: ${extra.length} (total único ${avisos.length})`);
  }

  if (opts.soloCorrectivos) {
    avisos = avisos.filter((a) => {
      const t = String(a.data.tipo ?? "").toUpperCase();
      return t === "CORRECTIVO" || t === "EMERGENCIA";
    });
    console.log(`  Tras --solo-correctivos: ${avisos.length}`);
  }

  if (opts.soloAbiertos) {
    avisos = avisos.filter((a) => {
      const st = String(a.data.estado ?? "ABIERTO").trim().toUpperCase();
      return st === "ABIERTO" || st === "";
    });
    console.log(`  Tras --solo-abiertos: ${avisos.length}`);
  }

  if (opts.soloHpp) {
    avisos = avisos.filter((a) => {
      const ut = String(a.data.ubicacion_tecnica ?? "");
      const txt = String(a.data.texto_corto ?? "");
      return textoContieneHpp(ut) || textoContieneHpp(txt);
    });
    console.log(`  Tras --solo-hpp (segmento HPP, no HOT): ${avisos.length}`);
  }

  const prop = await contarPropuestasPendientes(centro);
  console.log(
    `\nPropuestas motor (${centro}_*): ${prop.docs} docs | ítems en 'propuesta': ${prop.itemsPropuesta} (correctivos: ${prop.itemsCorrectivo})`,
  );
  if (prop.itemsCorrectivo > 0) {
    console.log(
      "  → Hay correctivos propuestos sin aprobar: hasta aprobar, no pasan a programa_semanal.slots.",
    );
  }

  console.log("\nClasificando avisos (puede tardar si hay muchas OT)…");
  const filas: FilaDiagnostico[] = [];
  const woCache = new Map<string, { centro: string | null; fecha: string | null } | null>();

  for (const { id, data } of avisos) {
    const woId = typeof data.work_order_id === "string" ? data.work_order_id.trim() : "";
    let wo: { centro: string | null; fecha: string | null } | null = null;
    if (woId) {
      if (!woCache.has(woId)) woCache.set(woId, await woMeta(woId));
      wo = woCache.get(woId) ?? null;
    }
    filas.push(
      clasificarFila(id, data, grillaGlobal.porAvisoId, grillaGlobal.porNumero, centro, wo),
    );
  }

  const conteo = new Map<DiagnosticoCategoria, number>();
  for (const cat of Object.keys(ETIQUETA_CATEGORIA) as DiagnosticoCategoria[]) {
    conteo.set(cat, 0);
  }
  for (const f of filas) {
    for (const c of f.categorias) {
      conteo.set(c, (conteo.get(c) ?? 0) + 1);
    }
  }

  console.log("\n════════════ RESUMEN ════════════");
  console.log(`Avisos analizados: ${filas.length}`);
  for (const [cat, n] of conteo) {
    if (n > 0) console.log(`  ${cat}: ${n} — ${ETIQUETA_CATEGORIA[cat]}`);
  }

  const problematicos = filas.filter(
    (f) =>
      f.categorias.includes("OT_SIN_GRILLA") ||
      f.categorias.includes("INCLUIDO_EN_SEMANA_SIN_SLOT") ||
      f.categorias.includes("EN_GRILLA_DOC_OTRO_CENTRO") ||
      f.categorias.includes("CENTRO_AVISO_VS_UT"),
  );
  console.log(`\nAvisos con al menos un problema de programa: ${problematicos.length}`);

  if (opts.muestra > 0) {
    console.log("\n════════════ DETALLE (muestra) ════════════");
    const orden: DiagnosticoCategoria[] = [
      "OT_SIN_GRILLA",
      "INCLUIDO_EN_SEMANA_SIN_SLOT",
      "EN_GRILLA_DOC_OTRO_CENTRO",
      "CENTRO_AVISO_VS_UT",
      "OT_CENTRO_DISTINTO",
      "SIN_OT_SIN_GRILLA",
      "EN_GRILLA_OK",
    ];
    for (const cat of orden) imprimirMuestra(cat, filas, opts.muestra);
  }

  console.log("\n════════════ ACCIONES SUGERIDAS ════════════");
  const nOtSinGrilla = conteo.get("OT_SIN_GRILLA") ?? 0;
  const nFantasma = conteo.get("INCLUIDO_EN_SEMANA_SIN_SLOT") ?? 0;
  const nOtroCentro = conteo.get("EN_GRILLA_DOC_OTRO_CENTRO") ?? 0;
  if (nOtSinGrilla > 0) {
    console.log(
      `• ${nOtSinGrilla} con OT sin grilla: usar «Agregar al programa» en Correctivos/Vencimientos,`,
    );
    console.log("  o aprobar propuesta del motor; crear OT desde aviso NO publica en slots.");
  }
  if (nFantasma > 0) {
    console.log(
      `• ${nFantasma} con incluido_en_semana pero sin slot: semana marcada sin chip (UI puede confundir).`,
    );
  }
  if (nOtroCentro > 0) {
    console.log(
      `• ${nOtroCentro} en grilla de otra planta: revisar campo centro o importación UT; en /programa elegir la planta del doc.`,
    );
  }
  if ((conteo.get("CENTRO_AVISO_VS_UT") ?? 0) > 0) {
    console.log(
      "• Centro distinto al derivado por UT: ejecutar auditar-centro / corregir-centro-avisos-desde-activo.",
    );
  }

  if (opts.jsonPath) {
    const reporte = {
      generadoEn: new Date().toISOString(),
      centro,
      nombreCentro: nombre,
      opciones: opts,
      resumen: Object.fromEntries(conteo),
      grilla: {
        docsCentro: grillaCentro.docsPrograma,
        slotsConAvisosCentro: grillaCentro.slotsConAvisos,
      },
      propuestasMotor: prop,
      filas,
    };
    fs.writeFileSync(opts.jsonPath, JSON.stringify(reporte, null, 2), "utf8");
    console.log(`\nReporte JSON: ${opts.jsonPath}`);
  }

  console.log("\nListo.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
