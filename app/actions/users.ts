"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { toPermisoRol } from "@/lib/permisos/index";
import { DEFAULT_CENTRO, isCentroInKnownList, KNOWN_CENTROS } from "@/lib/config/app-config";
import { getAdminAuth, getAdminDb } from "@/firebase/firebaseAdmin";
import {
  USERS_COLLECTION,
  adminSetUserActivo,
  adminUpdateUserCentro,
  adminUpdateUserCentros,
  adminUpdateUserRol,
  appendAdminAuditLog,
  getUserProfileByUid,
  listUserProfilesFiltered,
  syncUserCustomClaims,
} from "@/modules/users/repository";
import { centrosEfectivosDelUsuario, perfilesCompartenCentro } from "@/modules/users/centros-usuario";
import { isSuperAdminRole } from "@/modules/users/roles";
import type { UserRole } from "@/modules/users/types";
import type { Especialidad } from "@/modules/notices/types";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

const ESPECIALIDADES_TECNICO = z.enum(["AA", "ELECTRICO", "GG", "HG"]);

const assignableByAdminSchema = z.enum(["tecnico", "supervisor", "admin", "cliente_arauco"]);
const assignableBySuperSchema = z.enum(["tecnico", "supervisor", "admin", "superadmin", "cliente_arauco"]);

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

