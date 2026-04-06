"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { removeWeekSlot, scheduleWorkOrderInWeek } from "@/modules/scheduling/service";
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
