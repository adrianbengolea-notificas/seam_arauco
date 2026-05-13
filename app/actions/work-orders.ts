"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { crearNotificacionSeguro } from "@/lib/notificaciones/crear-notificacion";
import {
  destinatariosAdminsCentro,
  destinatariosClienteArauco,
  destinatariosSupervisoresAdmin,
} from "@/lib/notificaciones/destinatarios";
import { toPermisoRol } from "@/lib/permisos/index";
import { requireAnyPermisoFromToken, requirePermisoFromToken, requireVerifiedProfileFromToken } from "@/lib/permisos/server";
import { usuarioTieneCentro } from "@/modules/users/centros-usuario";
import { listUserProfilesFiltered } from "@/modules/users/repository";
import type { FirmaDigital } from "@/modules/work-orders/types";
import {
  addMaterialOtField,
  addMaterialToWorkOrder,
  applyWorkOrderVistaStatus,
  archiveWorkOrderSuperadmin,
  assignTechnician,
  closeWorkOrder as closeWorkOrderListaParaCierre,
  closeWorkOrderWithPadSignatures,
  runWorkOrderPadCloseFollowUp,
  closeWorkOrderHistorico,
  createWorkOrderFromAviso,
  createWorkOrderFromForm,
  registerEvidenceAfterUpload,
  signTechnician,
  signUsuarioPlanta,
  startExecution,
  updateChecklistItemService,
  updateWorkOrderInformeText,
} from "@/modules/work-orders/service";
import { getAvisoById } from "@/modules/notices/repository";
import { getWorkOrderById } from "@/modules/work-orders/repository";
import type { WorkOrderVistaStatus } from "@/modules/work-orders/types";
import { Timestamp } from "firebase-admin/firestore";
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

/** Solo súper admin: oculta la OT (soft-delete) y desvincula aviso / celda de programa si aplica. */
export async function actionArchiveWorkOrder(
  idToken: string,
  input: {
    workOrderId: string;
    programa?: {
      programaDocId: string;
      localidad: string;
      dia: "lunes" | "martes" | "miercoles" | "jueves" | "viernes" | "sabado" | "domingo";
      especialidad: "Aire" | "Electrico" | "GG";
      avisoNumero: string;
      avisoFirestoreId?: string;
    };
  },
): Promise<ActionResult<void>> {
  const programaSchema = z
    .object({
      programaDocId: z.string().min(1),
      localidad: z.string(),
      dia: z.enum([
        "lunes",
        "martes",
        "miercoles",
        "jueves",
        "viernes",
        "sabado",
        "domingo",
      ]),
      especialidad: z.enum(["Aire", "Electrico", "GG"]),
      avisoNumero: z.string().min(1),
      avisoFirestoreId: z.string().optional(),
    })
    .optional();
  const schema = z.object({
    workOrderId: z.string().min(1),
    programa: programaSchema,
  });
  return wrap(async () => {
    const session = await requireVerifiedProfileFromToken(idToken);
    if (toPermisoRol(session.rol) !== "superadmin") {
      throw new AppError("FORBIDDEN", "Solo el súper administrador puede archivar órdenes de trabajo");
    }
    const parsed = schema.parse(input);
    await archiveWorkOrderSuperadmin({
      workOrderId: parsed.workOrderId.trim(),
      actorUid: session.uid,
      programa: parsed.programa,
    });
  });
}

const materialLineSchema = z.object({
  material_id: z.string(),
  codigo_material: z.string(),
  descripcion_snapshot: z.string(),
  unidad_medida: z.string(),
  cantidad_solicitada: z.number(),
  cantidad_consumida: z.number(),
  lote: z.string().optional(),
  observacion: z.string().optional(),
  registrado_por_uid: z.string(),
});

const evidenciaSchema = z.object({
  storage_path: z.string(),
  download_url: z.string().url(),
  content_type: z.string(),
  tamano_bytes: z.number(),
  descripcion: z.string().optional(),
  subido_por_uid: z.string(),
});

