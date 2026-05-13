"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { OtPropuestaFirestore, PropuestaSemanaFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import { requireAnyPermisoFromToken, requirePermisoFromToken } from "@/lib/permisos/server";
import { toPermisoRol } from "@/lib/permisos/index";
import { centrosEfectivosDelUsuario, usuarioTieneCentro } from "@/modules/users/centros-usuario";
import type { UserProfileWithUid } from "@/modules/users/repository";
import { stablePropuestaItemId } from "@/lib/scheduling/propuesta-id";
import { ejecutarPuentePropuestaAPrograma } from "@/modules/scheduling/programa-propuesta-bridge";
import {
  addAvisoToPublishedPrograma,
  moveAvisoInPublishedPrograma,
  moveWeekSlotBetweenDays,
  removeWeekSlot,
  scheduleWorkOrderInWeek,
} from "@/modules/scheduling/service";
import { getWorkOrderById } from "@/modules/work-orders/repository";
import {
  searchWorkOrdersForWeeklyAgendaAdmin,
  type WorkOrderAgendaSearchRow,
} from "@/modules/work-orders/search-weekly-agenda-admin";
import type { DiaSemanaPrograma } from "@/modules/scheduling/types";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const scheduleInputSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  workOrderId: z.string().min(1),
  dia_semana: z.number().int().min(1).max(7),
  turno: z.enum(["A", "B", "C"]).optional(),
});

/** Centros donde puede buscar OTs para agenda (superadmin = conocidos en env; resto = perfil). */
function centrosConsultaAgenda(session: UserProfileWithUid): string[] {
  const rol = toPermisoRol(session.rol);
  if (rol === "superadmin") return [...KNOWN_CENTROS];
  return centrosEfectivosDelUsuario(session);
}

const removeSlotSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  slotId: z.string().min(1),
});

const moveWeekSlotSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  slotId: z.string().min(1),
  dia_semana: z.number().int().min(1).max(7),
});

function wrap<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  return fn()
    .then((data) => success(data))
    .catch((e: unknown) => {
      if (isAppError(e)) return Promise.resolve(failure(e));
      const err = new AppError("INTERNAL", e instanceof Error ? e.message : "Error interno", {
        cause: e,
      });
      return Promise.resolve(failure(err));
    });
}

export async function actionScheduleWorkOrderInWeek(
  idToken: string,
  input: z.infer<typeof scheduleInputSchema>,
): Promise<ActionResult<{ slotId: string }>> {
  return wrap(async () => {
    const profile = await requirePermisoFromToken(idToken, "programa:crear_ot");
    const parsed = scheduleInputSchema.parse(input);
    const wo = await getWorkOrderById(parsed.workOrderId);
    if (!wo) {
      throw new AppError("NOT_FOUND", "OT no encontrada");
    }
    const rol = toPermisoRol(profile.rol);
    const cOt = String(wo.centro ?? "").trim();
    if (!cOt) {
      throw new AppError("VALIDATION", "La OT no tiene centro definido");
    }
    if (rol !== "superadmin" && !usuarioTieneCentro(profile, cOt)) {
      throw new AppError("FORBIDDEN", "No podés agendar OTs de ese centro");
    }
    const slotId = await scheduleWorkOrderInWeek({
      weekId: parsed.weekId,
      workOrderId: parsed.workOrderId,
      dia_semana: parsed.dia_semana as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      turno: parsed.turno,
    });
    return { slotId };
  });
}

export async function actionRemoveWeekSlot(
  idToken: string,
  input: z.infer<typeof removeSlotSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    await requirePermisoFromToken(idToken, "programa:crear_ot");
    const parsed = removeSlotSchema.parse(input);
    await removeWeekSlot({ weekId: parsed.weekId, slotId: parsed.slotId });
  });
}

/** Mueve una OT agendada a otro día de la misma semana ISO (calendario + grilla publicada). */
export async function actionMoveWeekSlotToDay(
  idToken: string,
  input: z.infer<typeof moveWeekSlotSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const profile = await requirePermisoFromToken(idToken, "programa:crear_ot");
    const parsed = moveWeekSlotSchema.parse(input);
    await moveWeekSlotBetweenDays({
      weekId: parsed.weekId,
      slotId: parsed.slotId,
      dia_semana: parsed.dia_semana as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      viewer: profile,
    });
  });
}

const addAvisoProgramaSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  avisoFirestoreId: z.string().min(1),
  dia: z.enum(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]),
  localidad: z.string().optional(),
});

/** Publica un aviso en la grilla `programa_semanal` (supervisor+). */
export async function actionAddAvisoToProgramaPublicado(
  idToken: string,
  input: z.infer<typeof addAvisoProgramaSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "programa:crear_ot");
    const parsed = addAvisoProgramaSchema.parse(input);
    await addAvisoToPublishedPrograma({
      semanaId: parsed.weekId,
      avisoFirestoreId: parsed.avisoFirestoreId,
      dia: parsed.dia as DiaSemanaPrograma,
      localidad: parsed.localidad,
      session,
    });
  });
}

const diaProgramaEnum = z.enum([
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
]);
const moverAvisoProgramaPublicadoSchema = z.object({
  sourceProgramaDocId: z.string().min(1),
  destProgramaDocId: z.string().min(1),
  avisoNumero: z.string().min(1),
  avisoFirestoreId: z.string().optional(),
  destDia: diaProgramaEnum,
  from: z.object({
    localidad: z.string(),
    dia: diaProgramaEnum,
    especialidad: z.enum(["Aire", "Electrico", "GG"]),
  }),
});

/** Mueve un aviso a otro día y/u otra semana en la grilla publicada `programa_semanal`. */
export async function actionMoveAvisoEnProgramaPublicado(
  idToken: string,
  input: z.infer<typeof moverAvisoProgramaPublicadoSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requireAnyPermisoFromToken(idToken, ["programa:crear_ot", "programa:editar"]);
    const parsed = moverAvisoProgramaPublicadoSchema.parse(input);
    await moveAvisoInPublishedPrograma({
      session,
      sourceProgramaDocId: parsed.sourceProgramaDocId.trim(),
      destProgramaDocId: parsed.destProgramaDocId.trim(),
      avisoNumero: parsed.avisoNumero.trim(),
      avisoFirestoreId: parsed.avisoFirestoreId?.trim() ? parsed.avisoFirestoreId.trim() : undefined,
      from: parsed.from,
      destDia: parsed.destDia as DiaSemanaPrograma,
    });
  });
}

const aprobarPropuestaSchema = z.object({
  propuestaId: z.string().min(1),
  itemIds: z.array(z.string()).min(1),
});

/**
 * Aprueba ítems de la propuesta del motor y en la misma transacción de negocio:
 * `ejecutarPuentePropuestaAPrograma` → sincroniza `programa_semanal`, `generarOtsDesdePrograma` (idempotente),
 * subcolección `aprendizaje` e `historial_eventos` en el programa.
 */
