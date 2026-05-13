"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { WorkOrderEstado } from "@/modules/work-orders/types";
import { collection, documentId, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";

const IN_CHUNK = 30;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Estados de OTs (`work_orders`) para los ids indicados.
 * Usado en la grilla del programa publicado para colorear chips según `estado`.
 */
export function useWorkOrderEstadosForIds(idsInput: (string | undefined)[] | undefined): {
  estados: Map<string, WorkOrderEstado>;
  loading: boolean;
} {
  const ids = useMemo(() => {
    const s = new Set<string>();
    for (const id of idsInput ?? []) {
      const t = id?.trim();
      if (t) s.add(t);
    }
    return [...s].sort();
  }, [idsInput]);

  const [estados, setEstados] = useState(() => new Map<string, WorkOrderEstado>());
  const [loading, setLoading] = useState(false);

  const idsKey = ids.join("\0");

  const unsubsRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (!ids.length) {
      setEstados(new Map());
      setLoading(false);
      return;
    }

    let cancelled = false;
    const db = getFirebaseDb();
    const acc = new Map<string, WorkOrderEstado>();
    unsubsRef.current = [];
    const chunks = chunk(ids, IN_CHUNK);

    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        setEstados(new Map());
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
        const qRef = query(
          collection(db, COLLECTIONS.work_orders),
          where(documentId(), "in", chunkIds),
        );
        const idx = ci;
        const unsub = onSnapshot(
          qRef,
          (snap) => {
            if (cancelled) return;
            const seen = new Set<string>();
            for (const d of snap.docs) {
              seen.add(d.id);
              const raw = d.data()?.estado as WorkOrderEstado | undefined;
              acc.set(d.id, raw ?? "ABIERTA");
            }
            for (const id of chunkIds) {
              if (!seen.has(id)) acc.delete(id);
            }
            setEstados(new Map(acc));
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

  return { estados, loading };
}
