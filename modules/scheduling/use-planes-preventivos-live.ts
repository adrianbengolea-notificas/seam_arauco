/* eslint-disable react-hooks/set-state-in-effect -- Suscripción Firestore: reset síncrono al cambiar filtros/sesión. */
"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import { CENTRO_SELECTOR_TODAS_PLANTAS, KNOWN_CENTROS } from "@/lib/config/app-config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { PlanMantenimientoFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import { collection, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

/**
 * Solo `where("centro")`: índice simple automático por campo (sin composites).
 * Activos (`activo === true`) en cliente; orden por `numero` en `planesMerged`.
 * Sin `limit`; el volumen por planta hoy es acotado.
 */
function planDesdeSnapshot(id: string, data: Record<string, unknown>): PlanMantenimientoFirestore {
  return { id, ...data } as PlanMantenimientoFirestore;
}

function compararPlanes(a: PlanMantenimientoFirestore, b: PlanMantenimientoFirestore): number {
  const na = String(a.numero ?? "").localeCompare(String(b.numero ?? ""), undefined, { numeric: true });
  if (na !== 0) return na;
  return a.id.localeCompare(b.id);
}

/** Evita suscripciones duplicadas al mismo centro y filas repetidas en el merge. */
function centrosParaSuscripcionUnicos(centros: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of centros) {
    const k = c.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * Suscripción a planes preventivos activos (`plan_mantenimiento`), una planta o merge de KNOWN_CENTROS (todo).
 */
export function usePlanesPreventivosLive(
  authUid: string | undefined,
  centro: string | undefined,
): {
  planes: PlanMantenimientoFirestore[];
  loading: boolean;
  error: Error | null;
} {
  const centroKey = useMemo(() => centro?.trim() || "", [centro]);
  const [porCentro, setPorCentro] = useState<Record<string, PlanMantenimientoFirestore[]>>({});
  const [loading, setLoading] = useState(Boolean(authUid && centroKey));
  const [error, setError] = useState<Error | null>(null);

  const centrosSuscripcion = useMemo(() => {
    if (!centroKey) return [];
    if (centroKey === CENTRO_SELECTOR_TODAS_PLANTAS) return [...KNOWN_CENTROS];
    return [centroKey];
  }, [centroKey]);

  const centrosSubsUnicos = useMemo(
    () => centrosParaSuscripcionUnicos(centrosSuscripcion),
    [centrosSuscripcion],
  );

  useEffect(() => {
    if (!authUid || !centroKey) {
      setPorCentro({});
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const unsubs: Unsubscribe[] = [];
    const nSubs = centrosSubsUnicos.length;
    const gotFirstSnapshot = new Set<string>();

    setPorCentro({});
    setLoading(true);
    setError(null);
    gotFirstSnapshot.clear();

    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setPorCentro({});
          setLoading(false);
          setError(null);
        }
        return;
      }

      const db = getFirebaseDb();

      function touchLoaded(cCode: string) {
        gotFirstSnapshot.add(cCode);
        if (gotFirstSnapshot.size >= nSubs) setLoading(false);
      }

      const qBase = (c: string) => query(collection(db, COLLECTIONS.plan_mantenimiento), where("centro", "==", c));

      for (const c of centrosSubsUnicos) {
        const unsub = onSnapshot(
          qBase(c),
          (snap) => {
            if (cancelled) return;
            const listRaw = snap.docs.map((d) => planDesdeSnapshot(d.id, d.data() as Record<string, unknown>));
            const list = listRaw.filter((p) => p.activo === true);
            setPorCentro((prev) => ({ ...prev, [c]: list }));
            touchLoaded(c);
            setError(null);
          },
          (err) => {
            if (cancelled) return;
            setError(err);
            touchLoaded(c);
          },
        );
        unsubs.push(unsub);
      }
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [authUid, centroKey, centrosSubsUnicos]);

  const planesMerged = useMemo(() => {
    const out: PlanMantenimientoFirestore[] = [];
    const seenId = new Set<string>();
    for (const c of centrosSubsUnicos) {
      const chunk = porCentro[c];
      if (!chunk?.length) continue;
      for (const p of chunk) {
        if (seenId.has(p.id)) continue;
        seenId.add(p.id);
        out.push(p);
      }
    }
    out.sort(compararPlanes);
    return out;
  }, [porCentro, centrosSubsUnicos]);

  return {
    planes: planesMerged,
    loading,
    error,
  };
}
