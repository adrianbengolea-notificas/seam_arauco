/* eslint-disable react-hooks/set-state-in-effect -- Suscripciones Firestore: reset síncrono al cambiar filtro y al cortar sesión. */
"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import { cacheWorkOrdersForDay, dayKeyFromDate, loadCachedWorkOrdersForDay } from "@/lib/offline/ot-db";
import type { MaterialLineWorkOrder, MaterialOtListRow } from "@/modules/materials/types";
import type { Especialidad } from "@/modules/notices/types";
import { COLLECTIONS, WORK_ORDER_SUB } from "@/lib/firestore/collections";
import { woConstraintExcluirArchivadas } from "@/lib/firestore/work-order-query";
import type { Equipo, PlanillaRespuesta, PlanillaTemplate } from "@/lib/firestore/types";
import type {
  ChecklistItem,
  MaterialOT,
  WorkOrder,
  WorkOrderHistorialEvent,
  WorkOrderVistaStatus,
} from "@/modules/work-orders/types";
import { workOrderVistaStatus } from "@/modules/work-orders/types";
import type { Comentario } from "@/lib/firestore/types";
import type { UserProfile } from "@/modules/users/types";
import {
  and,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  or,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { tienePermiso, toPermisoRol } from "@/lib/permisos/index";

/** Muestra de OTs que alimenta el panel: recortado en cliente; debe ser ≤ al `limit` de cada query. */
export const DASHBOARD_RECENT_OT_LIMIT = 300;

type WorkOrderOrderField = "updated_at" | "created_at";

function sortWorkOrdersByField(
  list: WorkOrder[],
  field: WorkOrderOrderField,
  direction: "asc" | "desc",
): WorkOrder[] {
  return [...list].sort((a, b) => {
    const ta = field === "updated_at" ? (a.updated_at?.toMillis?.() ?? 0) : (a.created_at?.toMillis?.() ?? 0);
    const tb = field === "updated_at" ? (b.updated_at?.toMillis?.() ?? 0) : (b.created_at?.toMillis?.() ?? 0);
    return direction === "asc" ? ta - tb : tb - ta;
  });
}

/** Panel / caché del día: más recientes por última modificación. */
function sortWorkOrdersByUpdatedAtDesc(list: WorkOrder[]): WorkOrder[] {
  return sortWorkOrdersByField(list, "updated_at", "desc");
}

/**
 * Técnico: OTs asignadas a `uid` + pool sin asignar en el mismo centro (una sola suscripción `or`).
 */
function subscribeTecnicoWorkOrdersCentroMerged(
  db: Firestore,
  centroKey: string,
  uid: string,
  limPerQuery: number,
  onList: (rows: WorkOrder[]) => void,
  onErr: (err: Error) => void,
  order: { field: WorkOrderOrderField; direction: "asc" | "desc" },
): () => void {
  const col = collection(db, COLLECTIONS.work_orders);
  const qMerged = query(
    col,
    and(
      woConstraintExcluirArchivadas(),
      where("centro", "==", centroKey),
      or(
        where("tecnico_asignado_uid", "==", uid),
        where("tecnico_asignado_uid", "==", ""),
        where("tecnico_asignado_uid", "==", null),
      ),
    ),
    orderBy(order.field, order.direction),
    limit(limPerQuery),
  );
  return onSnapshot(
    qMerged,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkOrder, "id">) }));
      onList(sortWorkOrdersByField(rows, order.field, order.direction));
    },
    onErr,
  );
}

function normCentrosKeys(keys: string[]): string[] {
  return [...new Set(keys.map((k) => String(k).trim()).filter(Boolean))];
}

