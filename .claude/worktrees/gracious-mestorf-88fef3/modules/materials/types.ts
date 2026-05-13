import type { Timestamp } from "firebase/firestore";
import type { MaterialOT } from "@/modules/work-orders/types";

/** Filtros vista reporting Materiales consumidos en OTs (cliente). */
export type MaterialesOTFilters = {
  tipo?: "preventivo" | "correctivo" | "todos";
  /** A = AA mecánico, E = eléctrico (ELECTRICO en Firestore), GG */
  especialidad?: "A" | "E" | "GG" | "todos";
  origen?: "ARAUCO" | "EXTERNO" | "todos";
  desde?: Date;
  hasta?: Date;
  centro?: string;
};

/** Fila normalizada para UI (collectionGroup `materiales_ot`, schema v1). */
export type MaterialOTConsumoRow = {
  id: string;
  otId: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  origen: "ARAUCO" | "EXTERNO";
  observaciones?: string;
  otTipo: "preventivo" | "correctivo" | null;
  otEspecialidad: "AA" | "ELECTRICO" | "GG" | "HG" | null;
  otNumeroAviso: string;
  otDescripcion: string;
  otFechaCompletada: Timestamp | null;
  otCentro: string;
  creadoAt: Timestamp;
  creadoPor: string;
};

export type MaterialesOTTotales = {
  total: number;
  porOrigen: { ARAUCO: number; EXTERNO: number };
  porTipo: { preventivo: number; correctivo: number };
  porEspecialidad: { A: number; E: number; GG: number; HG: number };
};

/** Catálogo — colección `materials` */
export type MaterialCatalogItem = {
  id: string;
  codigo_material: string;
  descripcion: string;
  unidad_medida: string;
  centro_almacen?: string;
  stock_disponible?: number;
  /** Si stock_disponible <= stock_minimo, se trata como alerta (dashboard). */
  stock_minimo?: number | null;
  activo: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** Movimiento de inventario — colección `stock_movimientos`. */
export type StockMovimiento = {
  id: string;
  materialId: string;
  codigoMaterial: string;
  descripcion: string;
  tipo: "entrada" | "salida";
  cantidad: number;
  unidad: string;
  origen: "ARAUCO" | "EXTERNO" | "OT";
  otId?: string;
  observaciones?: string;
  /** Denormalizado del catálogo para filtrar reporting por centro / almacén. */
  centro_almacen?: string;
  stockAntes: number;
  stockDespues: number;
  registradoPor: string;
  fecha: Timestamp;
};

/** Línea consumida en una OT — subcolección `work_orders/{woId}/materiales_ot` */
export type MaterialLineWorkOrder = {
  id: string;
  material_id: string;
  codigo_material: string;
  descripcion_snapshot: string;
  unidad_medida: string;
  cantidad_solicitada: number;
  cantidad_consumida: number;
  lote?: string;
  observacion?: string;
  registrado_por_uid: string;
  created_at: Timestamp;
};

/** Fila unificada para UI/PDF (catálogo legacy vs carga manual). */
export type MaterialOtListRow =
  | ({ _kind: "catalog" } & MaterialLineWorkOrder)
  | ({ _kind: "field" } & MaterialOT);
