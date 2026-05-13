import { getAdminDb } from "@/firebase/firebaseAdmin";
import { AppError } from "@/lib/errors/app-error";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  appendAvisoToProgramaSemanaAdmin,
  createWeeklyPlanRowAdmin,
  createWeeklySlotAdmin,
  deleteWeeklyPlanRowAdmin,
  deleteWeeklySlotAdmin,
  ensureWeeklyBucketAdmin,
  getWeeklyPlanRowAdmin,
  replaceWeeklyPlanRowsAdmin,
  updateWeeklyPlanRowAdmin,
} from "@/modules/scheduling/repository";
import type { AvisoSlot, DiaSemanaPrograma, EspecialidadPrograma, WeeklyPlanRow } from "@/modules/scheduling/types";
import { toPermisoRol } from "@/lib/permisos/index";
import type { UserProfileWithUid } from "@/modules/users/repository";
import { getAvisoById, updateAviso } from "@/modules/notices/repository";
import type { Especialidad } from "@/modules/notices/types";
import { getWorkOrderById } from "@/modules/work-orders/repository";

async function nextOrdenEnDia(weekId: string, dia: number): Promise<number> {
  const snap = await getAdminDb()
    .collection(COLLECTIONS.weekly_schedule)
    .doc(weekId)
    .collection("slots")
    .get();
  let max = -1;
  for (const d of snap.docs) {
    const row = d.data() as { dia_semana?: number; orden_en_dia?: number };
    if (row.dia_semana === dia && typeof row.orden_en_dia === "number") {
      max = Math.max(max, row.orden_en_dia);
    }
  }
  return max + 1;
}

export async function scheduleWorkOrderInWeek(input: {
  weekId: string;
  workOrderId: string;
  dia_semana: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  turno?: "A" | "B" | "C";
  centroEsperado: string;
}): Promise<string> {
  const wo = await getWorkOrderById(input.workOrderId);
  if (!wo) {
    throw new AppError("NOT_FOUND", "Orden de trabajo no encontrada");
  }
  if (wo.centro !== input.centroEsperado) {
    throw new AppError("FORBIDDEN", "La OT pertenece a otro centro");
  }
  if (wo.estado === "ANULADA" || wo.estado === "CERRADA") {
    throw new AppError("CONFLICT", "No se programa una OT cerrada o anulada");
  }

  await ensureWeeklyBucketAdmin(input.weekId, input.centroEsperado, input.weekId);
  const orden = await nextOrdenEnDia(input.weekId, input.dia_semana);

  return createWeeklySlotAdmin(input.weekId, {
    centro: input.centroEsperado,
    work_order_id: wo.id,
    n_ot_snapshot: wo.n_ot,
    asset_id: wo.asset_id,
    ubicacion_tecnica: wo.ubicacion_tecnica,
    especialidad: wo.especialidad,
    dia_semana: input.dia_semana,
    turno: input.turno,
    orden_en_dia: orden,
  });
}

export async function removeWeekSlot(input: { weekId: string; slotId: string }): Promise<void> {
  await deleteWeeklySlotAdmin(input.weekId, input.slotId);
}

export async function replaceWeeklyPlanRows(input: {
  weekId: string;
  centroEsperado: string;
  rows: Array<Pick<WeeklyPlanRow, "dia_semana" | "localidad" | "especialidad" | "texto" | "orden">>;
}): Promise<void> {
  const body: Array<Omit<WeeklyPlanRow, "id" | "created_at" | "updated_at">> = input.rows.map((r) => ({
    ...r,
    centro: input.centroEsperado,
  }));
  await replaceWeeklyPlanRowsAdmin(input.weekId, input.centroEsperado, body);
}

export async function addWeeklyPlanRow(input: {
  weekId: string;
  centroEsperado: string;
  dia_semana: WeeklyPlanRow["dia_semana"];
  localidad: string;
  especialidad: string;
  texto: string;
}): Promise<string> {
  return createWeeklyPlanRowAdmin(input.weekId, {
    centro: input.centroEsperado,
    dia_semana: input.dia_semana,
    localidad: input.localidad.trim(),
    especialidad: input.especialidad.trim(),
    texto: input.texto.trim(),
  });
}

export async function patchWeeklyPlanRow(input: {
  weekId: string;
  rowId: string;
  centroEsperado: string;
  patch: Partial<Pick<WeeklyPlanRow, "localidad" | "especialidad" | "texto" | "dia_semana">>;
}): Promise<void> {
  const row = await getWeeklyPlanRowAdmin(input.weekId, input.rowId);
  if (!row) {
    throw new AppError("NOT_FOUND", "Fila de plan no encontrada");
  }
  if (row.centro !== input.centroEsperado) {
    throw new AppError("FORBIDDEN", "La fila pertenece a otro centro");
  }
  await updateWeeklyPlanRowAdmin(input.weekId, input.rowId, input.patch);
}

export async function removeWeeklyPlanRow(input: {
  weekId: string;
  rowId: string;
  centroEsperado: string;
}): Promise<void> {
  const row = await getWeeklyPlanRowAdmin(input.weekId, input.rowId);
  if (!row) {
    throw new AppError("NOT_FOUND", "Fila de plan no encontrada");
  }
  if (row.centro !== input.centroEsperado) {
    throw new AppError("FORBIDDEN", "La fila pertenece a otro centro");
  }
  await deleteWeeklyPlanRowAdmin(input.weekId, input.rowId);
}

function especialidadAAvisoToPrograma(esp: Especialidad): EspecialidadPrograma {
  if (esp === "ELECTRICO" || esp === "HG") return "Electrico";
  if (esp === "AA") return "Aire";
  return "GG";
}

/** Publica un aviso en `programa_semanal` y marca `incluido_en_semana`. */
export async function addAvisoToPublishedPrograma(input: {
  semanaId: string;
  avisoFirestoreId: string;
  dia: DiaSemanaPrograma;
  localidad?: string;
  session: UserProfileWithUid;
}): Promise<void> {
  const aviso = await getAvisoById(input.avisoFirestoreId);
  if (!aviso) {
    throw new AppError("NOT_FOUND", "Aviso no encontrado");
  }
  const rol = toPermisoRol(input.session.rol);
  if (rol !== "superadmin" && aviso.centro !== input.session.centro) {
    throw new AppError("FORBIDDEN", "El aviso pertenece a otro centro");
  }
  if (aviso.incluido_en_semana === input.semanaId) {
    throw new AppError("CONFLICT", "Este aviso ya figura incluido en esta semana");
  }
  const espProg = especialidadAAvisoToPrograma(aviso.especialidad);
  const loc =
    (input.localidad?.trim() || aviso.ubicacion_tecnica || aviso.centro || "").trim() || "—";
  const nuevoAviso: AvisoSlot = {
    numero: aviso.n_aviso,
    descripcion: aviso.texto_corto || aviso.n_aviso,
    tipo:
      aviso.tipo === "CORRECTIVO" || aviso.tipo === "EMERGENCIA" ? "correctivo" : "preventivo",
    urgente: aviso.urgente === true,
    ubicacion: aviso.ubicacion_tecnica,
  };
  await appendAvisoToProgramaSemanaAdmin({
    semanaId: input.semanaId,
    centro: aviso.centro,
    dia: input.dia,
    especialidad: espProg,
    localidad: loc,
    nuevoAviso,
  });
  await updateAviso(aviso.id, {
    incluido_en_semana: input.semanaId,
  });
}