/** Técnico en varias plantas: una suscripción por centro y fusión deduplicada por id de OT. */
function subscribeTecnicoWorkOrdersMultiCentroMerged(
  db: Firestore,
  centroKeys: string[],
  uid: string,
  limPerQuery: number,
  onList: (rows: WorkOrder[]) => void,
  onErr: (err: Error) => void,
  order: { field: WorkOrderOrderField; direction: "asc" | "desc" },
): () => void {
  const keys = normCentrosKeys(centroKeys);
  if (keys.length === 0) {
    onList([]);
    return () => {};
  }
  if (keys.length === 1) {
    return subscribeTecnicoWorkOrdersCentroMerged(db, keys[0]!, uid, limPerQuery, onList, onErr, order);
  }

  const perCentro = new Map<string, WorkOrder[]>();
  const flush = () => {
    const byId = new Map<string, WorkOrder>();
    for (const rows of perCentro.values()) {
      for (const wo of rows) {
        const prev = byId.get(wo.id);
        const tw = wo.updated_at?.toMillis?.() ?? 0;
        const tp = prev?.updated_at?.toMillis?.() ?? 0;
        if (!prev || tw > tp) byId.set(wo.id, wo);
      }
    }
    onList(sortWorkOrdersByField([...byId.values()], order.field, order.direction));
  };

  const unsubs = keys.map((centroKey) =>
    subscribeTecnicoWorkOrdersCentroMerged(
      db,
      centroKey,
      uid,
      limPerQuery,
      (rows) => {
        perCentro.set(centroKey, rows);
        flush();
      },
      onErr,
      order,
    ),
  );

  return () => unsubs.forEach((u) => u());
}

function resolveCentroScope(centro: string | string[] | null | undefined): string[] | null {
  if (centro == null) return null;
  if (Array.isArray(centro)) {
    const k = normCentrosKeys(centro);
    return k.length ? k : null;
  }
  const c = String(centro).trim();
  return c ? [c] : null;
}

export function useWorkOrderLive(workOrderId: string | undefined): {
  workOrder: WorkOrder | null;
  loading: boolean;
  error: Error | null;
} {
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(Boolean(workOrderId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!workOrderId) {
      setWorkOrder(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let unsub: Unsubscribe | undefined;
    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setWorkOrder(null);
          setLoading(false);
        }
        return;
      }
      const db = getFirebaseDb();
      const ref = doc(db, "work_orders", workOrderId);
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists) {
            setWorkOrder(null);
            setLoading(false);
            return;
          }
          setWorkOrder({ id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) });
          setLoading(false);
        },
        (err) => {
          setError(err);
          setLoading(false);
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [workOrderId]);

  return { workOrder, loading, error };
}

const ASSET_WORK_ORDERS_HISTORY_LIMIT = 50;

/**
 * OTs vinculadas a un activo (`asset_id`), mismo centro que la ficha.
 * Útil en ficha del equipo / tras escanear QR; incluye cerradas (historial).
 */
export function useWorkOrdersForAssetLive(
  assetId: string | undefined,
  assetCentro: string | undefined,
  options?: { limit?: number; enabled?: boolean },
): {
  rows: WorkOrder[];
  loading: boolean;
  error: Error | null;
} {
  const lim = options?.limit ?? ASSET_WORK_ORDERS_HISTORY_LIMIT;
  const enabled =
    options?.enabled !== false &&
    Boolean(assetId?.trim()) &&
    Boolean(assetCentro?.trim());
  const [rows, setRows] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    const aid = assetId!.trim();
    const centro = assetCentro!.trim();
    let cancelled = false;
    let unsub: Unsubscribe | undefined;
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
      setLoading(true);
      setError(null);
      const db = getFirebaseDb();
      const q = query(
        collection(db, COLLECTIONS.work_orders),
        woConstraintExcluirArchivadas(),
        where("asset_id", "==", aid),
        where("centro", "==", centro),
        orderBy("created_at", "desc"),
        limit(lim),
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkOrder, "id">) }));
          if (!cancelled) {
            setRows(list);
            setLoading(false);
            setError(null);
          }
        },
        (err) => {
          if (!cancelled) {
            setError(err);
            setRows([]);
            setLoading(false);
          }
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [enabled, assetId, assetCentro, lim]);

  return { rows, loading, error };
}

/**
 * Escucha OTs recientes por centro, o todas si `centro` es `null` (vista consolidada).
 * Con `viewer` rol `tecnico`, combina órdenes asignadas a su uid y sin asignar en el centro (pool del plan).
 * La muestra se ordena por `updated_at` (desc) en cliente; Firestore aplica `limit` (`DASHBOARD_RECENT_OT_LIMIT`).
 */
