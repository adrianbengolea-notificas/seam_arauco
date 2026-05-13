"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { runMotorOtDiario, type MotorOtDiarioResult } from "@/lib/motor/motor-ot-diario";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { isSuperAdminRole } from "@/modules/users/roles";
import { FieldValue } from "firebase-admin/firestore";
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

const ejecutarMotorSchema = z.object({
  centro: z.string().trim().optional(),
  /** Semana ISO de la propuesta (ej. 2026-W18). Si se omite, usa la semana actual. */
  semanaId: z.string().regex(/^\d{4}-W\d{2}$/).optional(),
});

/**
 * Admin de planta o superadmin: ejecuta el motor como el cron (misma lógica; publicación de grilla siempre manual).
 * Si `centro` está vacío, corre todos los centros conocidos.
 */
export async function actionEjecutarMotorManual(
  idToken: string,
  input: z.infer<typeof ejecutarMotorSchema>,
): Promise<ActionResult<MotorOtDiarioResult>> {
  return wrap(async () => {
    await requirePermisoFromToken(idToken, "admin:gestionar_usuarios");
    const parsed = ejecutarMotorSchema.parse(input);
    const c = parsed.centro?.trim();
    const semanaId = parsed.semanaId?.trim();
    const base = { bypassIdempotencia: true as const, ...(semanaId ? { semanaId } : {}) };
    return await runMotorOtDiario(c ? { centros: [c], ...base } : base);
  });
}

const resetPropuestaSchema = z.object({
  centro: z.string().min(1),
  semanaId: z.string().regex(/^\d{4}-W\d{2}$/),
});

/**
 * Solo superadmin: deja la propuesta en blanco pendiente y vuelve a generar con el motor para ese centro.
 */
export async function actionResetearPropuestaSemanaMotor(
  idToken: string,
  input: z.infer<typeof resetPropuestaSchema>,
): Promise<ActionResult<MotorOtDiarioResult>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "admin:feature_flags");
    if (!isSuperAdminRole(session.rol)) {
      throw new AppError("FORBIDDEN", "Solo superadmin puede resetear propuestas del motor.");
    }
    const parsed = resetPropuestaSchema.parse(input);
    const centro = parsed.centro.trim();
    const propuestaId = propuestaSemanaDocId(centro, parsed.semanaId);

    const db = getAdminDb();
    const ref = db.collection(COLLECTIONS.propuestas_semana).doc(propuestaId);
    await ref.set(
      {
        id: propuestaId,
        centro,
        semana: parsed.semanaId,
        status: "pendiente_aprobacion",
        items: [],
        aprobado_automaticamente: false,
        advertencias: [],
        generada_en: FieldValue.delete(),
        metricas: FieldValue.delete(),
        updated_at: FieldValue.serverTimestamp(),
      } as Record<string, unknown>,
      { merge: true },
    );

    return await runMotorOtDiario({ centros: [centro], semanaId: parsed.semanaId, bypassIdempotencia: true });
  });
}
