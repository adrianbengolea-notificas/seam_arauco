"use client";

import { getFirebaseDb } from "@/firebase/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type {
  MaterialCatalogItem,
  MaterialOTConsumoRow,
  MaterialesOTFilters,
  MaterialesOTTotales,
  StockMovimiento,
} from "@/modules/materials/types";
import type { MaterialNormalizacion } from "@/modules/work-orders/types";
import {
  collection,
  collectionGroup,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { endOfDay, endOfMonth, startOfDay, startOfMonth } from "date-fns";
import { useEffect, useMemo, useState } from "react";

export type MaterialOtNormRow = {
  otId: string;
  lineId: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  normalizacion?: MaterialNormalizacion;
  catalogo_id?: string;
  codigo_material?: string;
  descripcion_match?: string;
  confianza_ia?: number;
  nombre_normalizado?: string;
  creado_at?: Timestamp;
};

/** Nombre real de la subcolección en Firestore (`work_orders/{id}/materiales_ot`). Equivale al "materials_ot" del diseño. */
const MATERIALES_OT_GROUP = "materiales_ot";
const SNAPSHOT_LIMIT = 4000;

function materialesFiltersKey(f: MaterialesOTFilters): string {
  return JSON.stringify({
    tipo: f.tipo ?? "todos",
    esp: f.especialidad ?? "todos",
    origen: f.origen ?? "todos",
    centro: f.centro?.trim() ?? "",
    desde: f.desde?.getTime() ?? "",
    hasta: f.hasta?.getTime() ?? "",
  });
}

function workOrderIdFromPath(doc: QueryDocumentSnapshot): string {
  const parts = doc.ref.path.split("/");
  return parts[1] ?? "";
}

function docToConsumoRow(doc: QueryDocumentSnapshot): MaterialOTConsumoRow | null {
  const data = doc.data() as Record<string, unknown>;
  if (data.schema_version !== 1) return null;
  const creado = data.creado_at as Timestamp | undefined;
  if (!creado?.toMillis) return null;
  const origen = data.origen;
  if (origen !== "ARAUCO" && origen !== "EXTERNO") return null;

  return {
    id: doc.id,
    otId: (typeof data.ot_id === "string" && data.ot_id) ? data.ot_id : workOrderIdFromPath(doc),
    descripcion: String(data.descripcion ?? ""),
    cantidad: Number(data.cantidad ?? 0),
    unidad: String(data.unidad ?? ""),
    origen,
    observaciones: typeof data.observaciones === "string" ? data.observaciones : undefined,
    otTipo: (data.ot_tipo === "preventivo" || data.ot_tipo === "correctivo" ? data.ot_tipo : null) as
      | "preventivo"
      | "correctivo"
      | null,
    otEspecialidad:
      data.ot_especialidad === "AA" ||
      data.ot_especialidad === "ELECTRICO" ||
      data.ot_especialidad === "GG" ||
      data.ot_especialidad === "HG"
        ? data.ot_especialidad
        : null,
    otNumeroAviso: String(data.ot_numero_aviso ?? ""),
    otDescripcion: String(data.ot_descripcion ?? ""),
    otFechaCompletada:
      data.ot_fecha_completada &&
      typeof (data.ot_fecha_completada as Timestamp).toMillis === "function"
        ? (data.ot_fecha_completada as Timestamp)
        : null,
    otCentro: String(data.ot_centro ?? ""),
    creadoAt: creado,
    creadoPor: String(data.creado_por ?? ""),
  };
}

function applyMaterialesFilters(rows: MaterialOTConsumoRow[], f: MaterialesOTFilters): MaterialOTConsumoRow[] {
  let out = rows;
  const centro = f.centro?.trim();
  if (centro) {
    out = out.filter((r) => r.otCentro === centro);
  }
  if (f.tipo && f.tipo !== "todos") {
    out = out.filter((r) => r.otTipo === f.tipo);
  }
  if (f.especialidad && f.especialidad !== "todos") {
    const want =
      f.especialidad === "A" ? "AA" : f.especialidad === "E" ? "ELECTRICO" : "GG";
    out = out.filter((r) => r.otEspecialidad === want);
  }
  if (f.origen && f.origen !== "todos") {
    out = out.filter((r) => r.origen === f.origen);
  }
  return out;
}

function emptyTotales(): MaterialesOTTotales {
  return {
    total: 0,
    porOrigen: { ARAUCO: 0, EXTERNO: 0 },
    porTipo: { preventivo: 0, correctivo: 0 },
    porEspecialidad: { A: 0, E: 0, GG: 0, HG: 0 },
  };
}

function computeTotales(rows: MaterialOTConsumoRow[]): MaterialesOTTotales {
  const t = emptyTotales();
  for (const r of rows) {
    const q = r.cantidad;
    if (!Number.isFinite(q) || q < 0) continue;
    t.total += q;
    t.porOrigen[r.origen] += q;
    if (r.otTipo === "preventivo") t.porTipo.preventivo += q;
    else if (r.otTipo === "correctivo") t.porTipo.correctivo += q;
    switch (r.otEspecialidad) {
      case "AA":
        t.porEspecialidad.A += q;
        break;
      case "ELECTRICO":
        t.porEspecialidad.E += q;
        break;
      case "GG":
        t.porEspecialidad.GG += q;
        break;
      case "HG":
        t.porEspecialidad.HG += q;
        break;
      default:
        break;
    }
  }
  return t;
}

/**
 * Materiales consumidos en OTs (collectionGroup `materiales_ot`, ítems schema v1).
 * Consulta por rango de `creado_at`; el resto de filtros se aplica en cliente.
 */
export function useMaterialesOT(
  filters: MaterialesOTFilters,
  options?: { enabled?: boolean },
): {
  materiales: MaterialOTConsumoRow[];
  totales: MaterialesOTTotales;
  loading: boolean;
  error: Error | null;
  /** True si el snapshot alcanzó el límite interno (convendría acotar fechas o paginar en servidor). */
  hitLimit: boolean;
} {
  const enabled = options?.enabled !== false;
  const [raw, setRaw] = useState<MaterialOTConsumoRow[]>([]);
  const [hitLimit, setHitLimit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const desdeTs = (filters.desde ?? startOfMonth(new Date())).getTime();
  const hastaTs = (filters.hasta ?? endOfMonth(new Date())).getTime();
  const fKey = materialesFiltersKey(filters);

  useEffect(() => {
    if (!enabled) {
      setRaw([]);
      setHitLimit(false);
      setLoading(false);
      setError(null);
      return;
    }

    const db = getFirebaseDb();
    const desde = startOfDay(filters.desde ?? startOfMonth(new Date()));
    const hasta = endOfDay(filters.hasta ?? endOfMonth(new Date()));
    setLoading(true);
    setError(null);

    const qRef = query(
      collectionGroup(db, MATERIALES_OT_GROUP),
      where("schema_version", "==", 1),
      where("creado_at", ">=", Timestamp.fromDate(desde)),
      where("creado_at", "<=", Timestamp.fromDate(hasta)),
      orderBy("creado_at", "desc"),
      limit(SNAPSHOT_LIMIT),
    );

    const unsub: Unsubscribe = onSnapshot(
      qRef,
      (snap) => {
        const rows: MaterialOTConsumoRow[] = [];
        for (const d of snap.docs) {
          const row = docToConsumoRow(d);
          if (row) rows.push(row);
        }
        setHitLimit(snap.docs.length >= SNAPSHOT_LIMIT);
        setRaw(rows);
        setLoading(false);
      },
      (err) => {
        setHitLimit(false);
        setError(err);
        setLoading(false);
      },
    );

    return () => unsub();
    // Solo el mismo rango de fechas debe reabrir la suscripción; el resto se filtra en cliente.
  }, [desdeTs, hastaTs, enabled]);

  const materiales = useMemo(() => applyMaterialesFilters(raw, filters), [raw, fKey]);
  const totales = useMemo(() => computeTotales(materiales), [materiales]);

  return { materiales, totales, loading, error, hitLimit };
}

export function useMaterialsCatalogLive(max: number = 500): {
  items: MaterialCatalogItem[];
  itemsBajoStock: MaterialCatalogItem[];
  loading: boolean;
  error: Error | null;
} {
  const [items, setItems] = useState<MaterialCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const db = getFirebaseDb();
    const q = query(collection(db, "materials"), limit(max));
    const unsub: Unsubscribe = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Omit<MaterialCatalogItem, "id">) }),
        );
        setItems(rows);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [max]);

  const itemsBajoStock = useMemo(() => {
    return items.filter((it) => {
      if (it.stock_minimo == null || it.stock_minimo === undefined) return false;
      const s = it.stock_disponible ?? 0;
      return s <= it.stock_minimo;
    });
  }, [items]);

  return { items, itemsBajoStock, loading, error };
}

