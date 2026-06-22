/**
 * Auditoría: por qué una OT/aviso no se ve en la grilla del programa (técnico).
 *
 * Uso:
 *   npx tsx scripts/auditoria-visibilidad-ot-grilla.ts 11388623
 *   npx tsx scripts/auditoria-visibilidad-ot-grilla.ts --email grupoaireacondicionado@seam.com.ar
 *   npx tsx scripts/auditoria-visibilidad-ot-grilla.ts 11388623 --email grupoaireacondicionado@seam.com.ar
 */
/* eslint-disable no-console */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  candidateAvisoDocIds,
  nAvisoStringsForFirestoreInQuery,
} from "@/lib/import/aviso-numero-canonical";
import { especialidadDominioAPrograma } from "@/modules/scheduling/especialidad-programa";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import type { Especialidad } from "@/modules/notices/types";
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

function ts(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as Timestamp).toDate === "function") {
    return (v as Timestamp).toDate().toISOString();
  }
  return String(v);
}

function parseArgs(): { numero?: string; email?: string; woId?: string } {
  const argv = process.argv.slice(2);
  let numero: string | undefined;
  let email: string | undefined;
  let woId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--email" && argv[i + 1]) {
      email = argv[++i]!.trim();
    } else if (a === "--wo" && argv[i + 1]) {
      woId = argv[++i]!.trim();
    } else if (!a.startsWith("-") && !numero) {
      numero = a.trim();
    }
  }
  return { numero, email, woId };
}

type WoRow = Record<string, unknown> & { id: string };

async function findWorkOrders(db: FirebaseFirestore.Firestore, numero?: string, woId?: string): Promise<WoRow[]> {
  const woCol = db.collection(COLLECTIONS.work_orders);
  const out: WoRow[] = [];
  const seen = new Set<string>();

  const push = (id: string, data: Record<string, unknown>) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, ...data });
  };

  if (woId) {
    const snap = await woCol.doc(woId).get();
    if (snap.exists) push(snap.id, snap.data() as Record<string, unknown>);
    return out;
  }

  if (!numero) return out;

  for (const campo of ["aviso_numero", "n_ot"] as const) {
    const snap = await woCol.where(campo, "==", numero).limit(10).get();
    for (const d of snap.docs) push(d.id, d.data() as Record<string, unknown>);
  }

  for (const centro of KNOWN_CENTROS) {
    for (const campo of ["aviso_numero", "n_ot"] as const) {
      for (const n of nAvisoStringsForFirestoreInQuery(numero)) {
        const snap = await woCol.where("centro", "==", centro).where(campo, "==", n).limit(5).get();
        for (const d of snap.docs) push(d.id, d.data() as Record<string, unknown>);
      }
    }
  }

  return out;
}

async function findAvisos(db: FirebaseFirestore.Firestore, numero?: string, avisoId?: string): Promise<Array<Record<string, unknown> & { id: string }>> {
  const avisoCol = db.collection(COLLECTIONS.avisos);
  const avisos: Array<Record<string, unknown> & { id: string }> = [];
  if (avisoId) {
    const snap = await avisoCol.doc(avisoId).get();
    if (snap.exists) avisos.push({ id: snap.id, ...(snap.data() as object) });
    return avisos;
  }
  if (!numero) return avisos;
  for (const id of [...new Set([...candidateAvisoDocIds(numero), numero])]) {
    const snap = await avisoCol.doc(id).get();
    if (snap.exists) avisos.push({ id: snap.id, ...(snap.data() as object) });
  }
  for (const n of nAvisoStringsForFirestoreInQuery(numero)) {
    const snap = await avisoCol.where("n_aviso", "==", n).limit(8).get();
    for (const d of snap.docs) {
      if (!avisos.some((a) => a.id === d.id)) avisos.push({ id: d.id, ...(d.data() as object) });
    }
  }
  return avisos;
}

function findAvisoEnSlots(
  slots: SlotSemanal[] | undefined,
  nAviso: string,
  avisoFirestoreId?: string,
): Array<{ localidad: string; dia: string; especialidad: string; workOrderId?: string }> {
  const hits: Array<{ localidad: string; dia: string; especialidad: string; workOrderId?: string }> = [];
  for (const s of slots ?? []) {
    for (const a of s.avisos ?? []) {
      const matchNum = String(a.numero ?? "").trim() === nAviso.trim();
      const matchId = avisoFirestoreId && a.avisoFirestoreId?.trim() === avisoFirestoreId.trim();
      if (matchNum || matchId) {
        hits.push({
          localidad: s.localidad,
          dia: s.dia,
          especialidad: s.especialidad,
          workOrderId: a.workOrderId,
        });
      }
    }
  }
  return hits;
}