const firmaSchema = z.object({
  signer_user_id: z.string(),
  signer_display_name: z.string(),
  signer_capacity: z.enum(["TECNICO", "USUARIO_PLANTA", "SUPERVISOR"]),
  image_data_url_base64: z.string().min(100),
});

export async function actionCreateWorkOrderFromAviso(
  idToken: string,
  input: { avisoId: string },
): Promise<ActionResult<string>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "programa:crear_ot");
    // Verificar que el aviso pertenece a un centro del usuario (salvo superadmin)
    const actorRol = toPermisoRol(session.rol);
    if (actorRol !== "superadmin") {
      const aviso = await getAvisoById(input.avisoId);
      if (!aviso) throw new AppError("NOT_FOUND", "Aviso no encontrado");
      if (!usuarioTieneCentro(session, aviso.centro)) {
        throw new AppError("FORBIDDEN", "No se puede crear una OT en un centro diferente al propio");
      }
    }
    return createWorkOrderFromAviso({ avisoId: input.avisoId, actorUid: session.uid });
  });
}

export async function actionAssignTechnician(
  idToken: string,
  input: { workOrderId: string; tecnicoUid: string; tecnicoNombre: string },
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:cancelar_reasignar");
    await assignTechnician({
      workOrderId: input.workOrderId,
      tecnicoUid: input.tecnicoUid,
      tecnicoNombre: input.tecnicoNombre,
      actorUid: session.uid,
    });
  });
}

export type TecnicoParaAsignacionOt = { uid: string; display_name: string; email: string };

/** Técnicos activos del centro (Admin SDK). Supervisores no pueden listar `users` desde el cliente. */
export async function actionListTecnicosParaAsignacionOt(
  idToken: string,
  input: { centro: string },
): Promise<ActionResult<TecnicoParaAsignacionOt[]>> {
  return wrap(async () => {
    const session = await requireAnyPermisoFromToken(idToken, [
      "ot:cancelar_reasignar",
      "ot:crear_manual",
      "programa:crear_ot",
    ]);
    const c = input.centro.trim();
    if (!c) throw new AppError("VALIDATION", "Centro requerido");
    const actorRol = toPermisoRol(session.rol);
    if (actorRol !== "superadmin" && !usuarioTieneCentro(session, c)) {
      throw new AppError("FORBIDDEN", "No podés listar técnicos de otro centro");
    }
    const rows = await listUserProfilesFiltered({
      limit: 1000,
      centro: c,
      rol: "tecnico",
      activo: true,
    });
    return rows
      .map((r) => ({
        uid: r.uid,
        display_name: (r.display_name ?? "").trim() || r.email || r.uid,
        email: r.email ?? "",
      }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, "es"));
  });
}

export async function actionStartExecution(
  idToken: string,
  input: { workOrderId: string },
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:iniciar_estado");
    await startExecution({ workOrderId: input.workOrderId, actorUid: session.uid });
  });
}

export async function actionAddMaterial(
  idToken: string,
  input: { workOrderId: string; line: z.infer<typeof materialLineSchema> },
): Promise<ActionResult<string>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:agregar_materiales");
    const line = materialLineSchema.parse(input.line);
    if (line.registrado_por_uid !== session.uid) {
      throw new AppError("FORBIDDEN", "registrado_por_uid debe coincidir con la sesión");
    }
    return addMaterialToWorkOrder({
      workOrderId: input.workOrderId,
      line,
      actorUid: session.uid,
    });
  });
}

export async function actionRegisterEvidence(
  idToken: string,
  input: { workOrderId: string; meta: z.infer<typeof evidenciaSchema> },
): Promise<ActionResult<string>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:completar_planilla");
    const meta = evidenciaSchema.parse(input.meta);
    if (meta.subido_por_uid !== session.uid) {
      throw new AppError("FORBIDDEN", "subido_por_uid debe coincidir con la sesión");
    }
    return registerEvidenceAfterUpload({
      workOrderId: input.workOrderId,
      meta,
      actorUid: session.uid,
    });
  });
}

function toFirmaDigital(parsed: z.infer<typeof firmaSchema>): FirmaDigital {
  return {
    ...parsed,
    signed_at: Timestamp.now() as unknown as FirmaDigital["signed_at"],
  };
}

