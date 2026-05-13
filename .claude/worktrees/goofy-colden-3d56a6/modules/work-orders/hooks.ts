/* eslint-disable react-hooks/set-state-in-effect -- Suscripciones Firestore: reset síncrono al cambiar filtro y al cortar sesión. */
"use client";

import { getFirebaseAuth, getFirebaseDb } from "@/firebase/firebaseClient";
import { cacheWorkOrdersForDay, dayKeyFromDate, loadCachedWorkOrdersForDay } from "@/lib/offline/ot-db";
import type { MaterialLineWorkOrder, MaterialOtListRow } from "@/modules/materials/types";
import type { Especialidad } from "@/modules/notices/types";
import { COLLECTIONS, WORK_ORDER_SUB } from "@/lib/firestore/collections";
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
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { tienePermiso, toPermisoRol } from "@/lib/permisos/index";

/** Orden descendente por `updated_at` (sin orderBy en Firestore → no exige índice compuesto centro+updated_at). */
function sortWorkOrdersByUpdatedAtDesc(list: WorkOrder[]): WorkOrder[] {
  return [...list].sort((a, b) => {
    const ta = a.updated_at?.toMillis?.() ?? 0;
    const tb = b.updated_at?.toMillis?.() ?? 0;
    return tb - ta;
  });
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

/**
 * Escucha OT recientes por centro, o todas si `centro` es `null` (vista consolidada).
 * Con `viewer` rol `tecnico`, filtra por `tecnico_asignado_uid` para cumplir reglas de Firestore.
 * La muestra se ordena por `updated_at` en cliente; Firestore solo aplica `limit`.
 */
export function useTodaysWorkOrdersCached(
  centro: string | null,
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
  const otSoloAsignadasDashboard =
    viewerRol !== null &&
    tienePermiso(viewerRol, "ot:ver_propias") &&
    !tienePermiso(viewerRol, "ot:ver_todas");
  const cacheKey = useMemo(
    () =>
      `${dayKey}|${centro ?? "__ALL__"}|${viewer?.uid ?? "_"}|${viewerRol ?? "nov"}`,
    [dayKey, centro, viewer?.uid, viewerRol],
  );
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

    if (
      otSoloAsignadasDashboard &&
      (centro === null || !String(centro).trim() || !viewer?.uid)
    ) {
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

      const q =
        centro === null
          ? query(colRef, limit(300))
          : otSoloAsignadasDashboard && viewer?.uid
            ? query(
                colRef,
                where("centro", "==", centro),
                where("tecnico_asignado_uid", "==", viewer.uid),
                limit(300),
              )
            : query(colRef, where("centro", "==", centro), limit(300));

      unsub = onSnapshot(
        q,
        async (snap) => {
          const list = sortWorkOrdersByUpdatedAtDesc(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkOrder, "id">) })),
          ).slice(0, 80);
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
  centro: string | undefined,
  especialidadTab: WorkOrderEspecialidadTab,
  statusFilter: WorkOrderVistaStatus | "ALL",
  viewer?: { uid: string; rol: string },
): { ots: WorkOrder[]; loading: boolean; error: Error | null } {
  const [ots, setOts] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(Boolean(centro));
  const [error, setError] = useState<Error | null>(null);

  const viewerRol = toPermisoRol(viewer?.rol);
  /** Solo técnico/operario: si caemos en query por centro sin asignado, Firestore devuelve permission-denied. */
  const otSoloAsignadas =
    tienePermiso(viewerRol, "ot:ver_propias") && !tienePermiso(viewerRol, "ot:ver_todas");

  useEffect(() => {
    if (!centro && viewerRol !== "superadmin") {
      setOts([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    let unsub: Unsubscribe | undefined;
    const db = getFirebaseDb();
    const col = collection(db, COLLECTIONS.work_orders);
    const centroKey = typeof centro === "string" ? centro.trim() : "";

    let q:
      | ReturnType<typeof query>
      | null = null;

    if (otSoloAsignadas) {
      if (centroKey && viewer?.uid) {
        q = query(
          col,
          where("centro", "==", centroKey),
          where("tecnico_asignado_uid", "==", viewer.uid),
          limit(600),
        );
      }
    } else if (viewerRol === "cliente_arauco" && centroKey) {
      q = query(col, where("centro", "==", centroKey), limit(600));
    } else if (viewerRol === "superadmin" && !centro) {
      q = query(col, limit(600));
    } else if (centroKey) {
      q = query(col, where("centro", "==", centroKey), limit(600));
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
          let list = sortWorkOrdersByUpdatedAtDesc(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkOrder, "id">) })),
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
  }, [centro, especialidadTab, statusFilter, viewer?.uid, viewerRol, otSoloAsignadas]);

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
