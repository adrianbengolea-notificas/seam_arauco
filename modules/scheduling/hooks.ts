/* eslint-disable react-hooks/set-state-in-effect -- Suscripciones Firestore: reset síncrono al cambiar filtro y al cortar sesión. */
"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import {
  diasParaVencimientoDesdeTimestamp,
  estadoVencimientoDesdeDias,
} from "@/lib/vencimientos";
import { CENTRO_SELECTOR_TODAS_PLANTAS, KNOWN_CENTROS } from "@/lib/config/app-config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { woConstraintExcluirArchivadas } from "@/lib/firestore/work-order-query";
import { propuestaSemanaDocId, stablePropuestaItemId } from "@/lib/scheduling/propuesta-id";
import type { PropuestaSemanaFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import type { Aviso } from "@/modules/notices/types";
import type { ProgramaSemana, SlotSemanal, WeeklyPlanRow, WeeklyScheduleSlot } from "@/modules/scheduling/types";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { getIsoWeekId, parseIsoWeekToBounds, semanaLabelDesdeIso, shiftIsoWeekId } from "@/modules/scheduling/iso-week";

/**
 * @param authUid — Firebase Auth UID; la suscripción solo arranca cuando hay sesión.
 *   Sin esto, el primer `onSnapshot` puede ejecutarse antes de restaurar el token y fallar
 *   con permission-denied sin reintentar.
 */
export function useWeeklySlotsLive(
  weekId: string | undefined,
  authUid: string | undefined,
  centro: string | undefined,
): {
  slots: WeeklyScheduleSlot[];
  loading: boolean;
  error: Error | null;
} {
  const [slots, setSlots] = useState<WeeklyScheduleSlot[]>([]);
  const [loading, setLoading] = useState(Boolean(weekId?.trim() && authUid));
  const [error, setError] = useState<Error | null>(null);

  const key = useMemo(() => (weekId?.trim() ? weekId.trim() : undefined), [weekId]);

  useEffect(() => {
    if (!key || !authUid || !centro) {
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
          const data = (snap.data() ?? {}) as Omit<ProgramaSemana, "id">;
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

const ISO_WEEK_ID_SUFFIX_RE = /(\d{4}-W\d{2})$/;

/** Orden estable por semana ISO (más reciente primero). Evita listas “mezcladas” cuando `fechaInicio` no coincide con el id o al deduplicar docs. */
function compareSemanaOpcionDesc(a: SemanaOpcion, b: SemanaOpcion): number {
  const ka = ISO_WEEK_ID_SUFFIX_RE.exec(a.id)?.[1];
  const kb = ISO_WEEK_ID_SUFFIX_RE.exec(b.id)?.[1];
  if (ka && kb) return kb.localeCompare(ka);
  if (ka && !kb) return -1;
  if (!ka && kb) return 1;
  return b.id.localeCompare(a.id);
}

/** ~2 años atrás y ~1 año adelante; acota consultas por fecha programada de OTs. */
function ventanaOtProgramada(): { start: Timestamp; end: Timestamp } {
  const now = new Date();
  const isoNow = getIsoWeekId(now);
  const isoStart = shiftIsoWeekId(isoNow, -(52 * 2));
  const isoEnd = shiftIsoWeekId(isoNow, 52);
  const { start } = parseIsoWeekToBounds(isoStart);
  const { end } = parseIsoWeekToBounds(isoEnd);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) };
}

/**
 * Replica `orderBy("fechaInicio", "desc")` en el cliente.
 * La consulta solo con `where("centro", "==", …)` no requiere índice compuesto (útil si
 * `firestore.indexes.json` aún no se publicó en el proyecto de Firebase).
 */
function sortProgramaSemanalDocsPorFechaInicioDesc(
  docs: QueryDocumentSnapshot<DocumentData>[],
): QueryDocumentSnapshot<DocumentData>[] {
  return [...docs].sort((a, b) => {
    const da = a.data() as { fechaInicio?: Timestamp };
    const db = b.data() as { fechaInicio?: Timestamp };
    const ma = da.fechaInicio?.toMillis?.() ?? 0;
    const mb = db.fechaInicio?.toMillis?.() ?? 0;
    if (mb !== ma) return mb - ma;
    return b.id.localeCompare(a.id);
  });
}

/** Firestore limita operador `in` a 30 valores. */
const FIRESTORE_IN_QUERY_MAX = 30;

/** Centros conocidos únicos normalizados; misma lista base que `merged` espera (`KNOWN_CENTROS`). */
function centrosListaConocidosNormalizados(): string[] {
  return [...new Set(KNOWN_CENTROS.map((c) => c.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (!arr.length) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function listaSemanaOpcionesDesdeProgramaDocs(docs: QueryDocumentSnapshot<DocumentData>[]): SemanaOpcion[] {
  const byWeek = new Map<string, SemanaOpcion>();
  for (const d of sortProgramaSemanalDocsPorFechaInicioDesc(docs)) {
    const data = d.data() as { semanaLabel?: string };
    const item: SemanaOpcion = { id: d.id, label: data.semanaLabel ?? d.id };
    const weekKey = ISO_WEEK_ID_SUFFIX_RE.exec(d.id)?.[1] ?? d.id;
    const existing = byWeek.get(weekKey);
    if (!existing || d.id.includes("_")) {
      byWeek.set(weekKey, item);
    }
  }
  return Array.from(byWeek.values()).sort(compareSemanaOpcionDesc);
}

function mergeSemanasProgramaOtPropuesta(
  porProgramaPorIso: Map<string, SemanaOpcion>,
  isosOt: Iterable<string>,
  isosProp: Iterable<string>,
  centroParaId: string,
): SemanaOpcion[] {
  const byWeek = new Map(porProgramaPorIso);
  for (const iso of isosOt) {
    const t = iso.trim();
    if (!/^\d{4}-W\d{2}$/.test(t) || byWeek.has(t)) continue;
    byWeek.set(t, {
      id: propuestaSemanaDocId(centroParaId, t),
      label: semanaLabelDesdeIso(t),
    });
  }
  for (const iso of isosProp) {
    const t = iso.trim();
    if (!/^\d{4}-W\d{2}$/.test(t) || byWeek.has(t)) continue;
    byWeek.set(t, {
      id: propuestaSemanaDocId(centroParaId, t),
      label: semanaLabelDesdeIso(t),
    });
  }
  return Array.from(byWeek.values()).sort(compareSemanaOpcionDesc);
}

export type UseSemanasDisponiblesOptions = {
  /** Semanas donde hay OT con `fecha_inicio_programada` (manual o desde motor después de crear la OT). @default true */
  incluirOtProgramadasSemana?: boolean;
  /** Semanas donde existe propuesta del motor (supervisor+, reglas Firestore). @default false */
  incluirPropuestasMotorSemana?: boolean;
};

export function useSemanasDisponibles(
  centro: string | undefined,
  authUid: string | undefined,
  options?: UseSemanasDisponiblesOptions,
): {
  semanas: SemanaOpcion[];
  loading: boolean;
  error: Error | null;
} {
  const incluirOtProg = options?.incluirOtProgramadasSemana ?? true;
  const incluirPropuesta = Boolean(options?.incluirPropuestasMotorSemana);

  const [listaPrograma, setListaPrograma] = useState<SemanaOpcion[]>([]);
  const [isosOt, setIsosOt] = useState<string[]>([]);
  const [isosProp, setIsosProp] = useState<string[]>([]);
  const [loadingProg, setLoadingProg] = useState(Boolean(centro?.trim() && authUid));
  const [loadingOt, setLoadingOt] = useState(Boolean(centro?.trim() && authUid && incluirOtProg));
  const [loadingProp, setLoadingProp] = useState(Boolean(centro?.trim() && authUid && incluirPropuesta));
  const [error, setError] = useState<Error | null>(null);

  const centroKey = useMemo(() => (centro?.trim() ? centro.trim() : undefined), [centro]);

  const merged = useMemo(() => {
    if (!centroKey) return [];
    const byIso = new Map<string, SemanaOpcion>();
    // Dedup igual que la suscripción programa_semanal
    for (const item of listaPrograma) {
      const iso = ISO_WEEK_ID_SUFFIX_RE.exec(item.id)?.[1] ?? item.id;
      const existing = byIso.get(iso);
      if (!existing || item.id.includes("_")) {
        byIso.set(iso, item);
      }
    }
    return mergeSemanasProgramaOtPropuesta(byIso, isosOt, isosProp, centroKey);
  }, [listaPrograma, isosOt, isosProp, centroKey]);

  const loading = loadingProg || loadingOt || loadingProp;

  useEffect(() => {
    if (!centroKey || !authUid) {
      setListaPrograma([]);
      setIsosOt([]);
      setIsosProp([]);
      setLoadingProg(false);
      setLoadingOt(false);
      setLoadingProp(false);
      setError(null);
      return;
    }

    let cancelled = false;
    let unsubProg: Unsubscribe | undefined;
    let unsubOt: Unsubscribe | undefined;
    let unsubProp: Unsubscribe | undefined;

    setListaPrograma([]);
    setIsosOt([]);
    setIsosProp([]);
    setLoadingProg(true);
    setLoadingOt(Boolean(incluirOtProg));
    setLoadingProp(Boolean(incluirPropuesta));
    setError(null);

    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setListaPrograma([]);
          setIsosOt([]);
          setIsosProp([]);
          setLoadingProg(false);
          setLoadingOt(false);
          setLoadingProp(false);
          setError(null);
        }
        return;
      }

      const db = getFirebaseDb();
      const qp = query(collection(db, COLLECTIONS.programa_semanal), where("centro", "==", centroKey));

      unsubProg = onSnapshot(
        qp,
        (snap) => {
          if (cancelled) return;
          const byWeek = new Map<string, SemanaOpcion>();
          for (const d of sortProgramaSemanalDocsPorFechaInicioDesc(snap.docs)) {
            const data = d.data() as { semanaLabel?: string };
            const item: SemanaOpcion = { id: d.id, label: data.semanaLabel ?? d.id };
            const weekKey = ISO_WEEK_ID_SUFFIX_RE.exec(d.id)?.[1] ?? d.id;
            const existing = byWeek.get(weekKey);
            if (!existing || d.id.includes("_")) {
              byWeek.set(weekKey, item);
            }
          }
          const list = Array.from(byWeek.values()).sort(compareSemanaOpcionDesc);
          setListaPrograma(list);
          setLoadingProg(false);
          setError(null);
        },
        (err) => {
          if (cancelled) return;
          setError(err);
          setLoadingProg(false);
        },
      );

      if (incluirOtProg) {
        const { start, end } = ventanaOtProgramada();
        const qo = query(
          collection(db, COLLECTIONS.work_orders),
          woConstraintExcluirArchivadas(),
          where("centro", "==", centroKey),
          where("fecha_inicio_programada", ">=", start),
          where("fecha_inicio_programada", "<=", end),
          orderBy("fecha_inicio_programada"),
        );
        unsubOt = onSnapshot(
          qo,
          (snap) => {
            if (cancelled) return;
            const isoWeeks = new Set<string>();
            for (const docSnap of snap.docs) {
              const data = docSnap.data() as { fecha_inicio_programada?: Timestamp };
              const fp = data.fecha_inicio_programada;
              if (!fp || typeof fp.toDate !== "function") continue;
              isoWeeks.add(getIsoWeekId(fp.toDate()));
            }
            setIsosOt([...isoWeeks].sort((a, b) => b.localeCompare(a)));
            setLoadingOt(false);
            setError(null);
          },
          (err) => {
            if (cancelled) return;
            setError(err);
            setLoadingOt(false);
          },
        );
      }

      if (incluirPropuesta) {
        const qh = query(collection(db, COLLECTIONS.propuestas_semana), where("centro", "==", centroKey));
        unsubProp = onSnapshot(
          qh,
          (snap) => {
            if (cancelled) return;
            const isoWeeks = new Set<string>();
            for (const d of snap.docs) {
              const data = d.data() as { semana?: string };
              const iso = typeof data.semana === "string" ? data.semana.trim() : "";
              if (/^\d{4}-W\d{2}$/.test(iso)) isoWeeks.add(iso);
            }
            setIsosProp([...isoWeeks].sort((a, b) => b.localeCompare(a)));
            setLoadingProp(false);
            setError(null);
          },
          (err) => {
            if (cancelled) return;
            setError(err);
            setLoadingProp(false);
          },
        );
      }
    })();

    return () => {
      cancelled = true;
      unsubProg?.();
      unsubOt?.();
      unsubProp?.();
    };
  }, [centroKey, authUid, incluirOtProg, incluirPropuesta]);

  return { semanas: merged, loading, error };
}

function mergeProgramasFusionDocs(
  byId: Map<string, ProgramaSemana | null>,
  orderedDocIds: string[],
  isoKey: string,
): ProgramaSemana | null {
  let anyDoc = false;
  const slotsOut: SlotSemanal[] = [];
  let meta: ProgramaSemana | null = null;

  for (const docId of orderedDocIds) {
    const p = byId.get(docId);
    if (p) anyDoc = true;
    if (!p) continue;
    if (!meta) meta = p;
    const c = p.centro?.trim() || "—";
    for (const s of p.slots ?? []) {
      const locOrig = s.localidad?.trim() || "—";
      slotsOut.push({
        ...s,
        localidad: `${c} · ${locOrig}`,
        programaOrigenDocId: docId,
      });
    }
  }

  if (!anyDoc) return null;
  if (!meta && slotsOut.length === 0) return null;

  const base = meta ?? ({} as ProgramaSemana);
  return {
    ...base,
    id: `fusion:${isoKey}`,
    centro: CENTRO_SELECTOR_TODAS_PLANTAS,
    slots: slotsOut,
    semanaLabel: base.semanaLabel?.trim() ? base.semanaLabel : isoKey,
  };
}

/**
 * Suscripción a varios `programa_semanal` (misma semana ISO, una planta por doc) y fusión en un solo objeto para la grilla.
 */
export function useProgramaSemanaFusion(
  docIdsOrdered: string[] | undefined,
  isoKey: string | undefined,
  authUid: string | undefined,
): {
  programa: ProgramaSemana | null;
  loading: boolean;
  error: Error | null;
} {
  const stableKey = useMemo(() => {
    if (!docIdsOrdered?.length || !isoKey?.trim()) return "";
    return `${isoKey.trim()}:${docIdsOrdered.join(",")}`;
  }, [docIdsOrdered, isoKey]);

  const [programa, setPrograma] = useState<ProgramaSemana | null>(null);
  const [loading, setLoading] = useState(Boolean(stableKey && authUid));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!stableKey || !authUid || !docIdsOrdered?.length || !isoKey?.trim()) {
      setPrograma(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const unsubs: Unsubscribe[] = [];
    const byId = new Map<string, ProgramaSemana | null>();
    const gotFirst = new Set<string>();
    const ids = docIdsOrdered;
    const iso = isoKey.trim();

    function emit() {
      if (cancelled) return;
      const merged = mergeProgramasFusionDocs(byId, ids, iso);
      setPrograma(merged);
      if (ids.every((id) => gotFirst.has(id))) {
        setLoading(false);
      }
    }

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
      for (const id of ids) {
        const ref = doc(db, COLLECTIONS.programa_semanal, id);
        const unsub = onSnapshot(
          ref,
          (snap) => {
            if (cancelled) return;
            gotFirst.add(id);
            if (!snap.exists()) {
              byId.set(id, null);
            } else {
              const data = (snap.data() ?? {}) as Omit<ProgramaSemana, "id">;
              byId.set(id, { id: snap.id, ...data, slots: data.slots ?? [] });
            }
            emit();
          },
          (err) => {
            if (cancelled) return;
            setError(err);
            setLoading(false);
          },
        );
        unsubs.push(unsub);
      }
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [stableKey, authUid]);

  return { programa, loading, error };
}

export type MergedSemanaOpcion = {
  iso: string;
  label: string;
  programaDocIdPorCentro: Record<string, string>;
};

/** Lista de semanas ISO con programa publicado, OTs programadas en la ventana y/o propuesta motor (opciones).
 * Optimizado para «todas las plantas» (roles con selector consolidado): menos listeners y consulta de órdenes sólo por fecha
 * (`fecha_inicio_programada`), sin `centro` + rango, para no depender del índice compuesto `centro`+fecha.
 */
export function useSemanasDisponiblesTodas(
  authUid: string | undefined,
  options?: Pick<UseSemanasDisponiblesOptions, "incluirOtProgramadasSemana" | "incluirPropuestasMotorSemana">,
): {
  semanas: MergedSemanaOpcion[];
  loading: boolean;
  error: Error | null;
} {
  const incluirOtProg = options?.incluirOtProgramadasSemana ?? true;
  const incluirPropuesta = Boolean(options?.incluirPropuestasMotorSemana);

  const [programaPorCentro, setProgramaPorCentro] = useState<Record<string, SemanaOpcion[]>>({});
  const [otPorCentro, setOtPorCentro] = useState<Record<string, string[]>>({});
  const [propPorCentro, setPropPorCentro] = useState<Record<string, string[]>>({});
  const [loadingProg, setLoadingProg] = useState(Boolean(authUid));
  const [loadingOt, setLoadingOt] = useState(Boolean(authUid && incluirOtProg));
  const [loadingProp, setLoadingProp] = useState(Boolean(authUid && incluirPropuesta));
  const [error, setError] = useState<Error | null>(null);

  const merged = useMemo(() => {
    const byIso = new Map<string, { label: string; programaDocIdPorCentro: Record<string, string> }>();

    function touchLabel(cur: { label: string }, cand: string) {
      const t = cand.trim();
      if (t.length > cur.label.length) cur.label = t;
    }

    for (const centro of KNOWN_CENTROS) {
      const pl = programaPorCentro[centro] ?? [];
      const byProgIso = new Map<string, SemanaOpcion>();
      for (const item of pl) {
        const iso = ISO_WEEK_ID_SUFFIX_RE.exec(item.id)?.[1] ?? item.id;
        const existing = byProgIso.get(iso);
        if (!existing || item.id.includes("_")) byProgIso.set(iso, item);
      }
      for (const [, item] of byProgIso) {
        const iso = ISO_WEEK_ID_SUFFIX_RE.exec(item.id)?.[1] ?? item.id;
        let cur = byIso.get(iso);
        if (!cur) {
          cur = { label: item.label, programaDocIdPorCentro: {} };
          byIso.set(iso, cur);
        }
        cur.programaDocIdPorCentro[centro] = item.id;
        touchLabel(cur, item.label);
      }

      for (const iso of otPorCentro[centro] ?? []) {
        const t = iso.trim();
        if (!/^\d{4}-W\d{2}$/.test(t)) continue;
        let cur = byIso.get(t);
        if (!cur) {
          const lab = semanaLabelDesdeIso(t);
          cur = { label: lab, programaDocIdPorCentro: {} };
          byIso.set(t, cur);
          touchLabel(cur, lab);
        }
        if (!cur.programaDocIdPorCentro[centro]) {
          cur.programaDocIdPorCentro[centro] = propuestaSemanaDocId(centro, t);
        }
        touchLabel(cur, semanaLabelDesdeIso(t));
      }

      for (const iso of propPorCentro[centro] ?? []) {
        const t = iso.trim();
        if (!/^\d{4}-W\d{2}$/.test(t)) continue;
        let cur = byIso.get(t);
        if (!cur) {
          const lab = semanaLabelDesdeIso(t);
          cur = { label: lab, programaDocIdPorCentro: {} };
          byIso.set(t, cur);
        }
        if (!cur.programaDocIdPorCentro[centro]) {
          cur.programaDocIdPorCentro[centro] = propuestaSemanaDocId(centro, t);
        }
        touchLabel(cur, semanaLabelDesdeIso(t));
      }
    }

    const list: MergedSemanaOpcion[] = Array.from(byIso.entries())
      .map(([iso, v]) => ({
        iso,
        label: v.label,
        programaDocIdPorCentro: v.programaDocIdPorCentro,
      }))
      .sort((a, b) => b.iso.localeCompare(a.iso));
    return list;
  }, [programaPorCentro, otPorCentro, propPorCentro]);

  const loading = loadingProg || loadingOt || loadingProp;

  useEffect(() => {
    if (!authUid) {
      setProgramaPorCentro({});
      setOtPorCentro({});
      setPropPorCentro({});
      setLoadingProg(false);
      setLoadingOt(false);
      setLoadingProp(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const unsubs: Unsubscribe[] = [];
    const centrosList = centrosListaConocidosNormalizados();
    const centroSet = new Set(centrosList);
    const progChunks = chunkArray(centrosList, FIRESTORE_IN_QUERY_MAX).filter((ch) => ch.length > 0);
    const propChunks = chunkArray(centrosList, FIRESTORE_IN_QUERY_MAX).filter((ch) => ch.length > 0);
    const n = centrosList.length;
    if (!n) {
      setLoadingProg(false);
      setLoadingOt(false);
      setLoadingProp(false);
      return;
    }

    let progBootDone = 0;
    const progBootTotal = progChunks.length;

    setProgramaPorCentro({});
    setOtPorCentro({});
    setPropPorCentro({});
    setLoadingProg(true);
    setLoadingOt(Boolean(incluirOtProg));
    setLoadingProp(Boolean(incluirPropuesta));
    setError(null);

    function finishProgBootSlice() {
      progBootDone++;
      if (progBootDone >= progBootTotal) setLoadingProg(false);
    }

    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setProgramaPorCentro({});
          setOtPorCentro({});
          setPropPorCentro({});
          setLoadingProg(false);
          setLoadingOt(false);
          setLoadingProp(false);
          setError(null);
        }
        return;
      }

      const db = getFirebaseDb();

      if (progBootTotal === 0) {
        setLoadingProg(false);
      } else {
        for (const chunk of progChunks) {
          const allowedChunk = new Set(chunk);
          const qp = query(
            collection(db, COLLECTIONS.programa_semanal),
            where("centro", "in", chunk),
          );
          let primeraVez = true;
          const unsubP = onSnapshot(
            qp,
            (snap) => {
              if (cancelled) return;
              const grouped = new Map<string, QueryDocumentSnapshot<DocumentData>[]>();
              for (const d of snap.docs) {
                const c = (d.data() as { centro?: string }).centro?.trim();
                if (!c || !allowedChunk.has(c)) continue;
                const arr = grouped.get(c) ?? [];
                arr.push(d);
                grouped.set(c, arr);
              }
              setProgramaPorCentro((prev) => {
                const next = { ...prev };
                for (const c of chunk) {
                  next[c] = listaSemanaOpcionesDesdeProgramaDocs(grouped.get(c) ?? []);
                }
                return next;
              });
              if (primeraVez) {
                primeraVez = false;
                finishProgBootSlice();
              }
              setError(null);
            },
            (err) => {
              if (cancelled) return;
              setError(err);
              if (primeraVez) {
                primeraVez = false;
                finishProgBootSlice();
              }
            },
          );
          unsubs.push(unsubP);
        }
      }

      if (incluirOtProg) {
        const { start, end } = ventanaOtProgramada();
        const qo = query(
          collection(db, COLLECTIONS.work_orders),
          woConstraintExcluirArchivadas(),
          where("fecha_inicio_programada", ">=", start),
          where("fecha_inicio_programada", "<=", end),
          orderBy("fecha_inicio_programada"),
        );
        let primeraOt = true;
        const unsubO = onSnapshot(
          qo,
          (snap) => {
            if (cancelled) return;
            const isoByCentro = new Map<string, Set<string>>();
            for (const docSnap of snap.docs) {
              const data = docSnap.data() as { fecha_inicio_programada?: Timestamp; centro?: string };
              const c = typeof data.centro === "string" ? data.centro.trim() : "";
              if (!centroSet.has(c)) continue;
              const fp = data.fecha_inicio_programada;
              if (!fp || typeof fp.toDate !== "function") continue;
              let s = isoByCentro.get(c);
              if (!s) {
                s = new Set<string>();
                isoByCentro.set(c, s);
              }
              s.add(getIsoWeekId(fp.toDate()));
            }
            const nextOt: Record<string, string[]> = {};
            for (const c of centrosList) {
              nextOt[c] = [...(isoByCentro.get(c) ?? new Set<string>())].sort((a, b) => b.localeCompare(a));
            }
            setOtPorCentro(nextOt);
            if (primeraOt) {
              primeraOt = false;
              setLoadingOt(false);
            }
            setError(null);
          },
          (err) => {
            if (cancelled) return;
            setError(err);
            if (primeraOt) {
              primeraOt = false;
              setLoadingOt(false);
            }
          },
        );
        unsubs.push(unsubO);
      }

      if (incluirPropuesta) {
        let propBootDone = 0;
        const propBootTotal = propChunks.length;
        function finishPropBootSlice() {
          propBootDone++;
          if (propBootDone >= propBootTotal) setLoadingProp(false);
        }

        if (propChunks.length === 0) {
          setLoadingProp(false);
        } else {
          for (const chunk of propChunks) {
            const allowedChunk = new Set(chunk);
            const qh = query(collection(db, COLLECTIONS.propuestas_semana), where("centro", "in", chunk));
            let primeraProp = true;
            const unsubH = onSnapshot(
              qh,
              (snap) => {
                if (cancelled) return;
                const byCentroIsos = new Map<string, Set<string>>();
                for (const d of snap.docs) {
                  const data = d.data() as { semana?: string; centro?: string };
                  const c = data.centro?.trim();
                  if (!c || !allowedChunk.has(c)) continue;
                  const iso = typeof data.semana === "string" ? data.semana.trim() : "";
                  if (!/^\d{4}-W\d{2}$/.test(iso)) continue;
                  let isoSet = byCentroIsos.get(c);
                  if (!isoSet) {
                    isoSet = new Set<string>();
                    byCentroIsos.set(c, isoSet);
                  }
                  isoSet.add(iso);
                }
                setPropPorCentro((prev) => {
                  const next = { ...prev };
                  for (const c of chunk) {
                    next[c] = [...(byCentroIsos.get(c) ?? new Set<string>())].sort((a, b) =>
                      b.localeCompare(a),
                    );
                  }
                  return next;
                });
                if (primeraProp) {
                  primeraProp = false;
                  finishPropBootSlice();
                }
                setError(null);
              },
              (err) => {
                if (cancelled) return;
                setError(err);
                if (primeraProp) {
                  primeraProp = false;
                  finishPropBootSlice();
                }
              },
            );
            unsubs.push(unsubH);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [authUid, incluirOtProg, incluirPropuesta]);

  return { semanas: merged, loading, error };
}

/** Frecuencias de plan MTSA para consultas de vencimiento (Firestore `frecuencia_plan_mtsa`). */
export const FRECUENCIAS_PLAN_MTSA_VENCIMIENTOS_SA = ["S", "A"] as const;
export const FRECUENCIAS_PLAN_MTSA_VENCIMIENTOS_TODAS = ["M", "T", "S", "A"] as const;

/** Aviso del plan (M/T/S/A) con días hasta vencimiento recalculados en cliente si hace falta. */
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
  /** Por defecto `true`. Si es `false`, no se suscribe a Firestore. */
  enabled?: boolean;
  /**
   * Valores de `frecuencia_plan_mtsa` a incluir. Por defecto semestral + anual (compat. panel y KPIs).
   * Pasá `FRECUENCIAS_PLAN_MTSA_VENCIMIENTOS_TODAS` para mensual y trimestral también.
   */
  frecuenciasPlanMtsa?: readonly ("M" | "T" | "S" | "A")[];
}): { avisos: AvisoConVencimiento[]; loading: boolean; error: Error | null } {
  const enabled = input.enabled !== false;
  const [avisos, setAvisos] = useState<AvisoConVencimiento[]>([]);
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
          setError(null);
        }
        return;
      }

      const db = getFirebaseDb();
      const col = collection(db, COLLECTIONS.avisos);
      const frecuencias = input.frecuenciasPlanMtsa?.length
        ? [...input.frecuenciasPlanMtsa]
        : [...FRECUENCIAS_PLAN_MTSA_VENCIMIENTOS_SA];
      let q:
        | ReturnType<typeof query>
        | null = null;
      if (input.verTodosLosCentros) {
        q = query(col, where("frecuencia_plan_mtsa", "in", frecuencias));
      } else if (input.centro?.trim()) {
        q = query(
          col,
          where("centro", "==", input.centro.trim()),
          where("frecuencia_plan_mtsa", "in", frecuencias),
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
  }, [enabled, input.authUid, input.centro, input.verTodosLosCentros, input.frecuenciasPlanMtsa]);

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
  enabled?: boolean;
  frecuenciasPlanMtsa?: readonly ("M" | "T" | "S" | "A")[];
}): {
  vencidos: number;
  proximos: number;
  alDia: number;
  sinFecha: number;
  loading: boolean;
  error: Error | null;
} {
  const { avisos, loading, error } = useAvisosVencimientos(input);
  const { vencidos, proximos, alDia, sinFecha } = useMemo(() => {
    let v = 0;
    let p = 0;
    let o = 0;
    let s = 0;
    for (const a of avisos) {
      const est = a.estado_vencimiento_live;
      if (est === "vencido") v++;
      else if (est === "proximo") p++;
      else if (est === "ok") o++;
      else if (est === "sin_fecha") s++;
    }
    return { vencidos: v, proximos: p, alDia: o, sinFecha: s };
  }, [avisos]);
  return { vencidos, proximos, alDia, sinFecha, loading, error };
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
          const data = snap.data();
          if (!data) {
            setPropuesta(null);
            setLoading(false);
            setError(null);
            return;
          }
          const raw = data as Omit<PropuestaSemanaFirestore, "id">;
          const docId = snap.id;
          const itemsNorm = (raw.items ?? []).map((it, idx) => ({
            ...it,
            id: stablePropuestaItemId(docId, it.id, idx),
          }));
          setPropuesta({
            id: docId,
            ...raw,
            items: itemsNorm,
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