export async function actionSignTechnician(
  idToken: string,
  input: { workOrderId: string; firma: z.infer<typeof firmaSchema> },
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:firmar_cerrar");
    const firma = toFirmaDigital(firmaSchema.parse(input.firma));
    await signTechnician({ workOrderId: input.workOrderId, firma, actorUid: session.uid });
  });
}

export async function actionSignUsuario(
  idToken: string,
  input: { workOrderId: string; firma: z.infer<typeof firmaSchema> },
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:firmar_cerrar");
    const firma = toFirmaDigital(firmaSchema.parse(input.firma));
    await signUsuarioPlanta({ workOrderId: input.workOrderId, firma, actorUid: session.uid });
  });
}

export async function actionCloseWorkOrder(
  idToken: string,
  input: { workOrderId: string; motivo?: string },
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:cancelar_reasignar");
    await closeWorkOrderListaParaCierre({
      workOrderId: input.workOrderId,
      actorUid: session.uid,
      motivo: input.motivo,
    });
  });
}

const createWorkOrderSchema = z
  .object({
    centro: z.string().min(1),
    asset_id: z.string().optional().default(""),
    especialidad: z.enum(["AA", "ELECTRICO", "GG", "HG"]),
    sub_tipo: z.enum(["preventivo", "correctivo", "checklist"]),
    texto_trabajo: z.string().min(1).max(24_000),
    aviso_id: z.string().optional(),
    aviso_numero: z.string().optional(),
    fecha_inicio_programada: z.string().optional().nullable(),
    tecnico_asignado_uid: z.string().optional(),
    tecnico_asignado_nombre: z.string().optional(),
    frecuencia_plan_mtsa: z.enum(["M", "T", "S", "A"]).optional(),
    ubicacion_tecnica: z.string().optional(),
    denom_ubic_tecnica: z.string().optional(),
    /** Solo correctivos: equipo fuera del catálogo (`asset_id` vacío + descripción manual). */
    activo_fuera_catalogo: z.boolean().optional(),
    activo_manual_descripcion: z.string().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    const sinActivoPermitido = data.especialidad === "ELECTRICO" || data.especialidad === "HG";
    const fuera = data.activo_fuera_catalogo === true;
    const manual = (data.activo_manual_descripcion ?? "").trim();

    if (fuera && data.sub_tipo === "preventivo") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "En preventivos tenés que elegir un activo del listado.",
        path: ["activo_fuera_catalogo"],
      });
    }
    if (fuera && data.sub_tipo === "checklist") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "En checklist / service elegí un activo del listado.",
        path: ["activo_fuera_catalogo"],
      });
    }

    if (fuera && data.sub_tipo === "correctivo") {
      if (manual.length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Describí el equipo o lugar (al menos 3 caracteres).",
          path: ["activo_manual_descripcion"],
        });
      }
      if (data.asset_id.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Quitá el activo del listado si usás «otro equipo» manual.",
          path: ["asset_id"],
        });
      }
      return;
    }

    if (!sinActivoPermitido && !data.asset_id.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          data.sub_tipo === "correctivo"
            ? "Seleccioná un equipo del listado o indicá «Otro» con descripción manual."
            : "Seleccioná un equipo / activo.",
        path: ["asset_id"],
      });
    }
  });

