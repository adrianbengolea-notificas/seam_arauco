"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DEFAULT_CENTRO } from "@/lib/config/app-config";
import { mergeCentroConfig } from "@/modules/centros/merge-config";
import type { CentroConfigEffective } from "@/modules/centros/types";
import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { useEffect, useState } from "react";

/**
 * Escucha en tiempo real `centros/{centroId}` para toggles que afectan nav y formularios.
 */
export function useCentroConfigLive(centroId: string | undefined | null): {
  config: CentroConfigEffective;
  loading: boolean;
  error: Error | null;
} {
  const id = (centroId?.trim() || DEFAULT_CENTRO).trim();
  const [config, setConfig] = useState<CentroConfigEffective>(() => mergeCentroConfig(undefined));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsub: Unsubscribe | undefined;
    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setConfig(mergeCentroConfig(undefined));
          setLoading(false);
          setError(null);
        }
        return;
      }
      const db = getFirebaseDb();
      const ref = doc(db, COLLECTIONS.centros, id);
      unsub = onSnapshot(
        ref,
        (snap) => {
          setConfig(mergeCentroConfig(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined));
          setLoading(false);
          setError(null);
        },
        (err) => {
          setError(err);
          setLoading(false);
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [id]);

  return { config, loading, error };
}
