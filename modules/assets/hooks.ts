"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import type { Asset } from "@/modules/assets/types";
import { onAuthStateChanged, type Unsubscribe as AuthUnsub } from "firebase/auth";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

function sortAssetsByCodigo(rows: Asset[]): Asset[] {
  return [...rows].sort((a, b) =>
    (a.codigo_nuevo ?? "").localeCompare(b.codigo_nuevo ?? "", "es", { numeric: true }),
  );
}

/**
 * @param max Máximo de documentos (por defecto 200).
 * @param options
 *   - `centro`: filtra en Firestore por centro (evita lista vacía al filtrar client-side los primeros N globales).
 *   - `especialidad`: filtra en Firestore por especialidad_predeterminada (evita el problema de limit cuando hay >200 activos).
 */
export function useAssetsLive(
  max: number = 200,
  options?: { centro?: string | null; especialidad?: string | null },
): {
  assets: Asset[];
  loading: boolean;
  error: Error | null;
} {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const centroQ = options?.centro?.trim() || "";
  const especialidadQ = options?.especialidad?.trim() || "";

  useEffect(() => {
    const auth = getFirebaseAuth();
    let unsubAuth: AuthUnsub | undefined;
    let unsubSnap: Unsubscribe | undefined;

    let effectActive = true;
    unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubSnap?.();
      unsubSnap = undefined;
      if (!user) {
        setAssets([]);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      void (async () => {
        try {
          await user.getIdToken(true);
        } catch (e) {
          if (!effectActive) return;
          setError(e instanceof Error ? e : new Error("No se pudo renovar la sesión"));
          setLoading(false);
          return;
        }
        if (!effectActive || auth.currentUser?.uid !== user.uid) return;
        const db = getFirebaseDb();
        // Construir query priorizando filtros server-side para evitar el límite de 200 docs.
        // Combinaciones: centro + esp → dos where; solo esp → where + limit; solo centro → where + limit;
        // ninguno → orderBy + limit.
        let q;
        if (centroQ && especialidadQ) {
          q = query(
            collection(db, "assets"),
            where("centro", "==", centroQ),
            where("especialidad_predeterminada", "==", especialidadQ),
            limit(max),
          );
        } else if (centroQ) {
          q = query(collection(db, "assets"), where("centro", "==", centroQ), limit(max));
        } else if (especialidadQ) {
          q = query(
            collection(db, "assets"),
            where("especialidad_predeterminada", "==", especialidadQ),
            limit(max),
          );
        } else {
          q = query(collection(db, "assets"), orderBy("codigo_nuevo"), limit(max));
        }
        unsubSnap = onSnapshot(
          q,
          (snap) => {
            const rows: Asset[] = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<Asset, "id">),
            }));
            // Ordenar cuando no hay orderBy en la query (centro o especialidad activos).
            setAssets(centroQ || especialidadQ ? sortAssetsByCodigo(rows) : rows);
            setLoading(false);
          },
          (err) => {
            setError(err);
            setLoading(false);
          },
        );
      })();
    });

    return () => {
      effectActive = false;
      unsubAuth?.();
      unsubSnap?.();
    };
  }, [max, centroQ, especialidadQ]);

  return { assets, loading, error };
}

export function useAssetLive(assetId: string | undefined): {
  asset: Asset | null;
  loading: boolean;
  error: Error | null;
} {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(Boolean(assetId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!assetId) {
      setAsset(null);
      setLoading(false);
      return;
    }

    const auth = getFirebaseAuth();
    let unsubAuth: AuthUnsub | undefined;
    let unsubSnap: Unsubscribe | undefined;

    let effectActive = true;
    unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubSnap?.();
      unsubSnap = undefined;
      if (!user) {
        setAsset(null);
        setLoading(false);
        return;
      }

      void (async () => {
        try {
          await user.getIdToken(true);
        } catch (e) {
          if (!effectActive) return;
          setError(e instanceof Error ? e : new Error("No se pudo renovar la sesión"));
          setLoading(false);
          return;
        }
        if (!effectActive || auth.currentUser?.uid !== user.uid) return;
        const db = getFirebaseDb();
        const ref = doc(db, "assets", assetId);
        unsubSnap = onSnapshot(
          ref,
          (snap) => {
            if (!snap.exists) {
              setAsset(null);
              setLoading(false);
              return;
            }
            setAsset({ id: snap.id, ...(snap.data() as Omit<Asset, "id">) });
            setLoading(false);
          },
          (err) => {
            setError(err);
            setLoading(false);
          },
        );
      })();
    });

    return () => {
      effectActive = false;
      unsubAuth?.();
      unsubSnap?.();
    };
  }, [assetId]);

  return { asset, loading, error };
}

/**
 * Denominación del maestro de activos (`denominacion`) para un conjunto acotado de IDs.
 * Uso típico: etiquetas de gráficos (pocas lecturas, sin suscripción continua).
 */
export function useDenominacionesActivosPorIds(assetIds: readonly string[]): {
  byAssetId: Record<string, string>;
  loading: boolean;
} {
  const clave = useMemo(
    () => [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))].sort().join("\0"),
    [assetIds],
  );

  const [byAssetId, setByAssetId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clave) {
      setByAssetId({});
      setLoading(false);
      return;
    }
    const ids = clave.split("\0");
    let cancelled = false;
    setLoading(true);
    const auth = getFirebaseAuth();
    void (async () => {
      const user = auth.currentUser;
      if (!user) {
        if (!cancelled) {
          setByAssetId({});
          setLoading(false);
        }
        return;
      }
      try {
        await user.getIdToken(true);
      } catch {
        if (!cancelled) setLoading(false);
        return;
      }
      if (cancelled) return;
      const db = getFirebaseDb();
      const out: Record<string, string> = {};
      await Promise.all(
        ids.map(async (id) => {
          const snap = await getDoc(doc(db, COLLECTIONS.assets, id));
          if (!snap.exists()) return;
          const d = snap.data() as { denominacion?: string };
          const den = d.denominacion?.trim();
          if (den) out[id] = den;
        }),
      );
      if (!cancelled) {
        setByAssetId(out);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clave]);

  return { byAssetId, loading };
}
