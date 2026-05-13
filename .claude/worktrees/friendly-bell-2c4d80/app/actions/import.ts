"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import type { CommitImportResult } from "@/lib/import/commit-parsed-avisos";
import { commitParsedAvisoRows } from "@/lib/import/commit-parsed-avisos";
import type { ModoImportacionAvisos } from "@/lib/import/modo-importacion";
import { parseAvisosPorModo, type ParseResult } from "@/lib/import/parse-avisos-excel";
import { requirePermisoFromToken } from "@/lib/permisos/server";

export type ConfirmarImportAvisosResult = CommitImportResult & { filasParseadas: number };

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

/**
 * Parsea el Excel sin escribir en Firestore (vista previa).
 */
export async function previewImportAvisos(
  idToken: string,
  modo: ModoImportacionAvisos,
  formData: FormData,
): Promise<ActionResult<ParseResult>> {
  return wrap(async () => {
    await requirePermisoFromToken(idToken, "admin:cargar_programa");
    if (modo === "mensuales_parche") {
      throw new AppError("VALIDATION", "El modo «Mensuales (parche)» usa otro flujo en esta pantalla.");
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new AppError("VALIDATION", "Falta el archivo Excel.");
    }
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      throw new AppError("VALIDATION", "El archivo debe ser .xlsx o .xls");
    }
    const maxBytes = 12 * 1024 * 1024;
    const buf = await file.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new AppError(
        "VALIDATION",
        `Archivo demasiado grande (máx ${String(maxBytes / 1024 / 1024)} MB)`,
      );
    }
    if (buf.byteLength === 0) {
      throw new AppError("VALIDATION", "El archivo está vacío.");
    }

    const result = await parseAvisosPorModo(buf, modo);
    if (result.fatal && !result.avisos.length) {
      throw new AppError("VALIDATION", result.fatal);
    }
    if (!result.avisos.length) {
      throw new AppError("VALIDATION", result.fatal ?? "No se encontraron avisos importables en el archivo.");
    }
    return result;
  });
}

/**
 * Confirma la importación a partir de un `ParseResult` ya revisado en el cliente.
 */
export async function confirmarImportAvisos(
  idToken: string,
  modo: ModoImportacionAvisos,
  parseResult: ParseResult,
): Promise<ActionResult<ConfirmarImportAvisosResult>> {
  return wrap(async () => {
    const profile = await requirePermisoFromToken(idToken, "admin:cargar_programa");
    if (modo === "mensuales_parche") {
      throw new AppError("VALIDATION", "El modo «Mensuales (parche)» no se confirma por esta acción.");
    }
    if (!parseResult.avisos.length) {
      throw new AppError(
        "VALIDATION",
        "No hay avisos para importar. Volvé a cargar el archivo y generar la vista previa.",
      );
    }

    const commit = await commitParsedAvisoRows({
      modo,
      rows: parseResult.avisos,
      actorUid: profile.uid,
    });

    return { ...commit, filasParseadas: parseResult.avisos.length };
  });
}
