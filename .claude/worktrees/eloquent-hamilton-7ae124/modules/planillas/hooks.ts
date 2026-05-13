/* eslint-disable react-hooks/set-state-in-effect -- Suscripción Firestore tras auth lista (evita listener sin sesión). */
"use client";

import { getFirebaseDb } from "@/firebase/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { PlanillaTemplate } from "@/lib/firestore/types";
import { useAuthUser } from "@/modules/users/hooks";
import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { useEffect, useState } from "react";

/** Catálogo global de definiciones (solo lectura en UI). */
export function usePlanillaTemplatesLive(): {
  templates: PlanillaTemplate[];
  loading: boolean;
  error: Error | null;
} {
  const { user, loading: authLoading } = useAuthUser();
  const [templates, setTemplates] = useState<PlanillaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }
    if (!user) {
      setTemplates([]);
      setError(null);
      setLoading(false);
      return;
    }

    const db = getFirebaseDb();
    const col = collection(db, COLLECTIONS.planilla_templates);
    setLoading(true);
    setError(null);

    const unsub: Unsubscribe = onSnapshot(
      col,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as PlanillaTemplate);
        const order = ["GG", "ELEC", "AA", "CORRECTIVO"];
        rows.sort((a, b) => {
          const ia = order.indexOf(a.id);
          const ib = order.indexOf(b.id);
          if (ia >= 0 && ib >= 0) return ia - ib;
          if (ia >= 0) return -1;
          if (ib >= 0) return 1;
          return a.id.localeCompare(b.id);
        });
        setTemplates(rows);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [authLoading, user]);

  return { templates, loading, error };
}
