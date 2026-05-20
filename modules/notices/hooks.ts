"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ModoImportacionAvisos } from "@/lib/importaciones/avisos-excel-admin";
import type { Aviso } from "@/modules/notices/types";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { startTransition, useEffect, useMemo, useState } from "react";

const LIST_LIMIT = 450;

export type TabImportacionAvisosId = ModoImportacionAvisos | "semanal_info" | "todos";

function frecuenciaEnumDesdeMtsa(letter: "M" | "T" | "S" | "A"): Aviso["frecuencia"] {
  if (letter === "M") return "MENSUAL";
  if (letter === "T") return "TRIMESTRAL";
  if (letter === "S") return "SEMESTRAL";
  return "ANUAL";
}

/** Incluye badge M/T/S/A o, si falta, la frecuencia enum del maestro importado. */
function avisoCoincideTabPreventivoMtsa(a: Aviso, letter: "M" | "T" | "S" | "A"): boolean {
  if (a.tipo !== "PREVENTIVO") return false;
  if (a.frecuencia_plan_mtsa === letter) return true;
  if (!a.frecuencia_plan_mtsa?.trim() && a.frecuencia === frecuenciaEnumDesdeMtsa(letter)) return true;
  return false;
}

async function fetchPreventivosPorTabMtsa(
  db: Firestore,
  letter: "M" | "T" | "S" | "A",
  scoped: boolean,
  centro: string,
): Promise<Aviso[]> {
  const col = collection(db, COLLECTIONS.avisos);
  const map = new Map<string, Aviso>();

  const ingest = (docs: { id: string; data: () => Record<string, unknown> }[]) => {
    for (const d of docs) {
      const a = { id: d.id, ...d.data() } as Aviso;
      if (avisoCoincideTabPreventivoMtsa(a, letter)) map.set(a.id, a);
    }
  };

  const qMtsa = scoped
    ? query(col, where("centro", "==", centro), where("frecuencia_plan_mtsa", "==", letter), limit(LIST_LIMIT))
    : query(col, where("frecuencia_plan_mtsa", "==", letter), limit(LIST_LIMIT));
  ingest((await getDocs(qMtsa)).docs);

  const freqMatch = frecuenciaEnumDesdeMtsa(letter);
  try {
    const qF = scoped
      ? query(col, where("centro", "==", centro), where("frecuencia", "==", freqMatch), limit(LIST_LIMIT))
      : query(col, where("frecuencia", "==", freqMatch), limit(LIST_LIMIT));
    ingest((await getDocs(qF)).docs);
  } catch {
    const qPrev = scoped
      ? query(col, where("centro", "==", centro), where("tipo", "==", "PREVENTIVO"), limit(LIST_LIMIT))
      : query(col, where("tipo", "==", "PREVENTIVO"), limit(LIST_LIMIT));
    ingest((await getDocs(qPrev)).docs);
  }

  return [...map.values()];
}

/**
 * Avisos mostrados en Configuración e importación, según pestaña (tabs alineadas a modos Excel).
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

  if (tabId === "todos") {
    const q = scoped ? query(col, where("centro", "==", c), limit(LIST_LIMIT)) : query(col, limit(LIST_LIMIT));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Aviso);
  }

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

  return fetchPreventivosPorTabMtsa(db, letter, scoped, c);
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

export function useAvisoLive(avisoId: string | undefined, authUid: string | undefined): {
  aviso: Aviso | null;
  loading: boolean;
  error: Error | null;
} {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [loading, setLoading] = useState(Boolean(avisoId?.trim() && authUid));
  const [error, setError] = useState<Error | null>(null);

  const key = useMemo(() => (avisoId?.trim() ? avisoId.trim() : undefined), [avisoId]);

  useEffect(() => {
    if (!key || !authUid) {
      setAviso(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    let unsub: Unsubscribe | undefined;

    setLoading(true);
    setError(null);

    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setAviso(null);
          setLoading(false);
        }
        return;
      }

      const db = getFirebaseDb();
      const ref = doc(db, COLLECTIONS.avisos, key);
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (cancelled) return;
          if (!snap.exists) {
            setAviso(null);
            setLoading(false);
            return;
          }
          setAviso({ id: snap.id, ...(snap.data() as Omit<Aviso, "id">) });
          setLoading(false);
        },
        (err) => {
          if (cancelled) return;
          setError(err);
          setLoading(false);
        },
      );
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [key, authUid]);

  return { aviso, loading, error };
}

const CORRECTIVOS_LIST_LIMIT = 450;

/** Avisos importados o dados de alta como correctivos, estado ABIERTO (pendientes de OT o de programa). */
export function useAvisosCorrectivosPendientes(input: {
  authUid: string | undefined;
  centro: string | undefined;
  verTodosLosCentros: boolean;
  enabled?: boolean;
}): { avisos: Aviso[]; loading: boolean; error: Error | null } {
  const enabled = input.enabled !== false;
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [loading, setLoading] = useState(Boolean(input.authUid && enabled));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled || !input.authUid) {
      setAvisos([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    let unsub: Unsubscribe | undefined;

    setLoading(true);
    setError(null);

    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setAvisos([]);
          setLoading(false);
        }
        return;
      }

      const db = getFirebaseDb();
      const col = collection(db, COLLECTIONS.avisos);
      const q = input.verTodosLosCentros
        ? query(col, where("tipo", "==", "CORRECTIVO"), limit(CORRECTIVOS_LIST_LIMIT))
        : input.centro?.trim()
          ? query(
              col,
              where("centro", "==", input.centro.trim()),
              where("tipo", "==", "CORRECTIVO"),
              limit(CORRECTIVOS_LIST_LIMIT),
            )
          : null;

      if (!q) {
        if (!cancelled) {
          setAvisos([]);
          setLoading(false);
        }
        return;
      }

      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          const list = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Aviso, "id">) }) as Aviso)
            .filter((a) => {
              const st = String(a.estado ?? "ABIERTO").trim().toUpperCase();
              return st === "ABIERTO" || st === "";
            })
            .sort((a, b) => a.n_aviso.localeCompare(b.n_aviso, "es", { numeric: true }));
          setAvisos(list);
          setLoading(false);
          setError(null);
        },
        (err) => {
          if (cancelled) return;
          setError(err);
          setLoading(false);
        },
      );
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [enabled, input.authUid, input.centro, input.verTodosLosCentros]);

  return { avisos, loading, error };
}
