/* eslint-disable react-hooks/set-state-in-effect -- Suscripciones Firestore: reset síncrono al cambiar filtro y al cortar sesión. */
"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import {
  diasParaVencimientoDesdeTimestamp,
  estadoVencimientoDesdeDias,
} from "@/lib/vencimientos";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { PropuestaSemanaFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import type { Aviso } from "@/modules/notices/types";
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

/** Aviso semestral/anual con días hasta vencimiento recalculados en cliente si hace falta. */
export type AvisoConVencimiento = Aviso & {
  dias_para_vencimiento_live: number | undefined;
  estado_vencimiento_live: "ok" | "proximo" | "vencido" | "sin_fecha";
};

function sortAvisosVencimiento(a: AvisoConVencimiento, b: AvisoConVencimiento): number {
  const na = a.ultima_ejecucion_fecha ? 1 : 0;
  const nb = b.ultima_ejecucion_fecha ? 1 : 0;
  if (na !== nb) return na - nb;
  const rank: Record<string, number> = { vencido: 0, proximo: 1, sin_fecha: 2, ok: 3 };
  const ra = rank[a.estado_vencimiento_live] ?? 9;
  const rb = rank[b.estado_vencimiento_live] ?? 9;
  if (ra !== rb) return ra - rb;
  const pa = a.proximo_vencimiento?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
  const pb = b.proximo_vencimiento?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
  return pa - pb;
}

export function useAvisosVencimientos(input: {
  authUid: string | undefined;
  centro: string | undefined;
  verTodosLosCentros: boolean;
}): { avisos: AvisoConVencimiento[]; loading: boolean; error: Error | null } {
  const [avisos, setAvisos] = useState<AvisoConVencimiento[]>([]);
  const [loading, setLoading] = useState(Boolean(input.authUid));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!input.authUid) {
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
          setError(null);
        }
        return;
      }

      const db = getFirebaseDb();
      const col = collection(db, COLLECTIONS.avisos);
      let q:
        | ReturnType<typeof query>
        | null = null;
      if (input.verTodosLosCentros) {
        q = query(col, where("frecuencia_plan_mtsa", "in", ["S", "A"]));
      } else if (input.centro?.trim()) {
        q = query(
          col,
          where("centro", "==", input.centro.trim()),
          where("frecuencia_plan_mtsa", "in", ["S", "A"]),
        );
      }

      if (!q) {
        if (!cancelled) {
          setAvisos([]);
          setLoading(false);
          setError(null);
        }
        return;
      }

      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          const hoy = new Date();
          const list: AvisoConVencimiento[] = snap.docs.map((d) => {
            const row = d.data() as Aviso;
            const data: Aviso = { ...row, id: d.id };
            let diasLive = data.dias_para_vencimiento;
            if (diasLive === undefined && data.proximo_vencimiento) {
              diasLive = diasParaVencimientoDesdeTimestamp(data.proximo_vencimiento, hoy);
            }
            let estadoLive: AvisoConVencimiento["estado_vencimiento_live"] = "sin_fecha";
            if (!data.ultima_ejecucion_fecha) {
              estadoLive = "sin_fecha";
            } else if (diasLive !== undefined) {
              estadoLive = estadoVencimientoDesdeDias(diasLive);
            } else if (data.estado_vencimiento) {
              estadoLive = data.estado_vencimiento;
            }
            return {
              ...data,
              dias_para_vencimiento_live: diasLive,
              estado_vencimiento_live: estadoLive,
            };
          });
          list.sort(sortAvisosVencimiento);
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
  }, [input.authUid, input.centro, input.verTodosLosCentros]);

  return { avisos, loading, error };
}

/** Avisos mensuales/trimestrales (p. ej. selector al armar plan). */
export function useAvisosPreventivosMT(input: {
  authUid: string | undefined;
  centro: string | undefined;
  verTodosLosCentros: boolean;
}): { avisos: Aviso[]; loading: boolean; error: Error | null } {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [loading, setLoading] = useState(Boolean(input.authUid));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!input.authUid) {
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
          setError(null);
        }
        return;
      }

      const db = getFirebaseDb();
      const q =
        !input.verTodosLosCentros && input.centro?.trim()
          ? query(
              collection(db, COLLECTIONS.avisos),
              where("centro", "==", input.centro.trim()),
              where("frecuencia_plan_mtsa", "in", ["M", "T"]),
            )
          : query(collection(db, COLLECTIONS.avisos), where("frecuencia_plan_mtsa", "in", ["M", "T"]));

      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Aviso);
          list.sort((a, b) => (a.n_aviso || "").localeCompare(b.n_aviso || ""));
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
  }, [input.authUid, input.centro, input.verTodosLosCentros]);

  return { avisos, loading, error };
}

export function usePreventivosSaVencimientoKpis(input: {
  authUid: string | undefined;
  centro: string | undefined;
  verTodosLosCentros: boolean;
}): {
  vencidos: number;
  proximos: number;
  alDia: number;
  loading: boolean;
  error: Error | null;
} {
  const { avisos, loading, error } = useAvisosVencimientos(input);
  const { vencidos, proximos, alDia } = useMemo(() => {
    let v = 0;
    let p = 0;
    let o = 0;
    for (const a of avisos) {
      const est = a.estado_vencimiento_live;
      if (est === "vencido") v++;
      else if (est === "proximo") p++;
      else if (est === "ok") o++;
    }
    return { vencidos: v, proximos: p, alDia: o };
  }, [avisos]);
  return { vencidos, proximos, alDia, loading, error };
}

/** Propuesta del motor (`propuestas_semana/{centro}_{YYYY-Www}`). */
export function usePropuestaMotorSemana(
  propuestaId: string | undefined,
  authUid: string | undefined,
): { propuesta: PropuestaSemanaFirestore | null; loading: boolean; error: Error | null } {
  const [propuesta, setPropuesta] = useState<PropuestaSemanaFirestore | null>(null);
  const [loading, setLoading] = useState(Boolean(propuestaId?.trim() && authUid));
  const [error, setError] = useState<Error | null>(null);

  const key = useMemo(() => (propuestaId?.trim() ? propuestaId.trim() : undefined), [propuestaId]);

  useEffect(() => {
    if (!key || !authUid) {
      setPropuesta(null);
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
          setPropuesta(null);
          setLoading(false);
          setError(null);
        }
        return;
      }

      const db = getFirebaseDb();
      const ref = doc(db, COLLECTIONS.propuestas_semana, key);
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (cancelled) return;
          if (!snap.exists) {
            setPropuesta(null);
            setLoading(false);
            setError(null);
            return;
          }
          const raw = snap.data() as Omit<PropuestaSemanaFirestore, "id">;
          setPropuesta({
            id: snap.id,
            ...raw,
            items: raw.items ?? [],
            advertencias: raw.advertencias ?? [],
          });
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

  return { propuesta, loading, error };
}