export async function createWorkOrder(
  idToken: string,
  input: z.infer<typeof createWorkOrderSchema>,
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:crear_manual");
    const parsed = createWorkOrderSchema.parse(input);
    const actorRol = toPermisoRol(session.rol);
    if (actorRol !== "superadmin" && !usuarioTieneCentro(session, parsed.centro.trim())) {
      throw new AppError("FORBIDDEN", "No se puede crear una OT en un centro diferente al propio");
    }
    const fechaStr =
      parsed.fecha_inicio_programada != null && String(parsed.fecha_inicio_programada).trim().length
        ? String(parsed.fecha_inicio_programada).trim()
        : "";
    const fecha = fechaStr.length ? Timestamp.fromDate(new Date(fechaStr)) : undefined;
    const id = await createWorkOrderFromForm({
      actorUid: session.uid,
      centro: parsed.centro,
      asset_id: parsed.asset_id,
      especialidad: parsed.especialidad,
      sub_tipo: parsed.sub_tipo,
      texto_trabajo: parsed.texto_trabajo,
      aviso_id: parsed.aviso_id,
      aviso_numero: parsed.aviso_numero,
      fecha_inicio_programada: fecha,
      tecnico_asignado_uid: parsed.tecnico_asignado_uid,
      tecnico_asignado_nombre: parsed.tecnico_asignado_nombre,
      frecuencia_plan_mtsa: parsed.frecuencia_plan_mtsa,
      ubicacion_tecnica: parsed.ubicacion_tecnica,
      denom_ubic_tecnica: parsed.denom_ubic_tecnica,
      activo_fuera_catalogo: parsed.activo_fuera_catalogo,
      activo_manual_descripcion: parsed.activo_manual_descripcion?.trim(),
    });

    if (parsed.aviso_id) {
      const aviso = await getAvisoById(parsed.aviso_id);
      if (aviso?.urgente === true) {
        const wo = await getWorkOrderById(id);
        if (wo) {
          const dest = [
            ...(await destinatariosClienteArauco(wo.centro)),
            ...(await destinatariosSupervisoresAdmin(wo.centro)),
          ];
          crearNotificacionSeguro(dest, {
            tipo: "ot_urgente_abierta",
            titulo: `OT urgente abierta · n.º ${wo.n_ot}`,
            cuerpo: wo.texto_trabajo.trim().slice(0, 280),
            otId: wo.id,
          });
        }
      }
    }

    return { id };
  });
}

const updateStatusSchema = z.object({
  workOrderId: z.string(),
  status: z.enum(["PENDIENTE", "EN_CURSO", "COMPLETADA", "CANCELADA"]),
});

export async function updateWorkOrderStatus(
  idToken: string,
  input: z.infer<typeof updateStatusSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const parsed = updateStatusSchema.parse(input);
    if (parsed.status === "EN_CURSO") {
      const session = await requirePermisoFromToken(idToken, "ot:iniciar_estado");
      await applyWorkOrderVistaStatus({
        workOrderId: parsed.workOrderId,
        status: parsed.status as WorkOrderVistaStatus,
        actorUid: session.uid,
      });
      return;
    }
    if (parsed.status === "CANCELADA") {
      const session = await requirePermisoFromToken(idToken, "ot:cancelar_reasignar");
      await applyWorkOrderVistaStatus({
        workOrderId: parsed.workOrderId,
        status: "CANCELADA",
        actorUid: session.uid,
      });
      return;
    }
    throw new AppError("VALIDATION", "Usá las acciones específicas para este estado");
  });
}

const materialOtSchema = z.object({
  descripcion: z.string().min(1),
  cantidad: z.number().positive(),
  unidad: z.string().min(1),
  origen: z.enum(["ARAUCO", "EXTERNO"]),
  observaciones: z.string().optional(),
  catalogoIdConfirmado: z.string().optional(),
});

export async function addMaterialToOT(
  idToken: string,
  input: { workOrderId: string; material: z.infer<typeof materialOtSchema> },
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:agregar_materiales");
    const material = materialOtSchema.parse(input.material);
    const id = await addMaterialOtField({
      workOrderId: input.workOrderId,
      actorUid: session.uid,
      descripcion: material.descripcion,
      cantidad: material.cantidad,
      unidad: material.unidad,
      origen: material.origen,
      observaciones: material.observaciones,
      catalogoIdConfirmado: material.catalogoIdConfirmado,
    });
    if (material.origen === "EXTERNO") {
      const wo = await getWorkOrderById(input.workOrderId);
      if (wo) {
        const dest = [
          ...(await destinatariosClienteArauco(wo.centro)),
          ...(await destinatariosAdminsCentro(wo.centro)),
        ];
        crearNotificacionSeguro(dest, {
          tipo: "material_externo_cargado",
          titulo: `Material externo cargado · OT n.º ${wo.n_ot}`,
          cuerpo: `${material.descripcion} · ${material.cantidad} ${material.unidad}`,
          otId: wo.id,
          materialId: id,
        });
      }
    }
    return { id };
  });
}