/** Sugerencias de catálogo sobre datos ya cargados (debounce 250 ms, mín. 2 caracteres). */
export function useMaterialSearch(
  rawQuery: string,
  catalogItems: MaterialCatalogItem[],
  _especialidad?: string,
): MaterialCatalogItem[] {
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const q = rawQuery.trim();
    if (q.length < 2) {
      setDebounced("");
      return;
    }
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [rawQuery]);

  return useMemo(() => {
    if (debounced.length < 2) return [];
    const d = debounced.toLowerCase();
    return catalogItems
      .filter((it) => it.activo !== false)
      .filter(
        (it) =>
          it.descripcion.toLowerCase().includes(d) || it.codigo_material.toLowerCase().includes(d),
      )
      .slice(0, 5);
  }, [catalogItems, debounced]);
}

export function useStockMovimientos(
  materialId: string | undefined,
  authUid: string | undefined,
  options?: {
    /** Acota movimientos al almacén / centro del catálogo (campo denormalizado en el doc). */
    filterCentro?: string;
    /** Si true, incluye movimientos sin `centro_almacen` (datos previos a la denormalización). */
    includeLegacySinCentro?: boolean;
  },
): {
  movimientos: StockMovimiento[];
  loading: boolean;
  error: Error | null;
} {
  const [movimientos, setMovimientos] = useState<StockMovimiento[]>([]);
  const [loading, setLoading] = useState(Boolean(authUid));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!authUid) {
      setMovimientos([]);
      setLoading(false);
      setError(null);
      return;
    }
    const db = getFirebaseDb();
    const base = collection(db, COLLECTIONS.stock_movimientos);
    const q = materialId?.trim()
      ? query(
          base,
          where("materialId", "==", materialId.trim()),
          orderBy("fecha", "desc"),
          limit(20),
        )
      : query(base, orderBy("fecha", "desc"), limit(20));

    const fc = options?.filterCentro?.trim();
    const legacy = options?.includeLegacySinCentro ?? false;

    const unsub: Unsubscribe = onSnapshot(
      q,
      (snap) => {
        let rows: StockMovimiento[] = snap.docs.map((d) => {
          const data = d.data() as Omit<StockMovimiento, "id">;
          return { id: d.id, ...data };
        });
        if (fc) {
          rows = rows.filter((m) => {
            const c = (m.centro_almacen ?? "").trim();
            if (!c && legacy) return true;
            return c === fc;
          });
        }
        setMovimientos(rows);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [materialId, authUid, options?.filterCentro, options?.includeLegacySinCentro]);

  return { movimientos, loading, error };
}

