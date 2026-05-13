"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { toPermisoRol } from "@/lib/permisos/index";
import { getAvisoById, updateAviso } from "@/modules/notices/repository";
import { usuarioTieneCentro } from "@/modules/users/centros-usuario";
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

const editAvisoSchema = z.object({
  avisoId: z.string().min(1),
  texto_corto: z.string().max(500),
  centro: z.string().max(20),
  especialidad: z.enum(["AA", "ELECTRICO", "GG", "HG"]),
  estado_planilla: z.string().max(50).optional().nullable(),
});

/**
 * Edición inline de campos básicos de un aviso desde la tabla de configuración.
 * Requiere permiso `admin:cargar_programa`. Un admin solo puede editar avisos
 * de su propio centro; el superadmin puede editar cualquiera.
 */
export async function actionEditAviso(
  idToken: string,
  input: z.infer<typeof editAvisoSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "admin:cargar_programa");
    const parsed = editAvisoSchema.parse(input);

    const aviso = await getAvisoById(parsed.avisoId);
    if (!aviso) {
      throw new AppError("NOT_FOUND", "Aviso no encontrado.");
    }

    const rol = toPermisoRol(session.rol);
    if (rol !== "superadmin" && !usuarioTieneCentro(session, aviso.centro)) {
      throw new AppError("FORBIDDEN", "No podés editar un aviso de otro centro.");
    }

    await updateAviso(parsed.avisoId, {
      texto_corto: parsed.texto_corto.trim(),
      centro: parsed.centro.trim(),
      especialidad: parsed.especialidad,
      estado_planilla: parsed.estado_planilla?.trim() || undefined,
    });
  });
}
