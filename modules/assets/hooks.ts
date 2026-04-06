"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import type { Asset } from "@/modules/assets/types";
import { onAuthStateChanged, type Unsubscribe as AuthUnsub } from "firebase/auth";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useState } from "react";

export function useAssetsLive(max: number = 200): {
  assets: Asset[];
  loading: boolean;
  error: Error | null;
} {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
        const q = query(collection(db, "assets"), orderBy("codigo_nuevo"), limit(max));
        unsubSnap = onSnapshot(
          q,
          (snap) => {
            const rows: Asset[] = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<Asset, "id">),
            }));
            setAssets(rows);
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
  }, [max]);

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