function tecnicoPuedeLeerOtSim(
  user: { uid: string; centro?: string; centros_asignados?: string[] },
  wo: { centro?: string; tecnico_asignado_uid?: string; archivada?: boolean },
): { ok: boolean; motivo: string } {
  if (wo.archivada === true) return { ok: false, motivo: "OT archivada (oculta para no superadmin)" };
  const centroOt = String(wo.centro ?? "").trim();
  const centrosUser = [
    ...(Array.isArray(user.centros_asignados) ? user.centros_asignados.map((c) => String(c).trim()) : []),
    String(user.centro ?? "").trim(),
  ].filter(Boolean);
  const mismoCentro = centrosUser.includes(centroOt);
  if (!mismoCentro) {
    return {
      ok: false,
      motivo: `Centro OT (${centroOt || "—"}) no está en perfil del usuario (${centrosUser.join(", ") || "—"})`,
    };
  }
  const tec = String(wo.tecnico_asignado_uid ?? "").trim();
  if (!tec) return { ok: true, motivo: "Pool sin asignar (cualquier técnico del centro puede leer)" };
  if (tec === user.uid) return { ok: true, motivo: "Asignada a este uid" };
  return { ok: false, motivo: `Asignada a otro uid (${tec})` };
}

function grillaTecnicoVisibleSim(input: {
  tieneOt: boolean;
  estadoOt?: string;
  puedeLeerOt: boolean;
  espPrograma?: string;
  espUsuario: string[];
  enSlots: boolean;
}): string[] {
  const bloqueos: string[] = [];
  if (!input.enSlots) bloqueos.push("Aviso/OT no está en ningún slot de programa_semanal publicado");
  if (!input.tieneOt) bloqueos.push("Sin work_order_id vinculado (grilla técnico exige OT)");
  if (input.estadoOt === "ANULADA") bloqueos.push("OT anulada (oculta para técnico)");
  if (input.tieneOt && !input.puedeLeerOt) bloqueos.push("Firestore no permitiría leer la OT (estado no carga → chip oculto)");
  if (input.espPrograma && input.espUsuario.length > 0) {
    const espDom = input.espPrograma;
    const visible = input.espUsuario.some((e) => especialidadDominioAPrograma(e as Especialidad) === espDom) || espDom === "HG";
    if (!visible) bloqueos.push(`Columna grilla "${input.espPrograma}" no coincide con especialidades del perfil (${input.espUsuario.join(", ")})`);
  }
  return bloqueos;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { numero, email, woId } = parseArgs();
  if (!numero && !email && !woId) {
    console.error("Uso: npx tsx scripts/auditoria-visibilidad-ot-grilla.ts <n_aviso|n_ot> [--email user@...] [--wo docId]");
    process.exit(1);
  }

  const db = getAdminDb();
  console.log("\n=== AUDITORÍA VISIBILIDAD OT → GRILLA TÉCNICO ===\n");

  let user: Record<string, unknown> & { uid: string } | null = null;
  if (email) {
    const uSnap = await db.collection(COLLECTIONS.users).where("email", "==", email).limit(3).get();
    if (!uSnap.size) {
      console.log(`Usuario no encontrado por email: ${email}`);
    } else {
      const d = uSnap.docs[0]!;
      user = { uid: d.id, ...(d.data() as object) };
      console.log("--- USUARIO ---");
      console.log(
        JSON.stringify(
          {
            uid: user.uid,
            email: user.email,
            display_name: user.display_name,
            rol: user.rol,
            centro: user.centro,
            centros_asignados: user.centros_asignados ?? null,
            especialidades: user.especialidades ?? null,
            activo: user.activo ?? null,
          },
          null,
          2,
        ),
      );
    }
  }

  const wos = await findWorkOrders(db, numero, woId);
  console.log(`\n--- WORK ORDERS (${wos.length}) ---`);
  if (!wos.length) {
    console.log("No se encontró OT por número/wo. ¿Proyecto Firebase correcto en .env.local?");
  } else {
    for (const w of wos) {
      console.log(
        JSON.stringify(
          {
            id: w.id,
            n_ot: w.n_ot,
            aviso_numero: w.aviso_numero ?? null,
            aviso_id: w.aviso_id ?? null,
            estado: w.estado,
            centro: w.centro,
            especialidad: w.especialidad,
            tecnico_asignado_uid: w.tecnico_asignado_uid ?? null,
            tecnico_asignado_nombre: w.tecnico_asignado_nombre ?? null,
            archivada: w.archivada ?? false,
            fecha_inicio_programada: ts(w.fecha_inicio_programada),
            activo_fuera_catalogo: w.activo_fuera_catalogo ?? null,
            created_at: ts(w.created_at),
          },
          null,
          2,
        ),
      );
    }
  }

  const avisoIds = [...new Set(wos.map((w) => String(w.aviso_id ?? "").trim()).filter(Boolean))];
  let avisos = await findAvisos(db, numero, avisoIds[0]);
  if (!avisos.length && avisoIds.length) {
    for (const aid of avisoIds) {
      avisos.push(...(await findAvisos(db, undefined, aid)));
    }
  }
  if (!avisos.length && numero) avisos = await findAvisos(db, numero);

  console.log(`\n--- AVISOS (${avisos.length}) ---`);
  for (const a of avisos) {
    console.log(
      JSON.stringify(
        {
          id: a.id,
          n_aviso: a.n_aviso,
          estado: a.estado,
          centro: a.centro,
          especialidad: a.especialidad,
          work_order_id: a.work_order_id ?? null,
          incluido_en_semana: a.incluido_en_semana ?? null,
        },
        null,
        2,
      ),
    );
  }

  for (const w of wos) {
    const centro = String(w.centro ?? "").trim();
    const nAviso = String(w.aviso_numero ?? w.n_ot ?? numero ?? "").trim();
    const avisoId = String(w.aviso_id ?? "").trim();
    const aviso = avisos.find((a) => a.id === avisoId);
    const incluido = String(aviso?.incluido_en_semana ?? "").trim();
    const semanasBuscar = new Set<string>();
    if (/^\d{4}-W\d{2}$/.test(incluido)) semanasBuscar.add(incluido);
    const fp = w.fecha_inicio_programada as Timestamp | undefined;
    if (fp && typeof fp.toDate === "function") {
      const d = fp.toDate();
      if (!Number.isNaN(d.getTime())) {
        const { getIsoWeekId } = await import("@/modules/scheduling/iso-week");
        semanasBuscar.add(getIsoWeekId(d));
      }
    }

    console.log(`\n--- PROGRAMA SEMANAL (OT ${w.id}) ---`);
    if (!centro) {
      console.log("OT sin centro — no se puede buscar programa.");
      continue;
    }

    let enSlots: Array<{ programaDocId: string; semanaIso: string; hits: ReturnType<typeof findAvisoEnSlots> }> = [];
    if (semanasBuscar.size === 0) {
      console.log("Sin incluido_en_semana ni fecha_inicio_programada — buscando últimos 8 programas del centro…");
      const progSnap = await db
        .collection(COLLECTIONS.programa_semanal)
        .where("centro", "==", centro)
        .limit(20)
        .get();
      for (const d of progSnap.docs) {
        const data = d.data() as ProgramaSemana;
        const hits = findAvisoEnSlots(data.slots, nAviso, avisoId);
        if (hits.length) enSlots.push({ programaDocId: d.id, semanaIso: data.semanaLabel, hits });
      }
    } else {
      for (const iso of semanasBuscar) {
        const docId = propuestaSemanaDocId(centro, iso);
        const snap = await db.collection(COLLECTIONS.programa_semanal).doc(docId).get();
        if (!snap.exists) {
          console.log(`programa_semanal/${docId}: NO EXISTE`);
          continue;
        }
        const data = snap.data() as ProgramaSemana;
        const hits = findAvisoEnSlots(data.slots, nAviso, avisoId);
        console.log(`programa_semanal/${docId}: ${hits.length ? "EN GRILLA" : "sin chip"}`);
        if (hits.length) enSlots.push({ programaDocId: docId, semanaIso: iso, hits });
        else console.log(`  slots totales: ${data.slots?.length ?? 0}`);
      }
    }

    if (!enSlots.length) {
      console.log("RESULTADO: OT_SIN_GRILLA — no hay chip en programa_semanal para este aviso/OT.");
    } else {
      for (const e of enSlots) {
        console.log(`  ${e.programaDocId} (${e.semanaIso}):`, JSON.stringify(e.hits, null, 2));
      }
    }

    if (user) {
      const perm = tecnicoPuedeLeerOtSim(
        {
          uid: user.uid,
          centro: String(user.centro ?? ""),
          centros_asignados: user.centros_asignados as string[] | undefined,
        },
        {
          centro: String(w.centro ?? ""),
          tecnico_asignado_uid: String(w.tecnico_asignado_uid ?? ""),
          archivada: w.archivada === true,
        },
      );
      const espWo = w.especialidad ? especialidadDominioAPrograma(w.especialidad as Especialidad) : undefined;
      const espUser = (user.especialidades as Especialidad[] | undefined) ?? [];
      const bloqueos = grillaTecnicoVisibleSim({
        tieneOt: true,
        estadoOt: String(w.estado ?? ""),
        puedeLeerOt: perm.ok,
        espPrograma: espWo,
        espUsuario: espUser,
        enSlots: enSlots.length > 0,
      });
      console.log("\n--- SIMULACIÓN LECTURA TÉCNICO ---");
      console.log(`Usuario: ${user.display_name ?? user.email} (${user.uid})`);
      console.log(`Permiso Firestore OT: ${perm.ok ? "OK" : "DENEGADO"} — ${perm.motivo}`);
      const tecUid = String(w.tecnico_asignado_uid ?? "").trim();
      if (tecUid && tecUid !== user.uid) {
        console.log(`⚠ tecnico_asignado_uid en OT (${tecUid}) ≠ uid del usuario (${user.uid})`);
      }
      if (bloqueos.length === 0) {
        console.log("✓ Debería verse en la grilla (si semana del selector coincide y filtros UI en «todos»).");
      } else {
        console.log("Bloqueos para grilla técnico:");
        for (const b of bloqueos) console.log(`  • ${b}`);
      }
    }
  }

  if (user) {
    console.log("\n--- OTs ASIGNADAS AL USUARIO (muestra) ---");
    const asignadas = await db
      .collection(COLLECTIONS.work_orders)
      .where("tecnico_asignado_uid", "==", user.uid)
      .limit(20)
      .get();
    console.log(`Total en consulta: ${asignadas.size}`);
    for (const d of asignadas.docs) {
      const x = d.data();
      console.log(
        JSON.stringify({
          id: d.id,
          n_ot: x.n_ot,
          aviso_numero: x.aviso_numero,
          centro: x.centro,
          estado: x.estado,
          incluido_en_semana: null as string | null,
        }),
      );
    }
    let enGrilla = 0;
    let sinGrilla = 0;
    for (const d of asignadas.docs) {
      const x = d.data();
      const centro = String(x.centro ?? "").trim();
      const nAviso = String(x.aviso_numero ?? x.n_ot ?? "").trim();
      const avisoId = String(x.aviso_id ?? "").trim();
      let found = false;
      if (centro && nAviso) {
        const progSnap = await db.collection(COLLECTIONS.programa_semanal).where("centro", "==", centro).limit(25).get();
        for (const p of progSnap.docs) {
          const data = p.data() as ProgramaSemana;
          if (findAvisoEnSlots(data.slots, nAviso, avisoId).length) {
            found = true;
            break;
          }
        }
      }
      if (found) enGrilla++;
      else sinGrilla++;
    }
    if (asignadas.size) {
      console.log(`Resumen asignadas: ${enGrilla} con chip en algún programa_semanal, ${sinGrilla} OT_SIN_GRILLA`);
    }
  }

  if (!wos.length && numero) {
    console.log("\n--- BÚSQUEDA AMPLIA PM02 (Bossetti) ---");
    const pm02 = await db.collection(COLLECTIONS.work_orders).where("centro", "==", "PM02").limit(5).get();
    console.log(`Muestra: ${pm02.size} OTs en PM02 (proyecto conectado: ${pm02.size ? "sí" : "vacío o sin acceso"})`);
    const pm02aa = await db
      .collection(COLLECTIONS.work_orders)
      .where("centro", "==", "PM02")
      .where("especialidad", "==", "AA")
      .limit(50)
      .get();
    for (const d of pm02aa.docs) {
      const x = d.data();
      const blob = `${x.n_ot} ${x.aviso_numero} ${x.ubicacion_tecnica} ${x.texto_trabajo}`;
      if (blob.includes(numero) || String(x.ubicacion_tecnica ?? "").includes("VIVERO-COMEDOR")) {
        console.log(
          "Posible match:",
          JSON.stringify({
            id: d.id,
            n_ot: x.n_ot,
            aviso_numero: x.aviso_numero,
            tecnico: x.tecnico_asignado_nombre,
            uid: x.tecnico_asignado_uid,
          }),
        );
      }
    }
  }

  console.log("\n=== FIN AUDITORÍA ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