const closePadSchema = z.object({
  workOrderId: z.string(),
  /** Obligatoria si el centro exige firma de usuario (`centros/{id}.requiere_firma_usuario_cierre`). */
  firmaUsuario: z.string().optional().default(""),
  firmaTecnico: z.string().min(100),
  firmaUsuarioNombre: z.string().max(200).optional().default(""),
  firmaTecnicoNombre: z.string().min(1).max(200),
});

export async function closeWorkOrder(
  idToken: string,
  input: z.infer<typeof closePadSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:firmar_cerrar");
    const parsed = closePadSchema.parse(input);
    await closeWorkOrderWithPadSignatures({
      workOrderId: parsed.workOrderId,
      actorUid: session.uid,
      firma_usuario_pad: parsed.firmaUsuario,
      firma_tecnico_pad: parsed.firmaTecnico,
      firma_usuario_nombre: parsed.firmaUsuarioNombre,
      firma_tecnico_nombre: parsed.firmaTecnicoNombre,
    });
    await runWorkOrderPadCloseFollowUp(parsed.workOrderId);
  });
}

function parseFechaEjecucionHistorico(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) throw new AppError("VALIDATION", "Fecha de ejecución inválida (usá AAAA-MM-DD)");
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    throw new AppError("VALIDATION", "Fecha de ejecución inválida");
  }
  return new Date(y, mo, d, 12, 0, 0, 0);
}

const closeHistoricoSchema = z.object({
  workOrderId: z.string().min(1),
  fechaEjecucion: z.string().min(1),
  motivo: z.string().min(10).max(4000),
  evidenciaUrl: z.union([z.string().url(), z.literal("")]).optional(),
  tecnicoNombre: z.string().max(300).optional(),
});

/** Solo rol superadmin: registrar OT como completada con fecha real (empalme documentado). */
export async function actionCloseWorkOrderHistorico(
  idToken: string,
  input: z.infer<typeof closeHistoricoSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requireVerifiedProfileFromToken(idToken);
    if (toPermisoRol(session.rol) !== "superadmin") {
      throw new AppError("FORBIDDEN", "Solo el súper administrador puede registrar un cierre histórico");
    }
    const parsed = closeHistoricoSchema.parse(input);
    const fechaEjecucion = parseFechaEjecucionHistorico(parsed.fechaEjecucion);
    const displayName = (session.display_name?.trim() || session.email || session.uid).trim();
    await closeWorkOrderHistorico({
      workOrderId: parsed.workOrderId,
      fechaEjecucion,
      motivo: parsed.motivo,
      evidenciaUrl: parsed.evidenciaUrl?.trim() || undefined,
      tecnicoNombre: parsed.tecnicoNombre?.trim() || undefined,
      actorUid: session.uid,
      actorDisplayName: displayName,
    });
  });
}

const checklistSchema = z.object({
  workOrderId: z.string(),
  itemId: z.string(),
  completed: z.boolean(),
});

export async function updateChecklistItem(
  idToken: string,
  input: z.infer<typeof checklistSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:completar_planilla");
    const parsed = checklistSchema.parse(input);
    await updateChecklistItemService({
      workOrderId: parsed.workOrderId,
      itemId: parsed.itemId,
      completed: parsed.completed,
      actorUid: session.uid,
    });
  });
}

const informeTextoSchema = z.object({
  workOrderId: z.string(),
  texto_trabajo: z.string().min(1).max(24_000),
});

export async function actionUpdateWorkOrderInforme(
  idToken: string,
  input: z.infer<typeof informeTextoSchema>,
): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "ot:completar_planilla");
    const parsed = informeTextoSchema.parse(input);
    await updateWorkOrderInformeText({
      workOrderId: parsed.workOrderId,
      texto_trabajo: parsed.texto_trabajo,
      actorUid: session.uid,
    });
  });
}