export function useTodaysWorkOrdersCached(
  centro: string | string[] | null,
  viewer?: { uid: string; rol: string },
  options?: { enabled?: boolean },
): {
  rows: WorkOrder[];
  loading: boolean;
  error: Error | null;
} {
  const enabled = options?.enabled !== false;
  const dayKey = useMemo(() => dayKeyFromDate(new Date()), []);
  const viewerRol = viewer ? toPermisoRol(viewer.rol) : null;
  /**
   * Muestra consolidada sin filtro de centro: cumplen reglas Firestore (`canReadWorkOrderData`)
   * para cualquier doc de OT (cliente Arauco y roles con `ot:ver_todas`).
   */
  const puedeConsultaGlobalOt =
    viewerRol !== null &&
    (viewerRol === "cliente_arauco" || tienePermiso(viewerRol, "ot:ver_todas"));
  const otSoloAsignadasDashboard =
    viewerRol !== null &&
    tienePermiso(viewerRol, "ot:ver_propias") &&
    !tienePermiso(viewerRol, "ot:ver_todas");
  const cacheKey = useMemo(() => {
    const part =
      centro === null
        ? "__ALL__"
        : Array.isArray(centro)
          ? normCentrosKeys(centro).join("|")
          : String(centro).trim() || "__EMPTY__";
    return `${dayKey}|${part}|${viewer?.uid ?? "_"}|${viewerRol ?? "nov"}`;
  }, [dayKey, centro, viewer?.uid, viewerRol]);
  const [rows, setRows] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsub: Unsubscribe | undefined;

    if (!enabled) {
      setRows([]);
      setLoading(true);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    const sc = centro === null ? null : resolveCentroScope(centro);
    if (otSoloAsignadasDashboard && (!sc?.length || !viewer?.uid)) {
      setRows([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    void loadCachedWorkOrdersForDay(cacheKey).then((cached) => {
      if (!cancelled && cached.length) {
        setRows(cached as WorkOrder[]);
      }
    });

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
      const colRef = collection(db, COLLECTIONS.work_orders);

      if (centro === null) {
        if (!puedeConsultaGlobalOt) {
          if (!cancelled) {
            setRows([]);
            setLoading(false);
            setError(null);
          }
          return;
        }
        unsub = onSnapshot(
          query(
            colRef,
            woConstraintExcluirArchivadas(),
            orderBy("updated_at", "desc"),
            limit(DASHBOARD_RECENT_OT_LIMIT),
          ),
          async (snap) => {
            const list = sortWorkOrdersByUpdatedAtDesc(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkOrder, "id">) })),
            ).slice(0, DASHBOARD_RECENT_OT_LIMIT);
            if (!cancelled) {
              setRows(list);
              setLoading(false);
              await cacheWorkOrdersForDay(
                list.map((r) => ({ id: r.id, json: r })),
                cacheKey,
              );
            }
          },
          (err) => {
            if (!cancelled) {
              setError(err);
              setLoading(false);
            }
          },
        );
      } else if (otSoloAsignadasDashboard && viewer?.uid) {
        const sc = resolveCentroScope(centro)!;
        unsub = subscribeTecnicoWorkOrdersMultiCentroMerged(
          db,
          sc,
          viewer.uid,
          DASHBOARD_RECENT_OT_LIMIT,
          async (merged) => {
            const list = merged.slice(0, DASHBOARD_RECENT_OT_LIMIT);
            if (!cancelled) {
              setRows(list);
              setLoading(false);
              await cacheWorkOrdersForDay(
                list.map((r) => ({ id: r.id, json: r })),
                cacheKey,
              );
            }
          },
          (err) => {
            if (!cancelled) {
              setError(err);
              setLoading(false);
            }
          },
          { field: "updated_at", direction: "desc" },
        );
      } else {
        const sc = resolveCentroScope(centro);
        const c0 = sc?.[0] ?? "";
        if (!c0) {
          setRows([]);
          setLoading(false);
          setError(null);
          return;
        }
        unsub = onSnapshot(
          query(
            colRef,
            woConstraintExcluirArchivadas(),
            where("centro", "==", c0),
            orderBy("updated_at", "desc"),
            limit(DASHBOARD_RECENT_OT_LIMIT),
          ),
          async (snap) => {
            const list = sortWorkOrdersByUpdatedAtDesc(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkOrder, "id">) })),
            ).slice(0, DASHBOARD_RECENT_OT_LIMIT);
            if (!cancelled) {
              setRows(list);
              setLoading(false);
              await cacheWorkOrdersForDay(
                list.map((r) => ({ id: r.id, json: r })),
                cacheKey,
              );
            }
          },
          (err) => {
            if (!cancelled) {
              setError(err);
              setLoading(false);
            }
          },
        );
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [centro, cacheKey, viewer?.uid, viewerRol, otSoloAsignadasDashboard, enabled]);

  return { rows, loading, error };
}