export function useMaterialOtByNormalizacion(
  normalizacion: MaterialNormalizacion | null | undefined,
  authUid: string | undefined,
  options?: { limit?: number },
): {
  rows: MaterialOtNormRow[];
  loading: boolean;
  error: Error | null;
} {
  const cap = options?.limit ?? 80;
  const normKey = normalizacion ?? null;
  const [rows, setRows] = useState<MaterialOtNormRow[]>([]);
  const [loading, setLoading] = useState(Boolean(normKey && authUid));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!normKey || !authUid) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    const db = getFirebaseDb();
    const q = query(
      collectionGroup(db, MATERIALES_OT_GROUP),
      where("schema_version", "==", 1),
      where("normalizacion", "==", normalizacion),
      orderBy("creado_at", "desc"),
      limit(cap),
    );
    const unsub: Unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list: MaterialOtNormRow[] = [];
        for (const d of snap.docs) {
          const parts = d.ref.path.split("/");
          const otId = parts[1] ?? "";
          const data = d.data() as Record<string, unknown>;
          list.push({
            otId,
            lineId: d.id,
            descripcion: String(data.descripcion ?? ""),
            cantidad: Number(data.cantidad ?? 0),
            unidad: String(data.unidad ?? ""),
            normalizacion: data.normalizacion as MaterialNormalizacion | undefined,
            catalogo_id: typeof data.catalogo_id === "string" ? data.catalogo_id : undefined,
            codigo_material: typeof data.codigo_material === "string" ? data.codigo_material : undefined,
            descripcion_match: typeof data.descripcion_match === "string" ? data.descripcion_match : undefined,
            confianza_ia: typeof data.confianza_ia === "number" ? data.confianza_ia : undefined,
            nombre_normalizado:
              typeof data.nombre_normalizado === "string" ? data.nombre_normalizado : undefined,
            creado_at: data.creado_at as Timestamp | undefined,
          });
        }
        setRows(list);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [normKey, authUid, cap]);

  return { rows, loading, error };
}
