/* eslint-disable react-hooks/set-state-in-effect -- Suscripciones Firestore: reset síncrono al cambiar filtro y al cortar sesión. */
"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ProgramaSemana, WeeklyPlanRow, WeeklyScheduleSlot } from "@/modules/scheduling/types";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

/**
 * @param authUid — Firebase Auth UID; la suscripción solo arranca cuando hay sesión.
 *   Sin esto, el primer `onSnapshot` puede ejecutarse antes de restaurar el token y fallar
 *   con permission-denied sin reintentar.
 */
export function useWeeklySlotsLive(weekId: string | undefined, authUid: string | undefined): {
  slots: WeeklyScheduleSlot[];
  loading: boolean;
  error: Error | null;
} {
  const [slots, setSlots] = useState<WeeklyScheduleSlot[]>([]);
  const [loading, setLoading] = useState(Boolean(weekId?.trim() && authUid));
  const [error, setError] = useState<Error | null>(null);

  const key = useMemo(() => (weekId?.trim() ? weekId.trim() : undefined), [weekId]);

  useEffect(() => {
    if (!key || !authUid) {
      setSlots([]);
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
          setSlots([]);
          setLoading(false);
          setError(null);
        }
        return;
      }

      const db = getFirebaseDb();
      const q = query(
        collection(db, COLLECTIONS.weekly_schedule, key, "slots"),
        orderBy("dia_semana"),
        orderBy("orden_en_dia"),
      );

      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          const list = snap.docs.map((d) => {
            const data = d.data() as Omit<WeeklyScheduleSlot, "id">;
            return { id: d.id, ...data } as WeeklyScheduleSlot;
          });
          setSlots(list);
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
  }, [key, authUid]);

  return { slots, loading, error };
}

export function useWeeklyPlanRowsLive(weekId: string | undefined, authUid: string | undefined): {
  rows: WeeklyPlanRow[];
  loading: boolean;
  error: Error | null;
} {
  const [rows, setRows] = useState<WeeklyPlanRow[]>([]);
  const [loading, setLoading] = useState(Boolean(weekId?.trim() && authUid));
  const [error, setError] = useState<Error | null>(null);

  const key = useMemo(() => (weekId?.trim() ? weekId.trim() : undefined), [weekId]);

  useEffect(() => {
    if (!key || !authUid) {
      setRows([]);
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
          setRows([]);
          setLoading(false);
          setError(null);
        }
        return;
      }

      const db = getFirebaseDb();
      /** Sin `orderBy` compuesto: evita índice `dia_semana`+`orden`+`__name__` en Firebase. Orden en cliente. */
      const colRef = collection(db, COLLECTIONS.weekly_schedule, key, "plan_rows");

      unsub = onSnapshot(
        colRef,
        (snap) => {
          if (cancelled) return;
          const list = snap.docs
            .map((d) => {
              const data = d.data() as Omit<WeeklyPlanRow, "id">;
              return { id: d.id, ...data } as WeeklyPlanRow;
            })
            .sort((a, b) => {
              const da = a.dia_semana ?? 0;
              const dbd = b.dia_semana ?? 0;
              if (da !== dbd) return da - dbd;
              return (a.orden ?? 0) - (b.orden ?? 0);
            });
          setRows(list);
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
  }, [key, authUid]);

  return { rows, loading, error };
}

export function useProgramaSemana(semanaId: string | undefined, authUid: string | undefined): {
  programa: ProgramaSemana | null;
  loading: boolean;
  error: Error | null;
} {
  const [programa, setPrograma] = useState<ProgramaSemana | null>(null);
  const [loading, setLoading] = useState(Boolean(semanaId?.trim() && authUid));
  const [error, setError] = useState<Error | null>(null);

  const key = useMemo(() => (semanaId?.trim() ? semanaId.trim() : undefined), [semanaId]);

  useEffect(() => {
    if (!key || !authUid) {
      setPrograma(null);
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
          setPrograma(null);
          setLoading(false);
          setError(null);
        }
        return;
      }

      const db = getFirebaseDb();
      const ref = doc(db, COLLECTIONS.programa_semanal, key);
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (cancelled) return;
          if (!snap.exists) {
            setPrograma(null);
            setLoading(false);
            setError(null);
            return;
          }
          const data = snap.data() as Omit<ProgramaSemana, "id">;
          setPrograma({ id: snap.id, ...data, slots: data.slots ?? [] });
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
  }, [key, authUid]);

  return { programa, loading, error };
}

export type SemanaOpcion = { id: string; label: string };

export function useSemanasDisponibles(centro: string | undefined, authUid: string | undefined): {
  semanas: SemanaOpcion[];
  loading: boolean;
  error: Error | null;
} {
  const [semanas, setSemanas] = useState<SemanaOpcion[]>([]);
  const [loading, setLoading] = useState(Boolean(centro?.trim() && authUid));
  const [error, setError] = useState<Error | null>(null);

  const centroKey = useMemo(() => (centro?.trim() ? centro.trim() : undefined), [centro]);

  useEffect(() => {
    if (!centroKey || !authUid) {
      setSemanas([]);
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
          setSemanas([]);
          setLoading(false);
          setError(null);
        }
        return;
      }

      const db = getFirebaseDb();
      const q = query(
        collection(db, COLLECTIONS.programa_semanal),
        where("centro", "==", centroKey),
        orderBy("fechaInicio", "desc"),
      );

      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          const list: SemanaOpcion[] = snap.docs.map((d) => {
            const data = d.data() as { semanaLabel?: string };
            return { id: d.id, label: data.semanaLabel ?? d.id };
          });
          setSemanas(list);
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
  }, [centroKey, authUid]);

  return { semanas, loading, error };
}
