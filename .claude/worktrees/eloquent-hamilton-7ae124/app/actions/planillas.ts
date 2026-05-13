"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { hasAdminCapabilities } from "@/modules/users/roles";
import type { PlanillaRespuesta } from "@/lib/firestore/types";
import {
  firmarPlanillaService,
  guardarBorradorPlanillaService,
  iniciarPlanillaService,
} from "@/modules/planillas/service";
import { getPlanillaRespuestaAdmin } from "@/modules/work-orders/repository";
import { z } from "zod";

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

const firmasSchema = z.object({
  firmaUsuario: z.string().min(80),
  firmaUsuarioNombre: z.string().min(1).max(200),
  firmaUsuarioLegajo: z.string().max(80).optional().default(""),
  firmaResponsable: z.string().min(80),
  firmaResponsableNombre: z.string().min(1).max(200),
});

export async function iniciarPlanilla(
  idToken: string,
  input: { otId: string },
): Promise<ActionResult<{ respuesta: Pick<PlanillaRespuesta, "id" | "templateId" | "status">; existing: boolean }>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:completar_planilla");
    const { respuestaId, existing, templateId } = await iniciarPlanillaService({
      workOrderId: input.otId,
      actorUid: session.uid,
    });
    let status: PlanillaRespuesta["status"] = "borrador";
    if (existing) {
      const doc = await getPlanillaRespuestaAdmin(input.otId, respuestaId);
      status = doc?.status ?? "borrador";
    }
    return {
      respuesta: { id: respuestaId, templateId, status },
      existing,
    };
  });
}

export async function guardarBorradorPlanilla(
  idToken: string,
  input: { otId: string; respuestaId: string; datos: Partial<PlanillaRespuesta> },
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:completar_planilla");
    await guardarBorradorPlanillaService({
      workOrderId: input.otId,
      respuestaId: input.respuestaId,
      actorUid: session.uid,
      patch: input.datos,
    });
  });
}

export async function firmarPlanilla(
  idToken: string,
  input: { otId: string; respuestaId: string; firmas: z.infer<typeof firmasSchema> },
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:firmar_cerrar");
    const firmas = firmasSchema.parse(input.firmas);
    await firmarPlanillaService({
      workOrderId: input.otId,
      respuestaId: input.respuestaId,
      actorUid: session.uid,
      isAdmin: hasAdminCapabilities(session.rol),
      firmas: {
        ...firmas,
        firmaUsuarioLegajo: firmas.firmaUsuarioLegajo ?? "",
      },
    });
  });
}
