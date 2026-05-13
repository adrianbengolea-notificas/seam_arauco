"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { OtPropuestaFirestore, PropuestaSemanaFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { toPermisoRol } from "@/lib/permisos/index";
import { ejecutarPuentePropuestaAPrograma } from "@/modules/scheduling/programa-propuesta-bridge";
import { addAvisoToPublishedPrograma, removeWeekSlot, scheduleWorkOrderInWeek } from "@/modules/scheduling/service";
import type { DiaSemanaPrograma } from "@/modules/scheduling/types";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

const scheduleInputSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  workOrderId: z.string().min(1),
  dia_semana: z.number().int().min(1).max(7),
  turno: z.enum(["A", "B", "C"]).optional(),
});

const removeSlotSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  slotId: z.string().min(1),
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
    const slotId = await scheduleWorkOrderInWeek({
      weekId: parsed.weekId,
      workOrderId: parsed.workOrderId,
      dia_semana: parsed.dia_semana as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      turno: parsed.turno,
      centroEsperado: profile.centro,
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

const addAvisoProgramaSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  avisoFirestoreId: z.string().min(1),
  dia: z.enum(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"]),
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

const aprobarPropuestaSchema = z.object({
  propuestaId: z.string().min(1),
  itemIds: z.array(z.string()).min(1),
});

/**
 * Marca ítems como aprobados, sincroniza `programa_semanal`, genera OTs (idempotente) y registra aprendizaje / historial.
 */
export async function actionAprobarItemsPropuestaMotor(
  idToken: string,
  input: z.infer<typeof aprobarPropuestaSchema>,
): Promise<ActionResult<{ creadas: string[]; actualizadas: number; programaId: string; mensaje: string }>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "programa:crear_ot");
    const parsed = aprobarPropuestaSchema.parse(input);
    const db = getAdminDb();
    const ref = db.collection(COLLECTIONS.propuestas_semana).doc(parsed.propuestaId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new AppError("NOT_FOUND", "Propuesta no encontrada");
    }
    const data = { id: snap.id, ...(snap.data() as Omit<PropuestaSemanaFirestore, "id">) };
    const rol = toPermisoRol(session.rol);
    if (rol !== "superadmin" && data.centro !== session.centro) {
      throw new AppError("FORBIDDEN", "La propuesta es de otro centro");
    }

    const statusAntes = data.status;
    const itemsAntes = structuredClone(data.items ?? []) as OtPropuestaFirestore[];

    const nextItems: OtPropuestaFirestore[] = [];
    for (const item of data.items ?? []) {
      if (!parsed.itemIds.includes(item.id) || item.status !== "propuesta") {
        nextItems.push(item);
        continue;
      }
      nextItems.push({ ...item, status: "aprobada" });
    }

    const pendiente = nextItems.some((i) => i.status === "propuesta");
    await ref.update({
      items: nextItems,
      status: pendiente ? "pendiente_aprobacion" : "aprobada",
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);

    let puente: { programaId: string; creadas: string[]; actualizadas: number };
    try {
      puente = await ejecutarPuentePropuestaAPrograma({
        propuestaId: parsed.propuestaId,
        actorUid: session.uid,
        registroAprendizaje: {
          itemsAntes,
          itemIdsAprobadosEnEstaAccion: parsed.itemIds,
        },
        aprobacionAutomatica: false,
      });
    } catch (e) {
      await ref.update({
        items: itemsAntes,
        status: statusAntes,
        updated_at: FieldValue.serverTimestamp(),
      } as Record<string, unknown>);
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
    if (rol !== "superadmin" && data.centro !== session.centro) {
      throw new AppError("FORBIDDEN", "La propuesta es de otro centro");
    }
    const nextItems = (data.items ?? []).map((item) =>
      item.id === parsed.itemId && item.status === "propuesta"
        ? { ...item, status: "rechazada" as const }
        : item,
    );
    await ref.update({
      items: nextItems,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
  });
}
