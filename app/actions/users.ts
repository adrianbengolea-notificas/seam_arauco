"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { toPermisoRol } from "@/lib/permisos/index";
import { getAdminAuth, getAdminDb } from "@/firebase/firebaseAdmin";
import {
  USERS_COLLECTION,
  adminSetUserActivo,
  adminUpdateUserCentro,
  adminUpdateUserRol,
  appendAdminAuditLog,
  getUserProfileByUid,
  listUserProfilesFiltered,
  syncUserCustomClaims,
} from "@/modules/users/repository";
import { isSuperAdminRole } from "@/modules/users/roles";
import type { UserRole } from "@/modules/users/types";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

const assignableByAdminSchema = z.enum(["tecnico", "supervisor", "admin"]);
const assignableBySuperSchema = z.enum(["tecnico", "supervisor", "admin", "superadmin"]);

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
  activo: boolean;
  especialidades?: Array<"AA" | "ELECTRICO" | "GG">;
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
  centro: z.string().trim().min(1).max(120),
});

export async function actionCreateUser(
  idToken: string,
  raw: z.infer<typeof createUserBaseSchema> & { rol: string },
): Promise<ActionResult<{ uid: string; setupLink?: string }>> {
  return wrap(async () => {
    const actor = await requirePermisoFromToken(idToken, "admin:gestionar_usuarios");
    const rolSchema = isSuperAdminRole(actor.rol) ? assignableBySuperSchema : assignableByAdminSchema;
    const input = createUserBaseSchema.extend({ rol: rolSchema }).parse(raw);

    if (!isSuperAdminRole(actor.rol) && input.centro.trim() !== actor.centro.trim()) {
      throw new AppError("FORBIDDEN", "Solo el superadmin puede crear usuarios en otro centro");
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
    try {
      await ref.set({
        email: emailNorm,
        display_name: display,
        rol: input.rol,
        centro: input.centro.trim(),
        activo: true,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
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
      metadata: { email: emailNorm, rol: input.rol, centro: input.centro.trim() },
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
      if (target.centro.trim() !== actor.centro.trim()) {
        throw new AppError("FORBIDDEN", "No podés editar usuarios de otro centro");
      }
      if (isSuperAdminRole(target.rol)) {
        throw new AppError("FORBIDDEN", "No podés modificar al superadmin");
      }
    }

    await adminUpdateUserRol(input.targetUid, input.rol);
    const updated = await getUserProfileByUid(input.targetUid);
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
      throw new AppError("FORBIDDEN", "No podés desactivar tu propia cuenta");
    }

    const target = await getUserProfileByUid(input.targetUid);
    if (!target) {
      throw new AppError("NOT_FOUND", "Usuario no encontrado");
    }

    if (!isSuperAdminRole(actor.rol)) {
      if (target.centro.trim() !== actor.centro.trim()) {
        throw new AppError("FORBIDDEN", "No podés editar usuarios de otro centro");
      }
      if (isSuperAdminRole(target.rol)) {
        throw new AppError("FORBIDDEN", "No podés modificar al superadmin");
      }
      if (toPermisoRol(target.rol) === "admin" && !input.activo) {
        throw new AppError("FORBIDDEN", "Solo el superadmin puede desactivar a un admin");
      }
    }

    if (isSuperAdminRole(target.rol) && !input.activo && !isSuperAdminRole(actor.rol)) {
      throw new AppError("FORBIDDEN", "No podés desactivar al superadmin");
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

const updateCentroSchema = z.object({
  targetUid: z.string().min(1),
  centro: z.string().trim().min(1).max(120),
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
