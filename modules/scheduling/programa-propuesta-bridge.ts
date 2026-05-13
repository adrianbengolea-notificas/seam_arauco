import { crearNotificacionSeguro } from "@/lib/notificaciones/crear-notificacion";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { AppError } from "@/lib/errors/app-error";
import type { OtPropuestaFirestore, PropuestaSemanaFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import { getAvisoById } from "@/modules/notices/repository";
import type { Especialidad } from "@/modules/notices/types";
import { parseIsoWeekToBounds } from "@/modules/scheduling/iso-week";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import type {
  AvisoSlot,
  DiaSemanaPrograma,
  EspecialidadPrograma,
  ProgramaSemana,
  SlotSemanal,
} from "@/modules/scheduling/types";
import { updateWorkOrderDoc } from "@/modules/work-orders/repository";
import { createWorkOrderFromAviso } from "@/modules/work-orders/service";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";

const APRENDIZAJE_SUB = "aprendizaje";
const HISTORIAL_SUB = "historial_eventos";

function diaSemanaMotorAPrograma(d: string): DiaSemanaPrograma {
  const n = d.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const orden: DiaSemanaPrograma[] = [
    "lunes",
    "martes",
    "miercoles",
    "jueves",
    "viernes",
    "sabado",
    "domingo",
  ];
  if (orden.includes(n as DiaSemanaPrograma)) return n as DiaSemanaPrograma;
  return "lunes";
}

function espAPrograma(esp: Especialidad): EspecialidadPrograma {
  if (esp === "AA") return "Aire";
  if (esp === "ELECTRICO" || esp === "HG") return "Electrico";
  return "GG";
}

function slotKey(loc: string, dia: DiaSemanaPrograma, e: EspecialidadPrograma): string {
  return `${loc.trim()}|${dia}|${e}`;
}

async function planIdsConOrdenPreviaPendiente(items: OtPropuestaFirestore[]): Promise<Set<string>> {
  const planIds = [
    ...new Set(
      items
        .map((i) => i.plan_id?.trim())
        .filter((x): x is string => Boolean(x && x.length > 0)),
    ),
  ];
  const out = new Set<string>();
  if (!planIds.length) return out;
  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.avisos);
  const chunk = 30;
  for (let i = 0; i < planIds.length; i += chunk) {
    const part = planIds.slice(i, i + chunk);
    const snaps = await db.getAll(...part.map((id) => col.doc(id)));
    for (const s of snaps) {
      if (!s.exists) continue;
      const d = s.data() as { antecesor_orden_abierta?: { work_order_id?: string } };
      if (d.antecesor_orden_abierta?.work_order_id?.trim()) out.add(s.id);
    }
  }
  return out;
}

async function buildSlotsDesdeItemsAprobados(items: OtPropuestaFirestore[]): Promise<SlotSemanal[]> {
  const conOrdenPrevia = await planIdsConOrdenPreviaPendiente(items);
  const map = new Map<
    string,
    {
      localidad: string;
      dia: DiaSemanaPrograma;
      esp: EspecialidadPrograma;
      fecha: Timestamp;
      avisos: AvisoSlot[];
      tecId?: string;
      tecNom?: string;
    }
  >();

  const sorted = [...items].sort((a, b) => a.prioridad - b.prioridad || a.numero.localeCompare(b.numero));

  for (const item of sorted) {
    if (item.status !== "aprobada") continue;
    const dia = diaSemanaMotorAPrograma(item.dia_semana);
    const esp = espAPrograma(item.especialidad);
    const loc = (item.localidad ?? "—").trim() || "—";
    const key = slotKey(loc, dia, esp);
    const fecha = item.fecha instanceof Timestamp ? item.fecha : Timestamp.fromDate(new Date());

    const planId = item.plan_id?.trim();
    const woId = item.work_order_id?.trim();
    const avisoSlot: AvisoSlot = {
      numero: item.numero,
      descripcion: item.descripcion,
      tipo: item.kind === "correctivo_existente" ? "correctivo" : "preventivo",
      urgente: item.prioridad <= 1,
      ...(planId ? { avisoFirestoreId: planId } : {}),
      ...(woId ? { workOrderId: woId } : {}),
      ...(planId && conOrdenPrevia.has(planId) ? { ordenPreviaPendiente: true } : {}),
    };

    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        localidad: loc,
        dia,
        esp,
        fecha,
        avisos: [avisoSlot],
        tecId: item.tecnico_sugerido_id,
        tecNom: item.tecnico_sugerido_nombre,
      });
    } else {
      cur.avisos.push(avisoSlot);
      if (!cur.tecId && item.tecnico_sugerido_id) {
        cur.tecId = item.tecnico_sugerido_id;
        cur.tecNom = item.tecnico_sugerido_nombre;
      }
    }
  }

  return [...map.values()].map(
    (v) =>
      ({
        localidad: v.localidad,
        especialidad: v.esp,
        dia: v.dia,
        fecha: v.fecha as unknown as SlotSemanal["fecha"],
        avisos: v.avisos,
        ...(v.tecId ? { tecnicoSugeridoUid: v.tecId } : {}),
        ...(typeof v.tecNom === "string" ? { tecnicoSugeridoNombre: v.tecNom } : {}),
      }) as SlotSemanal,
  );
}