export type WorkOrderEspecialidadTab = Especialidad | "ALL";

export function useWorkOrdersByEspecialidad(
  centro: string | string[] | null | undefined,
  especialidadTab: WorkOrderEspecialidadTab,
  statusFilter: WorkOrderVistaStatus | "ALL",
  viewer?: { uid: string; rol: string },
): { ots: WorkOrder[]; loading: boolean; error: Error | null } {
  const [ots, setOts] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const viewerRol = toPermisoRol(viewer?.rol);
  /** Lista consolidada sin filtro por centro en Firestore (reglas permiten leer todas las OT). */
  const puedeListadoOtGlobal =
    viewerRol === "cliente_arauco" || tienePermiso(viewerRol, "ot:ver_todas");
  /** Solo técnico: `ot:ver_propias` sin `ot:ver_todas` — lista propias + pool sin asignar en el centro. */
  const otSoloAsignadas =
    tienePermiso(viewerRol, "ot:ver_propias") && !tienePermiso(viewerRol, "ot:ver_todas");

  useEffect(() => {
    const scope = resolveCentroScope(centro ?? null);
    const hasCentroScope = Boolean(scope && scope.length > 0);
    if (!hasCentroScope && !puedeListadoOtGlobal) {
      setOts([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    let unsub: Unsubscribe | (() => void) | undefined;
    const centroKey = scope?.[0] ?? "";
    const mergedTecnico = otSoloAsignadas && Boolean(scope?.length && viewer?.uid);

    if (mergedTecnico) {
      void (async () => {
        const auth = getFirebaseAuth();
        await auth.authStateReady();
        if (cancelled || !auth.currentUser) {
          if (!cancelled) {
            setOts([]);
            setLoading(false);
            setError(null);
          }
          return;
        }
        const db = getFirebaseDb();
        unsub = subscribeTecnicoWorkOrdersMultiCentroMerged(
          db,
          scope!,
          viewer!.uid,
          600,
          (merged) => {
            if (cancelled) return;
            let list = sortWorkOrdersByField(merged, "updated_at", "desc").slice(0, 160);
            if (especialidadTab !== "ALL") {
              list = list.filter((w) => w.especialidad === especialidadTab);
            }
            if (statusFilter !== "ALL") {
              list = list.filter((w) => workOrderVistaStatus(w) === statusFilter);
            }
            setOts(list);
            setLoading(false);
          },
          (err) => {
            if (!cancelled) {
              setError(err);
              setLoading(false);
            }
          },
          { field: "updated_at", direction: "desc" },
        );
      })();

      return () => {
        cancelled = true;
        unsub?.();
      };
    }

    const db = getFirebaseDb();
    const col = collection(db, COLLECTIONS.work_orders);

    let q: ReturnType<typeof query> | null = null;

    if (puedeListadoOtGlobal) {
      if (hasCentroScope) {
        q = query(
          col,
          woConstraintExcluirArchivadas(),
          where("centro", "==", scope![0]!),
          orderBy("updated_at", "desc"),
          limit(600),
        );
      } else {
        // Sin filtro de centro: query simple sin not-in para evitar índice multi-inequality.
        // El filtro de archivadas se aplica en cliente abajo.
        q = query(col, orderBy("updated_at", "desc"), limit(600));
      }
    } else if (centroKey && !otSoloAsignadas) {
      q = query(
        col,
        woConstraintExcluirArchivadas(),
        where("centro", "==", centroKey),
        orderBy("updated_at", "desc"),
        limit(600),
      );
    }

    if (!q) {
      setOts([]);
      setLoading(false);
      setError(null);
      return;
    }

    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setOts([]);
          setLoading(false);
          setError(null);
        }
        return;
      }

      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          let list = sortWorkOrdersByField(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<WorkOrder, "id">) }))
              .filter((w) => w.archivada !== true),
            "updated_at",
            "desc",
          ).slice(0, 160);
          if (especialidadTab !== "ALL") {
            list = list.filter((w) => w.especialidad === especialidadTab);
          }
          if (statusFilter !== "ALL") {
            list = list.filter((w) => workOrderVistaStatus(w) === statusFilter);
          }
          setOts(list);
          setLoading(false);
        },
        (err) => {
          if (!cancelled) {
            setError(err);
            setLoading(false);
          }
        },
      );
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [centro, especialidadTab, statusFilter, viewer?.uid, viewerRol, otSoloAsignadas, puedeListadoOtGlobal]);

  return { ots, loading, error };
}