export async function actionAprobarItemsPropuestaMotor(
  idToken: string,
  input: z.infer<typeof aprobarPropuestaSchema>,
): Promise<ActionResult<{ creadas: string[]; actualizadas: number; programaId: string; mensaje: string }>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "programa:crear_ot");
    const parsed = aprobarPropuestaSchema.parse(input);
    const itemIds = [
      ...new Set(parsed.itemIds.map((x) => String(x).trim()).filter((x) => x.length > 0)),
    ];
    if (itemIds.length === 0) {
      throw new AppError("VALIDATION", "Tenés que indicar al menos un ítem para aprobar.");
    }
    const db = getAdminDb();
    const ref = db.collection(COLLECTIONS.propuestas_semana).doc(parsed.propuestaId);
    const mutUid = randomUUID();

    const { itemsAntes, statusAntes, itemIdsParaAprendizaje } = await db.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) {
        throw new AppError("NOT_FOUND", "Propuesta no encontrada");
      }
      const data = { id: snap.id, ...(snap.data() as Omit<PropuestaSemanaFirestore, "id">) };
      const rol = toPermisoRol(session.rol);
      if (rol !== "superadmin" && !usuarioTieneCentro(session, data.centro)) {
        throw new AppError("FORBIDDEN", "La propuesta es de otro centro");
      }

      const antes = structuredClone(data.items ?? []) as OtPropuestaFirestore[];
      const stAntes = data.status;
      const itemIdsSet = new Set(itemIds);

      let coincidencias = 0;
      for (let idx = 0; idx < (data.items ?? []).length; idx++) {
        const item = (data.items ?? [])[idx]!;
        const sid = stablePropuestaItemId(data.id, item.id, idx);
        if (item.status === "propuesta" && itemIdsSet.has(sid)) coincidencias += 1;
      }
      if (coincidencias === 0) {
        throw new AppError(
          "VALIDATION",
          "Ningún ítem pendiente coincide con la selección. Actualizá la página y volvé a marcar los ítems.",
        );
      }

      const nextItems: OtPropuestaFirestore[] = (data.items ?? []).map((item, idx) => {
        const sid = stablePropuestaItemId(data.id, item.id, idx);
        const withId: OtPropuestaFirestore = { ...item, id: sid };
        if (withId.status === "propuesta" && itemIdsSet.has(sid)) {
          return { ...withId, status: "aprobada" };
        }
        return withId;
      });

      const pendiente = nextItems.some((i) => i.status === "propuesta");
      txn.update(ref, {
        items: nextItems,
        status: pendiente ? "pendiente_aprobacion" : "aprobada",
        aprobacion_mut_uid: mutUid,
        updated_at: FieldValue.serverTimestamp(),
      } as Record<string, unknown>);

      return {
        itemsAntes: antes,
        statusAntes: stAntes,
        itemIdsParaAprendizaje: itemIds,
      };
    });

    let puente: { programaId: string; creadas: string[]; actualizadas: number };
    try {
      puente = await ejecutarPuentePropuestaAPrograma({
        propuestaId: parsed.propuestaId,
        actorUid: session.uid,
        registroAprendizaje: {
          itemsAntes,
          itemIdsAprobadosEnEstaAccion: itemIdsParaAprendizaje,
        },
        aprobacionAutomatica: false,
      });
    } catch (e) {
      await db.runTransaction(async (txn) => {
        const s = await txn.get(ref);
        if (!s.exists) return;
        const d = s.data() as Record<string, unknown> | undefined;
        if (d?.aprobacion_mut_uid !== mutUid) return;
        txn.update(ref, {
          items: itemsAntes,
          status: statusAntes,
          updated_at: FieldValue.serverTimestamp(),
          aprobacion_mut_uid: FieldValue.delete(),
        } as Record<string, unknown>);
      });
      throw e;
    }

    const n = puente.creadas.length;
    const m = puente.actualizadas;
    return {
      creadas: puente.creadas,
      actualizadas: puente.actualizadas,
      programaId: puente.programaId,
      mensaje: `Programa publicado (${puente.programaId}). OTs nuevas: ${n}. Correctivos actualizados: ${m}.`,
    };
  });
}

const rechazarItemPropuestaSchema = z.object({
  propuestaId: z.string().min(1),
  itemId: z.string().min(1),
});

export async function actionRechazarItemPropuestaMotor(
  idToken: string,
  input: z.infer<typeof rechazarItemPropuestaSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "programa:crear_ot");
    const parsed = rechazarItemPropuestaSchema.parse(input);
    const db = getAdminDb();
    const ref = db.collection(COLLECTIONS.propuestas_semana).doc(parsed.propuestaId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "Propuesta no encontrada");
    }
    const data = { id: snap.id, ...(snap.data() as Omit<PropuestaSemanaFirestore, "id">) };
    const rol = toPermisoRol(session.rol);
    if (rol !== "superadmin" && !usuarioTieneCentro(session, data.centro)) {
      throw new AppError("FORBIDDEN", "La propuesta es de otro centro");
    }
    const nextItems = (data.items ?? []).map((item, idx) => {
      const sid = stablePropuestaItemId(data.id, item.id, idx);
      const base: OtPropuestaFirestore = { ...item, id: sid };
      if (sid === parsed.itemId && base.status === "propuesta") {
        return { ...base, status: "rechazada" as const };
      }
      return base;
    });
    await ref.update({
      items: nextItems,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
  });
}

const rechazarItemsPropuestaSchema = z.object({
  propuestaId: z.string().min(1),
  itemIds: z.array(z.string()).min(1),
});

