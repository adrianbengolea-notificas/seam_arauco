"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import {
  commitAssetsImportRows,
  parseAssetsWorkbook,
  readAssetsWorkbookFromBuffer,
} from "@/modules/assets/excel-import";
import { adminCreateAsset, adminUpdateAsset } from "@/modules/assets/repository";
import { z } from "zod";


const MAX_BYTES = 6 * 1024 * 1024;

const importExcelSchema = z.object({
  fileBase64: z.string().min(32, "Archivo vacío o inválido"),
  /** Centro / planta por defecto (sector); columnas Centro o Planta en el Excel lo sobrescriben por fila. */
  sectorCentro: z.string().trim().min(1, "Indicá el centro o planta").max(120),
});

const assetFieldsSchema = z.object({
  codigo_legacy: z.string().trim().max(200).default(""),
  denominacion: z.string().trim().min(1, "Nombre del equipo requerido").max(500),
  ubicacion_tecnica: z.string().trim().min(1, "Ubicación técnica requerida").max(500),
  centro: z.string().trim().min(1, "Centro requerido").max(120),
  clase: z.string().trim().max(200).default(""),
  grupo_planificacion: z.string().trim().max(200).default(""),
  especialidad_predeterminada: z
    .enum(["", "AA", "ELECTRICO", "GG"])
    .transform((v) => (v === "" ? undefined : v)),
  activo_operativo: z.boolean(),
});

const createAssetSchema = assetFieldsSchema.extend({
  codigo_nuevo: z.string().trim().min(1, "Código del equipo requerido").max(200),
});

const updateAssetSchema = assetFieldsSchema.extend({
  assetId: z.string().trim().min(1, "Activo requerido"),
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

export type ImportAssetsExcelResult = {
  imported: number;
  warnings: string[];
};

/**
 * Importación masiva de activos desde .xlsx (mismo formato que el script CLI).
 * Solo rol `admin` (superadmin bootstrap en esta app).
 */
export async function actionImportAssetsExcel(
  idToken: string,
  raw: z.infer<typeof importExcelSchema>,
): Promise<ActionResult<ImportAssetsExcelResult>> {
  return wrap(async () => {
    await requirePermisoFromToken(idToken, "activos:crear_editar");

    const input = importExcelSchema.parse(raw);

    let buffer: Buffer;
    try {
      buffer = Buffer.from(input.fileBase64, "base64");
    } catch {
      throw new AppError("VALIDATION", "No se pudo leer el archivo (Base64 inválido)");
    }

    if (buffer.length > MAX_BYTES) {
      throw new AppError("VALIDATION", `El archivo supera el máximo de ${MAX_BYTES / 1024 / 1024} MB`, {
        details: { maxMb: MAX_BYTES / 1024 / 1024 },
      });
    }

    const workbook = readAssetsWorkbookFromBuffer(buffer);
    const { rows, warnings } = parseAssetsWorkbook(workbook, input.sectorCentro.trim());

    if (!rows.length) {
      return { imported: 0, warnings };
    }

    await commitAssetsImportRows(rows);
    return { imported: rows.length, warnings };
  });
}

export type UpdateAssetActionResult = { ok: true };

/**
 * Edición de ficha de activo. Solo `admin` y `super_admin` (vía `roleSatisfiesAllowed`).
 */
export async function actionUpdateAsset(
  idToken: string,
  raw: z.input<typeof updateAssetSchema>,
): Promise<ActionResult<UpdateAssetActionResult>> {
  return wrap(async () => {
    await requirePermisoFromToken(idToken, "activos:crear_editar");

    const input = updateAssetSchema.parse(raw);
    await adminUpdateAsset(input.assetId, {
      denominacion: input.denominacion,
      codigo_legacy: input.codigo_legacy,
      ubicacion_tecnica: input.ubicacion_tecnica,
      centro: input.centro,
      clase: input.clase,
      grupo_planificacion: input.grupo_planificacion,
      ...(input.especialidad_predeterminada
        ? { especialidad_predeterminada: input.especialidad_predeterminada }
        : {}),
      activo_operativo: input.activo_operativo,
    });
    return { ok: true as const };
  });
}

export type CreateAssetActionResult = { id: string };

/**
 * Alta manual de un activo. Roles `supervisor` y `admin` vía Admin SDK.
 * Escritura directa cliente → `assets` en Firestore queda acotada a `admin` / `super_admin`.
 */
export async function actionCreateAsset(
  idToken: string,
  raw: z.input<typeof createAssetSchema>,
): Promise<ActionResult<CreateAssetActionResult>> {
  return wrap(async () => {
    await requirePermisoFromToken(idToken, "activos:crear_editar");

    const input = createAssetSchema.parse(raw);
    const legacy = input.codigo_legacy.trim();
    return adminCreateAsset({
      codigo_nuevo: input.codigo_nuevo,
      ...(legacy ? { codigo_legacy: legacy } : {}),
      denominacion: input.denominacion,
      ubicacion_tecnica: input.ubicacion_tecnica,
      centro: input.centro,
      ...(input.clase.trim() ? { clase: input.clase.trim() } : {}),
      ...(input.grupo_planificacion.trim()
        ? { grupo_planificacion: input.grupo_planificacion.trim() }
        : {}),
      ...(input.especialidad_predeterminada
        ? { especialidad_predeterminada: input.especialidad_predeterminada }
        : {}),
      activo_operativo: input.activo_operativo,
    });
  });
}