function tsToIso(t: unknown): string | null {
  if (
    t != null &&
    typeof t === "object" &&
    "toDate" in t &&
    typeof (t as { toDate: () => Date }).toDate === "function"
  ) {
    try {
      return (t as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

export type UserAdminRow = {
  uid: string;
  email: string;
  display_name: string;
  rol: UserRole;
  centro: string;
  centros_asignados?: string[];
  activo: boolean;
  especialidades?: Especialidad[];
  created_at: string | null;
  updated_at: string | null;
};

export async function actionListUsers(idToken: string): Promise<ActionResult<UserAdminRow[]>> {
  return wrap(async () => {
    const actor = await requirePermisoFromToken(idToken, "admin:gestionar_usuarios");
    const rows = await listUserProfilesFiltered({
      limit: 1000,
      centro: isSuperAdminRole(actor.rol) ? null : actor.centro,
    });
    return rows
      .map((r) => ({
        uid: r.uid,
        email: r.email,
        display_name: r.display_name,
        rol: r.rol,
        centro: r.centro,
        centros_asignados: r.centros_asignados,
        activo: r.activo,
        especialidades: r.especialidades,
        created_at: tsToIso(r.created_at),
        updated_at: tsToIso(r.updated_at),
      }))
      .sort((a, b) => a.email.localeCompare(b.email, "es"));
  });
}

const createUserBaseSchema = z.object({
  email: z.string().email("Correo inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres").optional(),
  display_name: z.string().trim().max(200).optional(),
  centro: z.string().trim().max(120).optional().default(""),
  /** Solo aplica a rol `tecnico`: varios centros conocidos. */
  centros_tecnico: z.array(z.string().trim().min(1)).max(20).optional(),
  /** Solo aplica a rol `tecnico`: especialidades del grupo. */
  especialidades_tecnico: z.array(ESPECIALIDADES_TECNICO).max(4).optional(),
});

function normalizarCentrosAlta(input: {
  rol: z.infer<typeof assignableBySuperSchema>;
  centro: string;
  centros_tecnico?: string[];
}): string[] {
  if (toPermisoRol(input.rol) === "tecnico") {
    const fromArr = [...new Set((input.centros_tecnico ?? []).map((c) => c.trim()).filter(Boolean))].filter((c) =>
      isCentroInKnownList(c),
    );
    if (fromArr.length > 0) return [...fromArr].sort((a, b) => a.localeCompare(b));
    const c = input.centro.trim();
    if (c && isCentroInKnownList(c)) return [c];
    throw new AppError("VALIDATION", "Elegí al menos un centro para el técnico");
  }
  const cRaw = input.centro.trim();
  const fallbackCentro = (KNOWN_CENTROS[0] ?? DEFAULT_CENTRO).trim();
  const c =
    !cRaw ? fallbackCentro : isCentroInKnownList(cRaw) ? cRaw : null;
  if (c == null) {
    throw new AppError("VALIDATION", "El centro no está en la lista configurada (KNOWN_CENTROS)");
  }
  if (input.centros_tecnico != null && input.centros_tecnico.length > 0) {
    throw new AppError("VALIDATION", "Solo los técnicos pueden tener varios centros");
  }
  return [c];
}

export async function actionCreateUser(
  idToken: string,
  raw: z.infer<typeof createUserBaseSchema> & { rol: string },
): Promise<ActionResult<{ uid: string; setupLink?: string }>> {
  return wrap(async () => {
    const actor = await requirePermisoFromToken(idToken, "admin:gestionar_usuarios");
    const rolSchema = isSuperAdminRole(actor.rol) ? assignableBySuperSchema : assignableByAdminSchema;
    const input = createUserBaseSchema.extend({ rol: rolSchema }).parse(raw);
    const centrosNorm = normalizarCentrosAlta(input);

    if (!isSuperAdminRole(actor.rol)) {
      const permitidos = centrosEfectivosDelUsuario(actor);
      for (const c of centrosNorm) {
        if (!permitidos.includes(c)) {
          throw new AppError("FORBIDDEN", "Solo el superadmin puede crear usuarios fuera de tus centros");
        }
      }
    }

    const auth = getAdminAuth();
    const db = getAdminDb();
    const display =
      input.display_name?.trim() || input.email.split("@")[0] || "usuario";
    const emailNorm = input.email.trim().toLowerCase();
    const password =
      input.password ??
      `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}A1!`;

    let uid = "";
    try {
      const record = await auth.createUser({
        email: emailNorm,
        password,
        displayName: display,
      });
      uid = record.uid;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("email-already-exists")) {
        throw new AppError("VALIDATION", "Ya existe una cuenta con ese correo");
      }
      throw new AppError("INTERNAL", `No se pudo crear el usuario en Auth: ${msg}`, { cause: e });
    }

    const ref = db.collection(USERS_COLLECTION).doc(uid);
    const primaryCentro = centrosNorm[0]!;
    try {
      const docPayload: Record<string, unknown> = {
        email: emailNorm,
        display_name: display,
        rol: input.rol,
        centro: primaryCentro,
        activo: true,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      };
      if (centrosNorm.length > 1) {
        docPayload.centros_asignados = centrosNorm;
      }
      if (toPermisoRol(input.rol) === "tecnico" && input.especialidades_tecnico?.length) {
        docPayload.especialidades = input.especialidades_tecnico;
      }
      await ref.set(docPayload);
    } catch (e: unknown) {
      try {
        await auth.deleteUser(uid);
      } catch {
        /* ignore */
      }
      throw new AppError("INTERNAL", "No se pudo guardar el perfil en Firestore", { cause: e });
    }

    const profile = (await ref.get()).data()!;
    await syncUserCustomClaims(uid, profile as never);

    let setupLink: string | undefined;
    try {
      setupLink = await auth.generatePasswordResetLink(emailNorm);
    } catch {
      setupLink = undefined;
    }

    await appendAdminAuditLog({
      actorUid: actor.uid,
      action: "user.create",
      targetUid: uid,
      metadata: { email: emailNorm, rol: input.rol, centro: primaryCentro, centros: centrosNorm },
    });

    return { uid, setupLink };
  });
}

const updateRolSchemaSuper = z.object({
  targetUid: z.string().min(1),
  rol: assignableBySuperSchema,
});

const updateRolSchemaAdmin = z.object({
  targetUid: z.string().min(1),
  rol: assignableByAdminSchema,
});

export async function actionUpdateUserRole(
  idToken: string,
  raw: z.infer<typeof updateRolSchemaSuper>,
): Promise<ActionResult<{ ok: true }>> {
  return wrap(async () => {
    const actor = await requirePermisoFromToken(idToken, "admin:gestionar_usuarios");
    const schema = isSuperAdminRole(actor.rol) ? updateRolSchemaSuper : updateRolSchemaAdmin;
    const input = schema.parse(raw);

    if (input.targetUid === actor.uid) {
      throw new AppError("FORBIDDEN", "No podés cambiar tu propio rol desde aquí");
    }

    const target = await getUserProfileByUid(input.targetUid);
    if (!target) {
      throw new AppError("NOT_FOUND", "Usuario no encontrado");
    }

    if (!isSuperAdminRole(actor.rol)) {
      if (!perfilesCompartenCentro(actor, target)) {
        throw new AppError("FORBIDDEN", "No podés editar usuarios de otro centro");
      }
      if (isSuperAdminRole(target.rol)) {
        throw new AppError("FORBIDDEN", "No podés modificar al superadmin");
      }
    }

    await adminUpdateUserRol(input.targetUid, input.rol);
    let updated = await getUserProfileByUid(input.targetUid);
    if (updated && isSuperAdminRole(updated.rol) && !isCentroInKnownList((updated.centro ?? "").trim())) {
      await adminUpdateUserCentro(input.targetUid, DEFAULT_CENTRO);
      updated = await getUserProfileByUid(input.targetUid);
    }
    if (updated) {
      await syncUserCustomClaims(input.targetUid, updated);
    }

    await appendAdminAuditLog({
      actorUid: actor.uid,
      action: "user.update_rol",
      targetUid: input.targetUid,
      metadata: { nuevoRol: input.rol },
    });

    return { ok: true } as const;
  });
}

const setActivoSchema = z.object({
  targetUid: z.string().min(1),
  activo: z.boolean(),
});

export async function actionSetUserActivo(
  idToken: string,
  raw: z.infer<typeof setActivoSchema>,
): Promise<ActionResult<{ ok: true }>> {
  return wrap(async () => {
    const actor = await requirePermisoFromToken(idToken, "admin:gestionar_usuarios");
    const input = setActivoSchema.parse(raw);

    if (input.targetUid === actor.uid && !input.activo) {
      throw new AppError("FORBIDDEN", "No podés archivar tu propia cuenta");
    }

    const target = await getUserProfileByUid(input.targetUid);
    if (!target) {
      throw new AppError("NOT_FOUND", "Usuario no encontrado");
    }

    if (!isSuperAdminRole(actor.rol)) {
      if (!perfilesCompartenCentro(actor, target)) {
        throw new AppError("FORBIDDEN", "No podés editar usuarios de otro centro");
      }
      if (isSuperAdminRole(target.rol)) {
        throw new AppError("FORBIDDEN", "No podés modificar al superadmin");
      }
    }

    if (isSuperAdminRole(target.rol) && !input.activo && !isSuperAdminRole(actor.rol)) {
      throw new AppError("FORBIDDEN", "No podés archivar al superadmin");
    }

    await adminSetUserActivo(input.targetUid, input.activo);

    const updated = await getUserProfileByUid(input.targetUid);
    if (updated) {
      await syncUserCustomClaims(input.targetUid, updated);
    }

    await appendAdminAuditLog({
      actorUid: actor.uid,
      action: "user.set_activo",
      targetUid: input.targetUid,
      metadata: { activo: input.activo },
    });

    return { ok: true } as const;
  });
}

const updateEspecialidadesSchema = z.object({
  targetUid: z.string().min(1),
  especialidades: z.array(ESPECIALIDADES_TECNICO).max(4),
});

export async function actionUpdateUserEspecialidades(
  idToken: string,
  raw: z.infer<typeof updateEspecialidadesSchema>,
): Promise<ActionResult<{ ok: true }>> {
  return wrap(async () => {
    const actor = await requirePermisoFromToken(idToken, "admin:gestionar_usuarios");
    const input = updateEspecialidadesSchema.parse(raw);

    const target = await getUserProfileByUid(input.targetUid);
    if (!target) throw new AppError("NOT_FOUND", "Usuario no encontrado");

    if (toPermisoRol(target.rol) !== "tecnico") {
      throw new AppError("VALIDATION", "Las especialidades solo aplican a técnicos");
    }

    if (!isSuperAdminRole(actor.rol) && !perfilesCompartenCentro(actor, target)) {
      throw new AppError("FORBIDDEN", "No podés editar usuarios de otro centro");
    }

    const db = getAdminDb();
    await db
      .collection(USERS_COLLECTION)
      .doc(input.targetUid)
      .update({
        especialidades: input.especialidades,
        updated_at: FieldValue.serverTimestamp(),
      });

    await appendAdminAuditLog({
      actorUid: actor.uid,
      action: "user.update_especialidades",
      targetUid: input.targetUid,
      metadata: { especialidades: input.especialidades },
    });

    return { ok: true } as const;
  });
}

const updateCentroSchema = z.object({
  targetUid: z.string().min(1),
  centro: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((c) => isCentroInKnownList(c), "El centro debe ser uno de la lista configurada (KNOWN_CENTROS)."),
});

export async function actionUpdateUserCentro(
  idToken: string,
  raw: z.infer<typeof updateCentroSchema>,
): Promise<ActionResult<{ ok: true }>> {
  return wrap(async () => {
    const actor = await requirePermisoFromToken(idToken, "admin:gestionar_usuarios");
    if (!isSuperAdminRole(actor.rol)) {
      throw new AppError("FORBIDDEN", "Solo el superadmin puede cambiar el centro de un usuario");
    }

    const input = updateCentroSchema.parse(raw);
    if (input.targetUid === actor.uid) {
      throw new AppError("FORBIDDEN", "Cambiá tu centro desde otra herramienta o pidiendo a otro superadmin");
    }

    await adminUpdateUserCentro(input.targetUid, input.centro);
    const updated = await getUserProfileByUid(input.targetUid);
    if (updated) {
      await syncUserCustomClaims(input.targetUid, updated);
    }

    await appendAdminAuditLog({
      actorUid: actor.uid,
      action: "user.update_centro",
      targetUid: input.targetUid,
      metadata: { centro: input.centro.trim() },
    });

    return { ok: true } as const;
  });
}

const updateCentrosSchema = z.object({
  targetUid: z.string().min(1),
  centros: z
    .array(z.string().trim().min(1).max(120))
    .min(1, "Elegí al menos un centro")
    .max(20)
    .refine(
      (arr) => arr.every((c) => isCentroInKnownList(c)),
      "Todos los centros deben estar en la lista configurada (KNOWN_CENTROS).",
    ),
});

/** Para técnicos: guarda uno o varios centros. Solo superadmin. */
export async function actionUpdateUserCentros(
  idToken: string,
  raw: z.infer<typeof updateCentrosSchema>,
): Promise<ActionResult<{ ok: true }>> {
  return wrap(async () => {
    const actor = await requirePermisoFromToken(idToken, "admin:gestionar_usuarios");
    if (!isSuperAdminRole(actor.rol)) {
      throw new AppError("FORBIDDEN", "Solo el superadmin puede cambiar los centros de un usuario");
    }

    const input = updateCentrosSchema.parse(raw);
    if (input.targetUid === actor.uid) {
      throw new AppError("FORBIDDEN", "Cambiá tus centros desde otra herramienta o pedile a otro superadmin");
    }

    const target = await getUserProfileByUid(input.targetUid);
    if (!target) throw new AppError("NOT_FOUND", "Usuario no encontrado");
    if (toPermisoRol(target.rol) !== "tecnico") {
      throw new AppError("VALIDATION", "Solo los técnicos pueden tener múltiples centros asignados");
    }

    await adminUpdateUserCentros(input.targetUid, input.centros);
    const updated = await getUserProfileByUid(input.targetUid);
    if (updated) {
      await syncUserCustomClaims(input.targetUid, updated);
    }

    await appendAdminAuditLog({
      actorUid: actor.uid,
      action: "user.update_centros",
      targetUid: input.targetUid,
      metadata: { centros: input.centros },
    });

    return { ok: true } as const;
  });
}
