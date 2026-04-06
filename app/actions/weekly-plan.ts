"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import {
  addWeeklyPlanRow,
  patchWeeklyPlanRow,
  removeWeeklyPlanRow,
  replaceWeeklyPlanRows,
} from "@/modules/scheduling/service";
import type { WeeklyPlanRow } from "@/modules/scheduling/types";
import { z } from "zod";

const planRowImportSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  rows: z.array(
    z.object({
      dia_semana: z.number().int().min(1).max(7),
      localidad: z.string(),
      especialidad: z.string(),
      texto: z.string(),
      orden: z.number().int().min(0),
    }),
  ),
});

const addPlanRowSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  dia_semana: z.number().int().min(1).max(7),
  localidad: z.string().min(1),
  especialidad: z.string().min(1),
  texto: z.string().min(1),
});

const patchPlanRowSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  rowId: z.string().min(1),
  localidad: z.string().optional(),
  especialidad: z.string().optional(),
  texto: z.string().optional(),
  dia_semana: z.number().int().min(1).max(7).optional(),
});

const deletePlanRowSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  rowId: z.string().min(1),
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

/** Reemplaza todas las filas de plan textual de la semana (no borra OTs agendadas). */
export async function actionReplaceWeeklyPlanRows(
  idToken: string,
  input: z.infer<typeof planRowImportSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const profile = await requirePermisoFromToken(idToken, "programa:editar");
    const parsed = planRowImportSchema.parse(input);
    await replaceWeeklyPlanRows({
      weekId: parsed.weekId,
      centroEsperado: profile.centro,
      rows: parsed.rows.map((r) => ({
        ...r,
        dia_semana: r.dia_semana as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      })),
    });
  });
}

export async function actionAddWeeklyPlanRow(
  idToken: string,
  input: z.infer<typeof addPlanRowSchema>,
): Promise<ActionResult<{ rowId: string }>> {
  return wrap(async () => {
    const profile = await requirePermisoFromToken(idToken, "programa:editar");
    const parsed = addPlanRowSchema.parse(input);
    const rowId = await addWeeklyPlanRow({
      weekId: parsed.weekId,
      centroEsperado: profile.centro,
      dia_semana: parsed.dia_semana as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      localidad: parsed.localidad,
      especialidad: parsed.especialidad,
      texto: parsed.texto,
    });
    return { rowId };
  });
}

export async function actionPatchWeeklyPlanRow(
  idToken: string,
  input: z.infer<typeof patchPlanRowSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const profile = await requirePermisoFromToken(idToken, "programa:editar");
    const parsed = patchPlanRowSchema.parse(input);
    const { weekId, rowId, ...rest } = parsed;
    const patch: Partial<Pick<WeeklyPlanRow, "localidad" | "especialidad" | "texto" | "dia_semana">> = {};
    if (rest.localidad !== undefined) patch.localidad = rest.localidad;
    if (rest.especialidad !== undefined) patch.especialidad = rest.especialidad;
    if (rest.texto !== undefined) patch.texto = rest.texto;
    if (rest.dia_semana !== undefined) {
      patch.dia_semana = rest.dia_semana as WeeklyPlanRow["dia_semana"];
    }
    if (Object.keys(patch).length === 0) {
      throw new AppError("VALIDATION", "Nada para actualizar");
    }
    await patchWeeklyPlanRow({
      weekId,
      rowId,
      centroEsperado: profile.centro,
      patch,
    });
  });
}

export async function actionDeleteWeeklyPlanRow(
  idToken: string,
  input: z.infer<typeof deletePlanRowSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const profile = await requirePermisoFromToken(idToken, "programa:editar");
    const parsed = deletePlanRowSchema.parse(input);
    await removeWeeklyPlanRow({
      weekId: parsed.weekId,
      rowId: parsed.rowId,
      centroEsperado: profile.centro,
    });
  });
}
