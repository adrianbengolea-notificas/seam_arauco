"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { collection, documentId, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";

const IN_CHUNK = 30;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Para cada id de documento `avisos/{id}`, devuelve `work_order_id` si existe (vínculo en vivo con la OT).
 * Usado en programa publicado para alinear el color del chip con lo que ve el panel lateral (mismo criterio que el drawer).
 */
export function useAvisosWorkOrderIdsByDocIds(
  avisoDocIdsInput: string[] | undefined,
): { workOrderIdPorAvisoDocId: Map<string, string>; loading: boolean } {
  const ids = useMemo(() => {
    const s = new Set<string>();
    for (const id of avisoDocIdsInput ?? []) {
      const t = id?.trim();
      if (t) s.add(t);
    }
    return [...s].sort();
  }, [avisoDocIdsInput]);

  const [map, setMap] = useState(() => new Map<string, string>());
  const [loading, setLoading] = useState(false);
  const idsKey = ids.join("\0");
  const unsubsRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (!ids.length) {
      setMap(new Map());
      setLoading(false);
      return;
    }

    let cancelled = false;
    const db = getFirebaseDb();
    const acc = new Map<string, string>();
    unsubsRef.current = [];
    const chunks = chunk(ids, IN_CHUNK);

    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        setMap(new Map());
        setLoading(false);
        return;
      }
      setLoading(true);

      const yaRecibioPrimerEstado: boolean[] = chunks.map(() => false);
      let listos = 0;
      const marcarPrimerEstado = (idx: number) => {
        if (yaRecibioPrimerEstado[idx]) return;
        yaRecibioPrimerEstado[idx] = true;
        listos += 1;
        if (listos >= chunks.length) setLoading(false);
      };

      for (let ci = 0; ci < chunks.length; ci++) {
        if (cancelled) return;
        const chunkIds = chunks[ci]!;
        const idx = ci;
        const qRef = query(
          collection(db, COLLECTIONS.avisos),
          where(documentId(), "in", chunkIds),
        );
        const unsub = onSnapshot(
          qRef,
          (snap) => {
            if (cancelled) return;
            const seen = new Set<string>();
            for (const d of snap.docs) {
              seen.add(d.id);
              const wo = (d.data() as { work_order_id?: string })?.work_order_id?.trim();
              if (wo) acc.set(d.id, wo);
              else acc.delete(d.id);
            }
            for (const id of chunkIds) {
              if (!seen.has(id)) acc.delete(id);
            }
            setMap(new Map(acc));
            marcarPrimerEstado(idx);
          },
          () => {
            if (cancelled) return;
            marcarPrimerEstado(idx);
          },
        );
        unsubsRef.current.push(unsub);
      }
    })();

    return () => {
      cancelled = true;
      for (const u of unsubsRef.current) u();
      unsubsRef.current = [];
    };
  }, [idsKey]);

  return { workOrderIdPorAvisoDocId: map, loading };
}
