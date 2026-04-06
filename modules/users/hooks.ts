"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import type { UserProfile } from "@/modules/users/types";
import type { User } from "firebase/auth";
import { onAuthStateChanged, type Unsubscribe } from "firebase/auth";
import { collection, doc, limit, onSnapshot, query, where, type Unsubscribe as FirestoreUnsub } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { tienePermiso, toPermisoRol } from "@/lib/permisos/index";
import { isSuperAdminRole } from "@/modules/users/roles";
import type { UserProfileWithUid } from "@/modules/users/repository";

/** Sesión + perfil Firestore en un solo hook (p. ej. pantallas del dashboard). */
export function useAuth(): {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: Error | null;
} {
  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading, error } = useUserProfile(user?.uid);
  const loading = authLoading || (Boolean(user?.uid) && profileLoading);
  return { user, profile, loading, error };
}

export function useAuthUser(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsub: Unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return { user, loading };
}

export async function getClientIdToken(): Promise<string | null> {
  const auth = getFirebaseAuth();
  const u = auth.currentUser;
  if (!u) return null;
  return u.getIdToken(true);
}

export function useUserProfile(uid: string | undefined): {
  profile: UserProfile | null;
  loading: boolean;
  error: Error | null;
} {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(uid));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!uid) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const db = getFirebaseDb();
    const ref = doc(db, "users", uid);
    const unsub: FirestoreUnsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile(snap.data() as UserProfile);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [uid]);

  return { profile, loading, error };
}

export function useUsers(filters?: { rol?: string; activo?: boolean | null }): {
  users: UserProfileWithUid[];
  loading: boolean;
  error: Error | null;
} {
  const { user, profile, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<UserProfileWithUid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const can = useMemo(() => {
    if (!profile) return false;
    return tienePermiso(toPermisoRol(profile.rol), "admin:gestionar_usuarios");
  }, [profile]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.uid || !profile || !can) {
      setUsers([]);
      setLoading(false);
      setError(null);
      return;
    }

    const db = getFirebaseDb();
    const base = collection(db, "users");
    const q = isSuperAdminRole(profile.rol)
      ? query(base, limit(500))
      : query(base, where("centro", "==", profile.centro), limit(500));

    const unsub = onSnapshot(
      q,
      (snap) => {
        let rows: UserProfileWithUid[] = snap.docs.map((d) => ({
          uid: d.id,
          ...(d.data() as UserProfile),
        }));
        if (filters?.rol != null && filters.rol !== "") {
          rows = rows.filter((u) => toPermisoRol(u.rol) === toPermisoRol(filters.rol!));
        }
        if (filters?.activo != null) {
          rows = rows.filter((u) => u.activo === filters.activo);
        }
        setUsers(rows.sort((a, b) => a.email.localeCompare(b.email, "es")));
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [user?.uid, profile, authLoading, can, filters?.rol, filters?.activo]);

  return { users, loading: authLoading || loading, error };
}

