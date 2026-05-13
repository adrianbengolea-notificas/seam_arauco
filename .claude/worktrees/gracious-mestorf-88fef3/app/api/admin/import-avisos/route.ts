import { verifyIdTokenOrThrow } from "@/lib/auth/verify-id-token";
import { AppError, isAppError } from "@/lib/errors/app-error";
import {
  importarAvisosDesdeExcelBuffer,
  type ModoImportacionAvisos,
} from "@/lib/importaciones/avisos-excel-admin";
import { tienePermiso, toPermisoRol, type Permiso } from "@/lib/permisos/index";

export const dynamic = "force-dynamic";

const PERMISO_IMPORT: Permiso = "admin:cargar_programa";

const MODOS: ModoImportacionAvisos[] = [
  "preventivos_todas",
  "preventivos_mensual",
  "preventivos_trimestral",
  "preventivos_semestral",
  "preventivos_anual",
  "mensuales_parche",
  "listado_semestral_anual",
  "correctivos",
];

function parseModo(raw: string | null): ModoImportacionAvisos {
  const m = (raw ?? "").trim() as ModoImportacionAvisos;
  if (MODOS.includes(m)) return m;
  throw new AppError("VALIDATION", "Modo de importación no válido");
}

export async function POST(request: Request) {
  try {
    const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const session = await verifyIdTokenOrThrow(token);
    if (!tienePermiso(toPermisoRol(session.role), PERMISO_IMPORT)) {
      return Response.json({ ok: false, error: "Sin permiso (admin:cargar_programa)" }, { status: 403 });
    }

    const ct = request.headers.get("content-type") ?? "";
    if (!ct.includes("multipart/form-data")) {
      return Response.json({ ok: false, error: "Usá multipart/form-data" }, { status: 400 });
    }

    const form = await request.formData();
    const modoRaw = form.get("modo");
    const modo = parseModo(typeof modoRaw === "string" ? modoRaw : null);
    const dryRun = form.get("dry_run") === "true" || form.get("dry_run") === "1";
    const file = form.get("file");

    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: "Falta el archivo (campo file)" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const maxBytes = 12 * 1024 * 1024;
    if (buf.length > maxBytes) {
      return Response.json({ ok: false, error: `Archivo demasiado grande (máx ${maxBytes / 1024 / 1024} MB)` }, { status: 400 });
    }

    const result = await importarAvisosDesdeExcelBuffer({
      buffer: buf,
      modo,
      dryRun,
      actorUid: session.uid,
    });

    return Response.json({ ok: true, dryRun, result });
  } catch (e) {
    if (isAppError(e)) {
      return Response.json({ ok: false, error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "Error";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
