"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { getPlanMantenimientoAdmin, updatePlanMesesProgramadosAdmin, updatePlanSemanaAsignadaAdmin } from "@/lib/plan-mantenimiento/admin";
import { requireAnyPermisoFromToken } from "@/lib/permisos/server";
import { toPermisoRol } from "@/lib/permisos/index";
import { usuarioTieneCentro } from "@/modules/users/centros-usuario";
import { z } from "zod";

const actualizarMesesSchema = z.object({
  planId: z.string().min(1),
  meses: z.array(z.number().int().min(1).max(12)),
});

const asignarSemanaSchema = z.object({
  planId: z.string().min(1),
  semanaIso: z.union([z.string().regex(/^\d{4}-W\d{2}$/), z.null()]),
});

function wrap(fn: () => Promise<void>): Promise<ActionResult<{ ok: true }>> {
  return fn()
    .then(() => success({ ok: true as const }))
    .catch((e: unknown) => {
      if (isAppError(e)) return Promise.resolve(failure(e));
      const err = new AppError("INTERNAL", e instanceof Error ? e.message : "Error interno", { cause: e });
      return Promise.resolve(failure(err));
    });
}

/** Actualiza los meses programados de un plan de mantenimiento. */
export async function actionActualizarMesesPlanPreventivo(
  idToken: string,
  input: z.infer<typeof actualizarMesesSchema>,
): Promise<ActionResult<{ ok: true }>> {
  return wrap(async () => {
    const session = await requireAnyPermisoFromToken(idToken, ["programa:crear_ot", "programa:editar"]);
    const parsed = actualizarMesesSchema.parse(input);
    const plan = await getPlanMantenimientoAdmin(parsed.planId);
    if (!plan) {
      throw new AppError("NOT_FOUND", "Plan de mantenimiento no encontrado");
    }
    const centroPlan = String(plan.centro ?? "").trim();
    const rol = toPermisoRol(session.rol);
    if (rol !== "superadmin") {
      if (!centroPlan || !usuarioTieneCentro(session, centroPlan)) {
        throw new AppError("FORBIDDEN", "No podés editar planes de ese centro");
      }
    }
    await updatePlanMesesProgramadosAdmin(parsed.planId, parsed.meses);
  });
}

/** Asigna o limpia `semana_asignada` en `plan_mantenimiento` (solo Admin SDK — reglas cliente read-only). */
export async function actionAsignarSemanaPlanPreventivo(
  idToken: string,
  input: z.infer<typeof asignarSemanaSchema>,
): Promise<ActionResult<{ ok: true }>> {
  return wrap(async () => {
    const session = await requireAnyPermisoFromToken(idToken, ["programa:crear_ot", "programa:editar"]);
    const parsed = asignarSemanaSchema.parse(input);
    const plan = await getPlanMantenimientoAdmin(parsed.planId);
    if (!plan) {
      throw new AppError("NOT_FOUND", "Plan de mantenimiento no encontrado");
    }
    const centroPlan = String(plan.centro ?? "").trim();
    const rol = toPermisoRol(session.rol);
    if (rol !== "superadmin") {
      if (!centroPlan || !usuarioTieneCentro(session, centroPlan)) {
        throw new AppError("FORBIDDEN", "No podés editar planes de ese centro");
      }
    }

    await updatePlanSemanaAsignadaAdmin(parsed.planId, parsed.semanaIso);
  });
}
