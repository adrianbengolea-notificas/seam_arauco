"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { getCentroConfigMergedCached } from "@/modules/centros/config-cache";
import { runGenerateWorkReport } from "@/lib/ai/flows/generate-work-report";
import {
  applySalidaStockPorOtTransaction,
  createMaterialCatalogAdmin,
  getMaterialCatalogItemAdmin,
} from "@/modules/materials/repository";
import { getMaterialOtLineAdmin, updateMaterialOtLineAdmin } from "@/modules/work-orders/repository";
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

const draftSchema = z.object({
  keywords: z.string().min(1).max(8_000),
  fieldType: z.enum(["trabajo_realizado", "observaciones"]),
  assetLabel: z.string().min(1).max(500),
  otN: z.string().min(1).max(64),
});

/** Borrador de texto con Genkit (requiere API key de Google GenAI en el servidor). */
export async function actionGenerateWorkReportDraft(
  idToken: string,
  input: z.infer<typeof draftSchema>,
): Promise<ActionResult<{ text: string }>> {
  return wrap(async () => {
    const profile = await requirePermisoFromToken(idToken, "historial:informe_ia");
    const cfg = await getCentroConfigMergedCached(profile.centro);
    if (!cfg.modulos.ia) {
      throw new AppError("FORBIDDEN", "El módulo de IA está deshabilitado para este centro");
    }
    const parsed = draftSchema.parse(input);
    const out = await runGenerateWorkReport(parsed);
    return { text: out.generatedText };
  });
}

const confirmMatchSchema = z.object({
  workOrderId: z.string().min(1),
  lineId: z.string().min(1),
  catalogoId: z.string().min(1),
});

export async function confirmarMatchMaterial(
  idToken: string,
  input: z.infer<typeof confirmMatchSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "materiales:revisar_ia");
    const parsed = confirmMatchSchema.parse(input);
    const line = await getMaterialOtLineAdmin(parsed.workOrderId, parsed.lineId);
    if (!line || line.schema_version !== 1) {
      throw new AppError("NOT_FOUND", "Ítem de material no encontrado");
    }
    if (
      line.normalizacion !== "revision_pendiente" &&
      line.normalizacion !== "sin_match" &&
      line.normalizacion !== "pendiente"
    ) {
      throw new AppError("VALIDATION", "Este ítem no admite confirmación manual de catálogo");
    }
    const mat = await getMaterialCatalogItemAdmin(parsed.catalogoId);
    if (!mat || mat.activo === false) {
      throw new AppError("NOT_FOUND", "Material de catálogo no válido");
    }
    const cantidad = Number(line.cantidad ?? 0);
    const unidad = String(line.unidad ?? "u");
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new AppError("VALIDATION", "Cantidad inválida en el ítem");
    }
    await applySalidaStockPorOtTransaction({
      materialId: mat.id,
      codigoMaterial: mat.codigo_material,
      descripcionMaterial: mat.descripcion,
      cantidad,
      unidad,
      otId: parsed.workOrderId,
      registradoPorUid: session.uid,
    });
    await updateMaterialOtLineAdmin(parsed.workOrderId, parsed.lineId, {
      catalogo_id: mat.id,
      codigo_material: mat.codigo_material,
      descripcion_match: mat.descripcion,
      normalizacion: "confirmada",
    });
  });
}

const rejectMatchSchema = z.object({
  workOrderId: z.string().min(1),
  lineId: z.string().min(1),
});

export async function rechazarMatchMaterial(
  idToken: string,
  input: z.infer<typeof rejectMatchSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "materiales:revisar_ia");
    const parsed = rejectMatchSchema.parse(input);
    const line = await getMaterialOtLineAdmin(parsed.workOrderId, parsed.lineId);
    if (!line || line.schema_version !== 1) {
      throw new AppError("NOT_FOUND", "Ítem de material no encontrado");
    }
    await updateMaterialOtLineAdmin(parsed.workOrderId, parsed.lineId, {
      normalizacion: "sin_match",
      catalogo_id: "",
      codigo_material: "",
      descripcion_match: "",
    });
  });
}

const crearCatalogoSchema = z.object({
  codigo_material: z.string().min(1).max(120),
  descripcion: z.string().min(1).max(2000),
  unidad_medida: z.string().min(1).max(80),
  centro_almacen: z.string().max(120).optional(),
  stock_disponible: z.number().nonnegative().optional(),
  stock_minimo: z.number().nonnegative().optional(),
});

export async function crearMaterialEnCatalogo(
  idToken: string,
  input: z.infer<typeof crearCatalogoSchema>,
): Promise<ActionResult<string>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "materiales:editar_catalogo");
    const parsed = crearCatalogoSchema.parse(input);
    const id = await createMaterialCatalogAdmin({
      codigo_material: parsed.codigo_material,
      descripcion: parsed.descripcion,
      unidad_medida: parsed.unidad_medida,
      centro_almacen: parsed.centro_almacen,
      stock_disponible: parsed.stock_disponible ?? 0,
      stock_minimo: parsed.stock_minimo,
      activo: true,
    });
    return id;
  });
}