function docToMaterialRow(id: string, data: Record<string, unknown>): MaterialOtListRow {
  if (data.schema_version === 1) {
    return { _kind: "field", id, ...(data as Omit<MaterialOT, "id">) };
  }
  return { _kind: "catalog", id, ...(data as Omit<MaterialLineWorkOrder, "id">) };
}

export function useWorkOrderMaterials(workOrderId: string | undefined): {
  materials: MaterialOtListRow[];
  loading: boolean;
  error: Error | null;
} {
  const [materials, setMaterials] = useState<MaterialOtListRow[]>([]);
  const [loading, setLoading] = useState(Boolean(workOrderId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!workOrderId) {
      setMaterials([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let unsub: Unsubscribe | undefined;
    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setMaterials([]);
          setLoading(false);
        }
        return;
      }
      const db = getFirebaseDb();
      const col = collection(db, "work_orders", workOrderId, "materiales_ot");
      unsub = onSnapshot(
        col,
        (snap) => {
          const rows = snap.docs.map((d) => docToMaterialRow(d.id, d.data() as Record<string, unknown>));
          rows.sort((a, b) => {
            const ta =
              a._kind === "field"
                ? (a.creado_at?.toMillis?.() ?? 0)
                : (a.created_at?.toMillis?.() ?? 0);
            const tb =
              b._kind === "field"
                ? (b.creado_at?.toMillis?.() ?? 0)
                : (b.created_at?.toMillis?.() ?? 0);
            return ta - tb;
          });
          setMaterials(rows);
          setLoading(false);
        },
        (err) => {
          setError(err);
          setLoading(false);
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [workOrderId]);

  return { materials, loading, error };
}

export function useWorkOrderChecklist(workOrderId: string | undefined): {
  items: ChecklistItem[];
  loading: boolean;
  error: Error | null;
} {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(Boolean(workOrderId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!workOrderId) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let unsub: Unsubscribe | undefined;
    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }
      const db = getFirebaseDb();
      const q = query(collection(db, "work_orders", workOrderId, "checklist"), orderBy("orden", "asc"));
      unsub = onSnapshot(
        q,
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChecklistItem, "id">) }));
          setItems(rows);
          setLoading(false);
        },
        (err) => {
          setError(err);
          setLoading(false);
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [workOrderId]);

  return { items, loading, error };
}

export function useWorkOrderHistorial(workOrderId: string | undefined): {
  events: WorkOrderHistorialEvent[];
  loading: boolean;
  error: Error | null;
} {
  const [events, setEvents] = useState<WorkOrderHistorialEvent[]>([]);
  const [loading, setLoading] = useState(Boolean(workOrderId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!workOrderId) {
      setEvents([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let unsub: Unsubscribe | undefined;
    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setEvents([]);
          setLoading(false);
        }
        return;
      }
      const db = getFirebaseDb();
      const q = query(
        collection(db, "work_orders", workOrderId, "historial"),
        orderBy("created_at", "asc"),
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<WorkOrderHistorialEvent, "id">),
          }));
          setEvents(rows);
          setLoading(false);
        },
        (err) => {
          setError(err);
          setLoading(false);
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [workOrderId]);

  return { events, loading, error };
}

