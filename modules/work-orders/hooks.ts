"use client";

import { getFirebaseDb } from "@/firebase/firebaseClient";
import { cacheWorkOrdersForDay, dayKeyFromDate, loadCachedWorkOrdersForDay } from "@/lib/offline/ot-db";
import type { MaterialLineWorkOrder, MaterialOtListRow } from "@/modules/materials/types";
import type { Especialidad } from "@/modules/notices/types";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Equipo, PlanillaRespuesta, PlanillaTemplate } from "@/lib/firestore/types";
import type {
  ChecklistItem,
  MaterialOT,
  WorkOrder,
  WorkOrderHistorialEvent,
  WorkOrderVistaStatus,
} from "@/modules/work-orders/types";
import { workOrderVistaStatus } from "@/modules/work-orders/types";
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
import { toPermisoRol } from "@/lib/permisos/index";

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
    const db = getFirebaseDb();
    const ref = doc(db, "work_orders", workOrderId);
    const unsub: Unsubscribe = onSnapshot(ref, (snap) => {
        if (!snap.exists) {
          setWorkOrder(null);
          setLoading(false);
          return;
        }
        setWorkOrder({ id: snap.id, ...(snap.data() as Omit<WorkOrder, "id">) });
        setLoading(false);
    }, (err) => {
        setError(err);
        setLoading(false);
      });
    return () => unsub();
  }, [workOrderId]);

  return { workOrder, loading, error };
}

/**
 * Escucha OT recientes por centro, o todas si `centro` es `null` (vista consolidada).
 * La muestra se ordena por `updated_at` en cliente; Firestore solo aplica `limit`.
 */
export function useTodaysWorkOrdersCached(centro: string | null): {
  rows: WorkOrder[];
  loading: boolean;
  error: Error | null;
} {
  const dayKey = useMemo(() => dayKeyFromDate(new Date()), []);
  const cacheKey = useMemo(() => `${dayKey}|${centro ?? "__ALL__"}`, [dayKey, centro]);
  const [rows, setRows] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCachedWorkOrdersForDay(cacheKey).then((cached) => {
      if (!cancelled && cached.length) {
        setRows(cached as WorkOrder[]);
      }
    });

    const db = getFirebaseDb();
    const q =
      centro === null
        ? query(collection(db, "work_orders"), limit(300))
        : query(collection(db, "work_orders"), where("centro", "==", centro), limit(300));

    const unsub: Unsubscribe = onSnapshot(
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

    return () => {
      cancelled = true;
      unsub();
    };
  }, [centro, cacheKey]);

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

  useEffect(() => {
    if (!centro && viewerRol !== "superadmin") {
      setOts([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const db = getFirebaseDb();
    const col = collection(db, "work_orders");
    const q =
      viewerRol === "tecnico" && viewer?.uid && centro
        ? query(
            col,
            where("centro", "==", centro),
            where("tecnico_asignado_uid", "==", viewer.uid),
            limit(600),
          )
        : viewerRol === "superadmin" && !centro
          ? query(col, limit(600))
          : centro
            ? query(col, where("centro", "==", centro), limit(600))
            : null;

    if (!q) {
      setOts([]);
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
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

    return () => {
      cancelled = true;
      unsub();
    };
  }, [centro, especialidadTab, statusFilter, viewer?.uid, viewerRol]);

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
    const db = getFirebaseDb();
    const col = collection(db, "work_orders", workOrderId, "materiales_ot");
    const unsub = onSnapshot(
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
    return () => unsub();
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
    const db = getFirebaseDb();
    const q = query(collection(db, "work_orders", workOrderId, "checklist"), orderBy("orden", "asc"));
    const unsub = onSnapshot(
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
    return () => unsub();
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
    const db = getFirebaseDb();
    const q = query(
      collection(db, "work_orders", workOrderId, "historial"),
      orderBy("created_at", "asc"),
    );
    const unsub = onSnapshot(
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
    return () => unsub();
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
    const db = getFirebaseDb();
    const col = collection(db, "work_orders", otId, "planilla_respuestas");
    const unsub: Unsubscribe = onSnapshot(
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
    return () => unsub();
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
    const db = getFirebaseDb();
    const ref = doc(db, "planilla_templates", templateId);
    const unsub: Unsubscribe = onSnapshot(
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
    return () => unsub();
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
    const db = getFirebaseDb();
    const ref = doc(db, COLLECTIONS.equipos, c);
    const unsub: Unsubscribe = onSnapshot(
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
    return () => unsub();
  }, [codigo]);

  return { equipo, loading, error };
}
