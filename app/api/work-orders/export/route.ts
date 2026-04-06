import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { rowsToCsv } from "@/lib/csv/escape";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { requirePermiso } from "@/lib/permisos/server";
import { toPermisoRol } from "@/lib/permisos/index";
import type { Especialidad } from "@/modules/notices/types";
import { listWorkOrdersForExportAdmin } from "@/modules/work-orders/repository";
import { formatFirestoreDate } from "@/lib/pdf/format-firestore-date";

const ESPECIALIDADES: Especialidad[] = ["AA", "ELECTRICO", "GG", "HG"];

function parseDateEndOfDay(iso: string): Date {
  const d = new Date(`${iso.trim()}T23:59:59.999`);
  if (Number.isNaN(d.getTime())) {
    throw new AppError("VALIDATION", "Fecha inválida", { details: { iso } });
  }
  return d;
}

function parseDateStart(iso: string): Date {
  const d = new Date(`${iso.trim()}T00:00:00.000`);
  if (Number.isNaN(d.getTime())) {
    throw new AppError("VALIDATION", "Fecha inválida", { details: { iso } });
  }
  return d;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const profile = await requirePermiso(request, "historial:exportar_csv", token);

    const { searchParams } = new URL(request.url);
    const centroParam = searchParams.get("centro")?.trim() ?? "";
    const fromStr = searchParams.get("from")?.trim() ?? "";
    const toStr = searchParams.get("to")?.trim() ?? "";
    const espRaw = searchParams.get("especialidad")?.trim().toUpperCase() ?? "";

    if (!centroParam || !fromStr || !toStr) {
      return new NextResponse("Query requerida: centro, from, to (YYYY-MM-DD)", { status: 400 });
    }

    if (toPermisoRol(profile.rol) !== "superadmin" && profile.centro !== centroParam) {
      return new NextResponse("No autorizado para este centro", { status: 403 });
    }

    let especialidad: Especialidad | null = null;
    if (espRaw.length) {
      if (!ESPECIALIDADES.includes(espRaw as Especialidad)) {
        return new NextResponse("especialidad inválida", { status: 400 });
      }
      especialidad = espRaw as Especialidad;
    }

    const createdFrom = Timestamp.fromDate(parseDateStart(fromStr));
    const createdTo = Timestamp.fromDate(parseDateEndOfDay(toStr));

    let rows = await listWorkOrdersForExportAdmin({
      centro: centroParam,
      createdFrom,
      createdTo,
      limit: 2500,
    });

    if (especialidad) {
      rows = rows.filter((w) => w.especialidad === especialidad);
    }

    const header = [
      "n_ot",
      "id",
      "estado",
      "especialidad",
      "tipo_trabajo",
      "centro",
      "codigo_activo",
      "aviso_numero",
      "creada",
      "actualizada",
      "fecha_fin_ejecucion",
      "texto_trabajo",
    ];

    const dataRows: string[][] = [
      header,
      ...rows.map((w) => [
        w.n_ot,
        w.id,
        w.estado,
        w.especialidad,
        w.tipo_trabajo,
        w.centro,
        w.codigo_activo_snapshot,
        (w.aviso_numero ?? w.aviso_id ?? "").trim(),
        formatFirestoreDate(w.created_at),
        formatFirestoreDate(w.updated_at),
        w.fecha_fin_ejecucion ? formatFirestoreDate(w.fecha_fin_ejecucion) : "",
        (w.texto_trabajo ?? "").replace(/\s+/g, " ").trim(),
      ]),
    ];

    const csv = rowsToCsv(dataRows);
    const fname = `ots-${centroParam}-${fromStr}-${toStr}${especialidad ? `-${especialidad}` : ""}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  } catch (e) {
    if (isAppError(e) && e.code === "VALIDATION") {
      return new NextResponse(e.message, { status: 400 });
    }
    console.error("[export ots]", e);
    return new NextResponse("Error", { status: 500 });
  }
}
