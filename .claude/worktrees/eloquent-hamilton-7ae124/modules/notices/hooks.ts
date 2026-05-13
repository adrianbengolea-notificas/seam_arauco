"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ModoImportacionAvisos } from "@/lib/importaciones/avisos-excel-admin";
import type { Aviso } from "@/modules/notices/types";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { startTransition, useEffect, useState } from "react";

const LIST_LIMIT = 450;

export type TabImportacionAvisosId = ModoImportacionAvisos | "semanal_info";

/**
 * Avisos mostrados en Configuración → importación, según pestaña (tabs alineadas a modos Excel).
 */
export async function fetchAvisosImportacionConfig(
  db: Firestore,
  tabId: TabImportacionAvisosId,
  opts: { centro: string; verTodosLosCentros: boolean },
): Promise<Aviso[]> {
  const { centro, verTodosLosCentros } = opts;
  const col = collection(db, COLLECTIONS.avisos);
  const c = centro.trim();
  const scoped = !verTodosLosCentros && Boolean(c);

  if (tabId === "semanal_info") return [];

  if (tabId === "preventivos_todas") {
    const q = scoped
      ? query(col, where("centro", "==", c), where("tipo", "==", "PREVENTIVO"), limit(LIST_LIMIT))
      : query(col, where("tipo", "==", "PREVENTIVO"), limit(LIST_LIMIT));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Aviso);
  }

  if (tabId === "correctivos") {
    const q = scoped
      ? query(col, where("centro", "==", c), where("tipo", "==", "CORRECTIVO"), limit(LIST_LIMIT))
      : query(col, where("tipo", "==", "CORRECTIVO"), limit(LIST_LIMIT));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Aviso);
  }

  if (tabId === "listado_semestral_anual") {
    const q = scoped
      ? query(
          col,
          where("centro", "==", c),
          where("frecuencia_plan_mtsa", "in", ["S", "A"]),
          limit(LIST_LIMIT),
        )
      : query(col, where("frecuencia_plan_mtsa", "in", ["S", "A"]), limit(LIST_LIMIT));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Aviso)
      .filter((a) => a.tipo === "PREVENTIVO");
  }

  const mtsaFromTab: Partial<Record<ModoImportacionAvisos, "M" | "T" | "S" | "A">> = {
    preventivos_mensual: "M",
    mensuales_parche: "M",
    preventivos_trimestral: "T",
    preventivos_semestral: "S",
    preventivos_anual: "A",
  };
  const letter = mtsaFromTab[tabId];
  if (!letter) return [];

  const qMtsa = scoped
    ? query(col, where("centro", "==", c), where("frecuencia_plan_mtsa", "==", letter), limit(LIST_LIMIT))
    : query(col, where("frecuencia_plan_mtsa", "==", letter), limit(LIST_LIMIT));

  const freqMatch: Aviso["frecuencia"] =
    letter === "M"
      ? "MENSUAL"
      : letter === "T"
        ? "TRIMESTRAL"
        : letter === "S"
          ? "SEMESTRAL"
          : "ANUAL";

  const snapM = await getDocs(qMtsa);
  const map = new Map<string, Aviso>();
  for (const d of snapM.docs) {
    const a = { id: d.id, ...d.data() } as Aviso;
    if (a.tipo === "PREVENTIVO") map.set(a.id, a);
  }

  try {
    const qF = scoped
      ? query(col, where("centro", "==", c), where("frecuencia", "==", freqMatch), limit(LIST_LIMIT))
      : query(col, where("frecuencia", "==", freqMatch), limit(LIST_LIMIT));
    const snapF = await getDocs(qF);
    for (const d of snapF.docs) {
      const a = { id: d.id, ...d.data() } as Aviso;
      if (a.tipo === "PREVENTIVO") map.set(a.id, a);
    }
  } catch {
    /* Índice compuesto (centro+frecuencia) no desplegado: se listan solo los que tienen badge M/T/S/A. */
  }

  return [...map.values()];
}

export function useAvisosListaImportacionConfig(input: {
  tabId: TabImportacionAvisosId;
  authUid: string | undefined;
  centro: string;
  verTodosLosCentros: boolean;
  refreshToken: number;
}): { avisos: Aviso[]; loading: boolean; error: Error | null } {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [loading, setLoading] = useState(Boolean(input.authUid && input.tabId !== "semanal_info"));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!input.authUid || input.tabId === "semanal_info") {
      startTransition(() => {
        setAvisos([]);
        setLoading(false);
        setError(null);
      });
      return;
    }

    let cancelled = false;
    startTransition(() => {
      setLoading(true);
      setError(null);
    });

    void (async () => {
      try {
        const auth = getFirebaseAuth();
        await auth.authStateReady();
        if (!auth.currentUser || cancelled) {
          if (!cancelled) {
            setAvisos([]);
            setLoading(false);
          }
          return;
        }
        const db = getFirebaseDb();
        const list = await fetchAvisosImportacionConfig(db, input.tabId, {
          centro: input.centro,
          verTodosLosCentros: input.verTodosLosCentros,
        });
        if (cancelled) return;
        list.sort((a, b) =>
          (a.n_aviso || "").localeCompare(b.n_aviso || "", undefined, { numeric: true }),
        );
        setAvisos(list);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setAvisos([]);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [input.tabId, input.authUid, input.centro, input.verTodosLosCentros, input.refreshToken]);

  return { avisos, loading, error };
}
