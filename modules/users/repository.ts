import { getAdminAuth, getAdminDb } from "@/firebase/firebaseAdmin";
import { DEFAULT_CENTRO, isCentroInKnownList } from "@/lib/config/app-config";
import { roleForEmailAndUid } from "@/lib/config/superadmin";
import { toPermisoRol } from "@/lib/permisos/index";
import { centrosEfectivosDelUsuario } from "@/modules/users/centros-usuario";
import type { UserProfile, UserRole } from "@/modules/users/types";
import { FieldValue, FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";

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
  const centros = centrosEfectivosDelUsuario(profile);
  await getAdminAuth().setCustomUserClaims(uid, {
    rol: toPermisoRol(profile.rol),
    /** Mismo criterio que reglas/UI: sin espacios colgados (evita `permission-denied` vs OT con `PC01`). */
    centro: centros[0] ?? "",
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
  /** Máximo de filas que devolvemos tras filtrar (no equivale a leer solo N docs de Firestore). */
  const maxOut = Math.min(filters.limit ?? 500, 5000);
  const db = getAdminDb();
  const out: UserProfileWithUid[] = [];
  let last: QueryDocumentSnapshot | null = null;
  const batch = 400;

  const passCentro = (r: UserProfileWithUid): boolean => {
    if (filters.centro == null || filters.centro === "") return true;
    return centrosEfectivosDelUsuario(r).includes(filters.centro.trim());
  };
  const passRol = (r: UserProfileWithUid): boolean => {
    if (filters.rol == null) return true;
    return toPermisoRol(r.rol) === toPermisoRol(filters.rol!);
  };
  const passActivo = (r: UserProfileWithUid): boolean => {
    if (filters.activo == null) return true;
    if (filters.activo === true) return r.activo !== false;
    return r.activo === false;
  };

  while (out.length < maxOut) {
    let q = db.collection(USERS_COLLECTION).orderBy(FieldPath.documentId()).limit(batch);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const d of snap.docs) {
      const r = { uid: d.id, ...(d.data() as UserProfile) };
      if (!passCentro(r)) continue;
      if (!passRol(r)) continue;
      if (!passActivo(r)) continue;
      out.push(r);
      if (out.length >= maxOut) break;
    }

    last = snap.docs[snap.docs.length - 1]!;
    if (snap.docs.length < batch) break;
  }

  return out;
}

export async function adminUpdateUserRol(uid: string, rol: UserRole): Promise<void> {
  await getAdminDb().collection(USERS_COLLECTION).doc(uid).update({
    rol,
    updated_at: FieldValue.serverTimestamp(),
  });
}

export async function adminUpdateUserCentro(uid: string, centro: string): Promise<void> {
  await getAdminDb()
    .collection(USERS_COLLECTION)
    .doc(uid)
    .update({
      centro: centro.trim(),
      centros_asignados: FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
}

/** Para técnicos multi-planta: guarda el primero como `centro` y la lista completa en `centros_asignados`. */
export async function adminUpdateUserCentros(uid: string, centros: string[]): Promise<void> {
  const norm = [...new Set(centros.map((c) => c.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  if (norm.length === 0) throw new Error("Debe haber al menos un centro");
  const payload: Record<string, unknown> = {
    centro: norm[0],
    updated_at: FieldValue.serverTimestamp(),
  };
  if (norm.length > 1) {
    payload.centros_asignados = norm;
  } else {
    payload.centros_asignados = FieldValue.delete();
  }
  await getAdminDb().collection(USERS_COLLECTION).doc(uid).update(payload);
}

export async function adminSetUserActivo(uid: string, activo: boolean): Promise<void> {
  await getAdminDb().collection(USERS_COLLECTION).doc(uid).update({
    activo,
    updated_at: FieldValue.serverTimestamp(),
  });
}

export async function adminUpdateUserPushSubscription(
  uid: string,
  patch: { pushSubscription?: Record<string, unknown> | null; pushHabilitado?: boolean },
): Promise<void> {
  await getAdminDb()
    .collection(USERS_COLLECTION)
    .doc(uid)
    .update({
      ...patch,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
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

    const nextRol =
      updates.rol !== undefined ? toPermisoRol(updates.rol as UserRole) : toPermisoRol(data.rol);
    if (nextRol === "superadmin") {
      const c = (data.centro ?? "").trim();
      if (!isCentroInKnownList(c)) {
        updates.centro = DEFAULT_CENTRO;
      }
    }

    /** Espacios en `centro` rompen `callerCentro() == data.centro` en reglas (ej. " PC01" vs "PC01"). */
    if (typeof data.centro === "string") {
      const raw = data.centro;
      const t = raw.trim();
      if (raw !== t) {
        updates.centro = t !== "" ? t : DEFAULT_CENTRO;
      }
    }

    if (Array.isArray(data.centros_asignados) && data.centros_asignados.length > 0) {
      const rawList = data.centros_asignados.map((x) => String(x ?? ""));
      const norm = [...new Set(rawList.map((s) => s.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      );
      const dirty =
        rawList.some((s) => s !== s.trim()) ||
        norm.length !== rawList.length ||
        norm.length !== new Set(rawList.map((s) => s.trim()).filter(Boolean)).size;
      if (dirty && norm.length > 0) {
        updates.centros_asignados = norm;
      }
    }

    if (Object.keys(updates).length) {
      updates.updated_at = FieldValue.serverTimestamp();
      await ref.update(updates);
    }
    const finalSnap = await ref.get();
    return finalSnap.data() as UserProfile;
  }

  const rol: UserRole = resolvedRol;
  let centroNuevo = (input.centro ?? "").trim();
  if (centroNuevo === "") centroNuevo = DEFAULT_CENTRO;
  if (toPermisoRol(rol) === "superadmin" && !isCentroInKnownList(centroNuevo)) {
    centroNuevo = DEFAULT_CENTRO;
  }

  await ref.set({
    email: input.email,
    display_name: input.displayName || input.email,
    rol,
    centro: centroNuevo,
    activo: true,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  const created = await ref.get();
  return created.data() as UserProfile;
}
