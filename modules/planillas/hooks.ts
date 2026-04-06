"use client";

import { getFirebaseDb } from "@/firebase/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { PlanillaTemplate } from "@/lib/firestore/types";
import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { useEffect, useState } from "react";

/** Catálogo global de definiciones (solo lectura en UI). */
export function usePlanillaTemplatesLive(): {
  templates: PlanillaTemplate[];
  loading: boolean;
  error: Error | null;
} {
  const [templates, setTemplates] = useState<PlanillaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const db = getFirebaseDb();
    const col = collection(db, COLLECTIONS.planilla_templates);
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
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  return { templates, loading, error };
}