/** Resuelve `display_name` en `users/{uid}` para filas de historial (solo lectura). */
export function useHistorialActorDisplayNames(actorUids: string[]): Record<string, string> {
  const sortedKey = useMemo(() => [...new Set(actorUids.filter(Boolean))].sort().join("|"), [actorUids]);
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const unique = sortedKey ? sortedKey.split("|").filter(Boolean) : [];
    if (!unique.length) return;

    let cancelled = false;
    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) return;

      const db = getFirebaseDb();
      const fetched: Record<string, string> = {};
      await Promise.all(
        unique.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, COLLECTIONS.users, uid));
            if (!snap.exists()) return;
            const dn = (snap.data() as UserProfile).display_name?.trim();
            if (dn) fetched[uid] = dn;
          } catch {
            /* permisos / red: omitir */
          }
        }),
      );
      if (!cancelled && Object.keys(fetched).length) {
        setMap((prev) => ({ ...prev, ...fetched }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sortedKey]);

  return map;
}

/** Última planilla de la OT (por `creadoAt` más reciente). */
export function usePlanillaRespuesta(otId: string | undefined): {
  respuesta: PlanillaRespuesta | null;
  loading: boolean;
  error: Error | null;
} {
  const [respuesta, setRespuesta] = useState<PlanillaRespuesta | null>(null);
  const [loading, setLoading] = useState(Boolean(otId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!otId) {
      setRespuesta(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let unsub: Unsubscribe | undefined;
    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setRespuesta(null);
          setLoading(false);
        }
        return;
      }
      const db = getFirebaseDb();
      const col = collection(db, "work_orders", otId, "planilla_respuestas");
      unsub = onSnapshot(
        col,
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<PlanillaRespuesta, "id">),
          }));
          rows.sort((a, b) => (b.creadoAt?.toMillis?.() ?? 0) - (a.creadoAt?.toMillis?.() ?? 0));
          setRespuesta(rows[0] ?? null);
          setLoading(false);
        },
        (err) => {
          setError(err);
          setLoading(false);
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [otId]);

  return { respuesta, loading, error };
}

export function usePlanillaTemplate(templateId: string | undefined): {
  template: PlanillaTemplate | null;
  loading: boolean;
  error: Error | null;
} {
  const [template, setTemplate] = useState<PlanillaTemplate | null>(null);
  const [loading, setLoading] = useState(Boolean(templateId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!templateId) {
      setTemplate(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let unsub: Unsubscribe | undefined;
    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setTemplate(null);
          setLoading(false);
        }
        return;
      }
      const db = getFirebaseDb();
      const ref = doc(db, "planilla_templates", templateId);
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            setTemplate(null);
            setLoading(false);
            return;
          }
          setTemplate(snap.data() as PlanillaTemplate);
          setLoading(false);
        },
        (err) => {
          setError(err);
          setLoading(false);
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [templateId]);

  return { template, loading, error };
}

export function useEquipoByCodigo(codigo: string | undefined): {
  equipo: Equipo | null;
  loading: boolean;
  error: Error | null;
} {
  const [equipo, setEquipo] = useState<Equipo | null>(null);
  const [loading, setLoading] = useState(Boolean(codigo?.trim()));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const c = codigo?.trim();
    if (!c) {
      setEquipo(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let unsub: Unsubscribe | undefined;
    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setEquipo(null);
          setLoading(false);
        }
        return;
      }
      const db = getFirebaseDb();
      const ref = doc(db, COLLECTIONS.equipos, c);
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            setEquipo(null);
            setLoading(false);
            return;
          }
          setEquipo({ id: snap.id, ...(snap.data() as Omit<Equipo, "id">) });
          setLoading(false);
        },
        (err) => {
          setError(err);
          setLoading(false);
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [codigo]);

  return { equipo, loading, error };
}

export function useComentariosOT(otId: string | undefined): {
  comentarios: Comentario[];
  loading: boolean;
  error: Error | null;
} {
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [loading, setLoading] = useState(Boolean(otId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!otId) {
      setComentarios([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let unsub: Unsubscribe | undefined;
    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (cancelled || !auth.currentUser) {
        if (!cancelled) {
          setComentarios([]);
          setLoading(false);
        }
        return;
      }
      const db = getFirebaseDb();
      const q = query(
        collection(db, COLLECTIONS.work_orders, otId, WORK_ORDER_SUB.comentarios),
        orderBy("creadoAt", "asc"),
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Comentario, "id">),
          }));
          setComentarios(rows);
          setLoading(false);
        },
        (err) => {
          setError(err);
          setLoading(false);
        },
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [otId]);

  return { comentarios, loading, error };
}
