import { getAdminAuth, getAdminDb } from "@/firebase/firebaseAdmin";
import { DEFAULT_CENTRO } from "@/lib/config/app-config";
import { roleForEmailAndUid } from "@/lib/config/superadmin";
import { toPermisoRol } from "@/lib/permisos/index";
import type { UserProfile, UserRole } from "@/modules/users/types";
import { FieldValue } from "firebase-admin/firestore";

export const USERS_COLLECTION = "users";

export type UserProfileWithUid = UserProfile & { uid: string };

const AUDITORIA_COLLECTION = "admin_audit_log";

export async function appendAdminAuditLog(input: {
  actorUid: string;
  action: string;
  targetUid?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await getAdminDb().collection(AUDITORIA_COLLECTION).add({
    actorUid: input.actorUid,
    action: input.action,
    targetUid: input.targetUid ?? null,
    metadata: input.metadata ?? {},
    created_at: FieldValue.serverTimestamp(),
  });
}

/** Sincroniza custom claims (`rol`, `centro`) con el perfil Firestore. */
export async function syncUserCustomClaims(uid: string, profile: UserProfile): Promise<void> {
  await getAdminAuth().setCustomUserClaims(uid, {
    rol: toPermisoRol(profile.rol),
    centro: profile.centro ?? "",
  });
}

export async function listUserProfilesWithUid(limit = 500): Promise<UserProfileWithUid[]> {
  const snap = await getAdminDb().collection(USERS_COLLECTION).limit(limit).get();
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as UserProfile) }));
}

export type ListUsersFilters = {
  limit?: number;
  centro?: string | null;
  rol?: UserRole;
  activo?: boolean | null;
};

export async function listUserProfilesFiltered(filters: ListUsersFilters): Promise<UserProfileWithUid[]> {
  const cap = Math.min(filters.limit ?? 500, 1000);
  const snap = await getAdminDb().collection(USERS_COLLECTION).limit(cap).get();
  let rows = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as UserProfile) }));
  if (filters.centro != null && filters.centro !== "") {
    const c = filters.centro.trim();
    rows = rows.filter((r) => (r.centro ?? "").trim() === c);
  }
  if (filters.rol != null) {
    rows = rows.filter((r) => toPermisoRol(r.rol) === toPermisoRol(filters.rol!));
  }
  if (filters.activo != null) {
    rows = rows.filter((r) => r.activo === filters.activo);
  }
  return rows;
}

export async function adminUpdateUserRol(uid: string, rol: UserRole): Promise<void> {
  await getAdminDb().collection(USERS_COLLECTION).doc(uid).update({
    rol,
    updated_at: FieldValue.serverTimestamp(),
  });
}

export async function adminUpdateUserCentro(uid: string, centro: string): Promise<void> {
  await getAdminDb().collection(USERS_COLLECTION).doc(uid).update({
    centro: centro.trim(),
    updated_at: FieldValue.serverTimestamp(),
  });
}

export async function adminSetUserActivo(uid: string, activo: boolean): Promise<void> {
  await getAdminDb().collection(USERS_COLLECTION).doc(uid).update({
    activo,
    updated_at: FieldValue.serverTimestamp(),
  });
}

export async function getUserProfileByUid(uid: string): Promise<UserProfile | null> {
  const snap = await getAdminDb().collection(USERS_COLLECTION).doc(uid).get();
  if (!snap.exists) return null;
  return snap.data() as UserProfile;
}

/**
 * Crea el documento `users/{uid}` si no existe (solo Admin SDK; reglas cliente: write false).
 */
export async function ensureUserProfileCreated(input: {
  uid: string;
  email: string;
  displayName: string;
  centro?: string;
  defaultRole?: UserRole;
}): Promise<UserProfile> {
  const ref = getAdminDb().collection(USERS_COLLECTION).doc(input.uid);
  const snap = await ref.get();
  const centro = input.centro ?? DEFAULT_CENTRO;
  const resolvedRol = roleForEmailAndUid(input.email, input.uid, input.defaultRole ?? "tecnico");

  if (snap.exists) {
    const data = snap.data() as UserProfile;
    const updates: Record<string, unknown> = {};
    if (data.rol === "super_admin") {
      updates.rol = "superadmin";
    }
    if (resolvedRol === "superadmin" && toPermisoRol(data.rol) !== "superadmin") {
      updates.rol = "superadmin";
    }
    if (Object.keys(updates).length) {
      updates.updated_at = FieldValue.serverTimestamp();
      await ref.update(updates);
    }
    const finalSnap = await ref.get();
    return finalSnap.data() as UserProfile;
  }

  const rol: UserRole = resolvedRol;

  await ref.set({
    email: input.email,
    display_name: input.displayName || input.email,
    rol,
    centro,
    activo: true,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  const created = await ref.get();
  return created.data() as UserProfile;
}
