"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { applyEntradaStockTransaction, getMaterialCatalogItemAdmin } from "@/modules/materials/repository";
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

const entradaSchema = z.object({
  materialId: z.string().min(1),
  cantidad: z.number().positive(),
  origen: z.enum(["ARAUCO", "EXTERNO"]),
  observaciones: z.string().max(2000).optional(),
});

export async function registrarEntradaStock(
  idToken: string,
  input: z.infer<typeof entradaSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "materiales:ingresar_stock");
    const parsed = entradaSchema.parse(input);
    const mat = await getMaterialCatalogItemAdmin(parsed.materialId);
    if (!mat || mat.activo === false) {
      throw new AppError("NOT_FOUND", "Material no encontrado o inactivo");
    }
    await applyEntradaStockTransaction({
      materialId: mat.id,
      codigoMaterial: mat.codigo_material,
      descripcionMaterial: mat.descripcion,
      cantidad: parsed.cantidad,
      unidad: mat.unidad_medida || "unidad",
      origen: parsed.origen,
      observaciones: parsed.observaciones,
      registradoPorUid: session.uid,
    });
  });
}