/**
 * Publica / actualiza `programa_semanal` con el mismo id que `propuestas_semana/{propuestaId}`,
 * agrupando ítems en estado `aprobada`.
 */
export async function sincronizarProgramaDesdePropuesta(propuestaId: string): Promise<string> {
  const db = getAdminDb();
  const programaId = propuestaId;
  const pRef = db.collection(COLLECTIONS.propuestas_semana).doc(propuestaId);
  const pSnap = await pRef.get();
  if (!pSnap.exists) {
    throw new AppError("NOT_FOUND", "Propuesta no encontrada");
  }
  const prop = { id: pSnap.id, ...(pSnap.data() as Omit<PropuestaSemanaFirestore, "id">) };
  const centro = prop.centro.trim();
  const semanaIso = prop.semana.trim();
  const { start, end } = parseIsoWeekToBounds(semanaIso);

  const aprobados = (prop.items ?? []).filter((i) => i.status === "aprobada");
  const slots = await buildSlotsDesdeItemsAprobados(aprobados);

  const weekPart = semanaIso.split("-W")[1] ?? "";
  const semanaLabel = `Semana ${parseInt(weekPart, 10) || weekPart} — ${start.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  })} al ${end.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}`;

  const progRef = db.collection(COLLECTIONS.programa_semanal).doc(programaId);
  const progSnap = await progRef.get();

  if (progSnap.exists) {
    const raw = progSnap.data() as Record<string, unknown>;
    const origenPrev = raw.propuestaOrigenId as string | undefined;
    const statusPrev = raw.status as string | undefined;
    const slotsPrev = Array.isArray(raw.slots) ? raw.slots.length : 0;

    if (!origenPrev && slotsPrev > 0) {
      throw new AppError(
        "CONFLICT",
        "Ya existe un programa semanal cargado manualmente para esta semana. No se puede sobrescribir desde la propuesta.",
      );
    }
    if ((statusPrev === "con_ots" || statusPrev === "cerrada") && origenPrev !== propuestaId) {
      throw new AppError(
        "CONFLICT",
        "El programa ya fue consolidado con otro origen. No se puede sobrescribir desde esta propuesta.",
      );
    }
  }

  const base: Record<string, unknown> = {
    id: programaId,
    semanaLabel,
    fechaInicio: Timestamp.fromDate(start),
    fechaFin: Timestamp.fromDate(end),
    centro,
    slots,
    status: "publicado",
    propuestaOrigenId: propuestaId,
    generadoAutomaticamente: true,
    updated_at: FieldValue.serverTimestamp(),
  };

  if (!progSnap.exists) {
    base.createdAt = FieldValue.serverTimestamp();
  }

  await progRef.set(base, { merge: true });

  const planIdsIncluidos = [
    ...new Set(
      aprobados
        .map((i) => i.plan_id?.trim())
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  if (planIdsIncluidos.length) {
    const chunk = 400;
    for (let i = 0; i < planIdsIncluidos.length; i += chunk) {
      const slice = planIdsIncluidos.slice(i, i + chunk);
      const refs = slice.map((id) => db.collection(COLLECTIONS.avisos).doc(id));
      const snaps = await db.getAll(...refs);
      const batch = db.batch();
      let ops = 0;
      for (const s of snaps) {
        if (!s.exists) continue;
        batch.update(s.ref, {
          incluido_en_semana: semanaIso,
          updated_at: FieldValue.serverTimestamp(),
        } as Record<string, unknown>);
        ops += 1;
      }
      if (ops) await batch.commit();
    }
  }

  return programaId;
}

/**
 * Genera OTs preventivas y reubica correctivos según slots (idempotente donde aplica).
 */
export async function generarOtsDesdePrograma(
  programaId: string,
  actorUid: string,
): Promise<{ creadas: string[]; actualizadas: number }> {
  const uid = actorUid.trim();
  if (!uid) {
    throw new AppError("VALIDATION", "actorUid requerido para generar OTs");
  }

  const db = getAdminDb();
  const pref = db.collection(COLLECTIONS.programa_semanal).doc(programaId);
  const snap = await pref.get();
  if (!snap.exists) {
    throw new AppError("NOT_FOUND", "Programa no encontrado");
  }
  const data = snap.data() as ProgramaSemana & { slots?: SlotSemanal[] };
  const creadas: string[] = [];
  let actualizadas = 0;

  for (const slot of data.slots ?? []) {
    for (const av of slot.avisos ?? []) {
      const woId = av.workOrderId?.trim();
      if (woId) {
        await updateWorkOrderDoc(woId, {
          fecha_inicio_programada: slot.fecha as Timestamp,
          ...(slot.tecnicoSugeridoUid
            ? {
                tecnico_asignado_uid: slot.tecnicoSugeridoUid,
                tecnico_asignado_nombre: slot.tecnicoSugeridoNombre ?? "",
              }
            : {}),
        });
        actualizadas += 1;
        continue;
      }

      const aid = av.avisoFirestoreId?.trim();
      if (!aid) continue;

      const aviso = await getAvisoById(aid);
      if (!aviso) continue;
      if (aviso.work_order_id) continue;

      try {
        const id = await createWorkOrderFromAviso({
          avisoId: aid,
          actorUid: uid,
          fecha_inicio_programada: slot.fecha as Timestamp,
          tecnico_asignado_uid: slot.tecnicoSugeridoUid,
          tecnico_asignado_nombre: slot.tecnicoSugeridoNombre,
          sincronizarPlanPendiente: true,
        });
        creadas.push(id);
      } catch (e) {
        if (e instanceof AppError && e.code === "CONFLICT") continue;
        throw e;
      }
    }
  }

  await pref.set(
    {
      status: "con_ots",
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>,
    { merge: true },
  );

  return { creadas, actualizadas };
}

async function guardarAprendizajePrograma(input: {
  programaId: string;
  propuestaId: string;
  centro: string;
  semana: string;
  itemsAntes: OtPropuestaFirestore[];
  itemsDespues: OtPropuestaFirestore[];
  itemIdsAprobadosEnEstaAccion: string[];
  aprobacionAutomatica: boolean;
}): Promise<void> {
  const db = getAdminDb();
  const ref = db
    .collection(COLLECTIONS.programa_semanal)
    .doc(input.programaId)
    .collection(APRENDIZAJE_SUB)
    .doc(randomUUID());
  await ref.set({
    propuestaId: input.propuestaId,
    centro: input.centro,
    semana: input.semana,
    propuestaOriginalItems: input.itemsAntes,
    itemsTrasAprobacion: input.itemsDespues,
    itemIdsAprobadosEnEstaAccion: input.itemIdsAprobadosEnEstaAccion,
    ajustes: [],
    aprobacionAutomatica: input.aprobacionAutomatica,
    creadaEn: FieldValue.serverTimestamp(),
  } as Record<string, unknown>);
}

async function registrarEventoHistorialPrograma(programaId: string, payload: Record<string, unknown>): Promise<void> {
  const db = getAdminDb();
  await db
    .collection(COLLECTIONS.programa_semanal)
    .doc(programaId)
    .collection(HISTORIAL_SUB)
    .add({
      ...payload,
      creadaEn: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
}

export type EjecutarPuenteInput = {
  propuestaId: string;
  actorUid: string;
  registroAprendizaje: {
    itemsAntes: OtPropuestaFirestore[];
    itemIdsAprobadosEnEstaAccion: string[];
  } | null;
  aprobacionAutomatica: boolean;
};

export async function ejecutarPuentePropuestaAPrograma(input: EjecutarPuenteInput): Promise<{
  programaId: string;
  creadas: string[];
  actualizadas: number;
}> {
  const programaId = await sincronizarProgramaDesdePropuesta(input.propuestaId);
  const { creadas, actualizadas } = await generarOtsDesdePrograma(programaId, input.actorUid);

  const db = getAdminDb();
  const pSnap = await db.collection(COLLECTIONS.propuestas_semana).doc(input.propuestaId).get();
  const prop = pSnap.exists
    ? ({ id: pSnap.id, ...(pSnap.data() as Omit<PropuestaSemanaFirestore, "id">) } as PropuestaSemanaFirestore)
    : null;

  if (input.registroAprendizaje && prop) {
    const itemsDespues = prop.items ?? [];
    await guardarAprendizajePrograma({
      programaId,
      propuestaId: input.propuestaId,
      centro: prop.centro,
      semana: prop.semana,
      itemsAntes: input.registroAprendizaje.itemsAntes,
      itemsDespues,
      itemIdsAprobadosEnEstaAccion: input.registroAprendizaje.itemIdsAprobadosEnEstaAccion,
      aprobacionAutomatica: input.aprobacionAutomatica,
    });
  }

  await registrarEventoHistorialPrograma(programaId, {
    tipo: "programa_publicado",
    propuestaOrigenId: input.propuestaId,
    actorUid: input.actorUid,
    creadasOtIds: creadas,
    actualizadasCorrectivos: actualizadas,
    aprobacionAutomatica: input.aprobacionAutomatica,
  } as Record<string, unknown>);

  if (input.aprobacionAutomatica) {
    await db
      .collection(COLLECTIONS.programa_semanal)
      .doc(programaId)
      .set({ aprobadoAutomaticamente: true } as Record<string, unknown>, { merge: true });
  }

  return { programaId, creadas, actualizadas };
}