/** Rechaza varios ítems en un solo update (misma regla que rechazo individual). */
export async function actionRechazarItemsPropuestaMotor(
  idToken: string,
  input: z.infer<typeof rechazarItemsPropuestaSchema>,
): Promise<ActionResult<{ rechazadas: number }>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "programa:crear_ot");
    const parsed = rechazarItemsPropuestaSchema.parse(input);
    const db = getAdminDb();
    const ref = db.collection(COLLECTIONS.propuestas_semana).doc(parsed.propuestaId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "Propuesta no encontrada");
    }
    const data = { id: snap.id, ...(snap.data() as Omit<PropuestaSemanaFirestore, "id">) };
    const rol = toPermisoRol(session.rol);
    if (rol !== "superadmin" && !usuarioTieneCentro(session, data.centro)) {
      throw new AppError("FORBIDDEN", "La propuesta es de otro centro");
    }
    const itemIds = [
      ...new Set(parsed.itemIds.map((x) => String(x).trim()).filter((x) => x.length > 0)),
    ];
    const idSet = new Set(itemIds);
    let rechazadas = 0;
    const nextItems = (data.items ?? []).map((item, idx) => {
      const sid = stablePropuestaItemId(data.id, item.id, idx);
      const base: OtPropuestaFirestore = { ...item, id: sid };
      if (idSet.has(sid) && base.status === "propuesta") {
        rechazadas += 1;
        return { ...base, status: "rechazada" as const };
      }
      return base;
    });
    if (rechazadas === 0) {
      throw new AppError("VALIDATION", "Ningún ítem pendiente coincide con los seleccionados");
    }
    await ref.update({
      items: nextItems,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
    return { rechazadas };
  });
}

const registrarVistaPropuestaSchema = z.object({
  propuestaId: z.string().min(1),
});

/**
 * Registra la primera vez que un supervisor abre la pantalla de aprobación (mitiga alertas “sin revisión”).
 */
export async function actionRegistrarVistaPropuestaSupervisor(
  idToken: string,
  input: z.infer<typeof registrarVistaPropuestaSchema>,
): Promise<ActionResult<{ ok: boolean }>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "programa:crear_ot");
    const parsed = registrarVistaPropuestaSchema.parse(input);
    const db = getAdminDb();
    const ref = db.collection(COLLECTIONS.propuestas_semana).doc(parsed.propuestaId);
    await db.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) return;
      const data = { id: snap.id, ...(snap.data() as Omit<PropuestaSemanaFirestore, "id">) };
      if (data.status !== "pendiente_aprobacion") return;
      if (data.propuesta_vista_supervisor_at) return;
      const rol = toPermisoRol(session.rol);
      if (rol !== "superadmin" && !usuarioTieneCentro(session, data.centro)) {
        throw new AppError("FORBIDDEN", "La propuesta es de otro centro");
      }
      txn.update(ref, {
        propuesta_vista_supervisor_at: FieldValue.serverTimestamp(),
        propuesta_vista_supervisor_uid: session.uid,
        updated_at: FieldValue.serverTimestamp(),
      } as Record<string, unknown>);
    });
    return { ok: true };
  });
}

const searchWoAgendaSchema = z.object({
  /** Si viene vacío u omitido: todos los centros permitidos para el usuario. */
  centro: z.string().max(48).optional(),
  query: z.string().max(120).optional(),
});

/** Órdenes agendables para el programa (búsqueda server-side; respeta visibilidad por rol). */
export async function actionSearchWorkOrdersForAgenda(
  idToken: string,
  input: z.infer<typeof searchWoAgendaSchema>,
): Promise<ActionResult<WorkOrderAgendaSearchRow[]>> {
  return wrap(async () => {
    const session = await requireAnyPermisoFromToken(idToken, ["programa:crear_ot", "programa:editar"]);
    const data = searchWoAgendaSchema.parse(input);
    const raw = (data.centro ?? "").trim();
    const rol = toPermisoRol(session.rol);
    const permitidos = centrosConsultaAgenda(session);
    const centrosBuscar = raw
      ? (() => {
          if (rol !== "superadmin" && !usuarioTieneCentro(session, raw)) {
            throw new AppError("FORBIDDEN", "Centro no permitido para tu usuario");
          }
          return [raw];
        })()
      : permitidos;
    if (centrosBuscar.length === 0) {
      throw new AppError("VALIDATION", "Tu usuario no tiene centros asignados para buscar órdenes");
    }
    return searchWorkOrdersForWeeklyAgendaAdmin({
      centros: centrosBuscar,
      query: (data.query ?? "").trim(),
      viewerUid: session.uid,
      viewerRol: rol,
    });
  });
}
