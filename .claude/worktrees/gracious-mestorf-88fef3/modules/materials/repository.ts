import { getAdminDb } from "@/firebase/firebaseAdmin";
import { AppError } from "@/lib/errors/app-error";
import { COLLECTIONS, STOCK_MOVIMIENTOS_COLLECTION, WORK_ORDER_SUB } from "@/lib/firestore/collections";
import type { MaterialCatalogItem, MaterialLineWorkOrder, MaterialOtListRow } from "@/modules/materials/types";
import type { MaterialOT } from "@/modules/work-orders/types";
import { FieldValue } from "firebase-admin/firestore";

export const MATERIALS_COLLECTION = COLLECTIONS.materials;

export async function addMaterialLineAdmin(
  workOrderId: string,
  line: Omit<MaterialLineWorkOrder, "id" | "created_at">,
): Promise<string> {
  const ref = await getAdminDb()
    .collection(COLLECTIONS.work_orders)
    .doc(workOrderId)
    .collection(WORK_ORDER_SUB.materiales_ot)
    .add({
      ...line,
      created_at: FieldValue.serverTimestamp(),
    });
  return ref.id;
}

export async function addMaterialOtFieldAdmin(
  workOrderId: string,
  row: Omit<MaterialOT, "id" | "creado_at">,
): Promise<string> {
  const ref = await getAdminDb()
    .collection(COLLECTIONS.work_orders)
    .doc(workOrderId)
    .collection(WORK_ORDER_SUB.materiales_ot)
    .add({
      ...row,
      creado_at: FieldValue.serverTimestamp(),
    });
  return ref.id;
}

function docToMaterialRow(id: string, data: Record<string, unknown>): MaterialOtListRow {
  if (data.schema_version === 1) {
    return { _kind: "field", id, ...(data as Omit<MaterialOT, "id">) };
  }
  return { _kind: "catalog", id, ...(data as Omit<MaterialLineWorkOrder, "id">) };
}

export async function listMaterialesOtAdmin(workOrderId: string): Promise<MaterialOtListRow[]> {
  const snap = await getAdminDb()
    .collection(COLLECTIONS.work_orders)
    .doc(workOrderId)
    .collection(WORK_ORDER_SUB.materiales_ot)
    .get();
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
  return rows;
}

export async function getMaterialCatalogItemAdmin(materialId: string): Promise<MaterialCatalogItem | null> {
  const snap = await getAdminDb().collection(COLLECTIONS.materials).doc(materialId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<MaterialCatalogItem, "id">) };
}

/** Catálogo activo para contexto de IA (máx. `max`, filtrado en memoria por `activo`). */
export async function listActiveMaterialsCatalogAdmin(max = 50): Promise<
  Pick<MaterialCatalogItem, "id" | "codigo_material" | "descripcion" | "unidad_medida">[]
> {
  const snap = await getAdminDb().collection(COLLECTIONS.materials).limit(120).get();
  const rows: Pick<MaterialCatalogItem, "id" | "codigo_material" | "descripcion" | "unidad_medida">[] = [];
  for (const d of snap.docs) {
    const data = d.data() as { activo?: boolean; codigo_material?: string; descripcion?: string; unidad_medida?: string };
    if (data.activo === false) continue;
    rows.push({
      id: d.id,
      codigo_material: String(data.codigo_material ?? ""),
      descripcion: String(data.descripcion ?? ""),
      unidad_medida: String(data.unidad_medida ?? ""),
    });
    if (rows.length >= max) break;
  }
  return rows;
}

export async function createMaterialCatalogAdmin(
  data: Omit<MaterialCatalogItem, "id" | "created_at" | "updated_at">,
): Promise<string> {
  const ref = await getAdminDb().collection(COLLECTIONS.materials).add({
    ...data,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

type SalidaOtStockInput = {
  materialId: string;
  codigoMaterial: string;
  descripcionMaterial: string;
  cantidad: number;
  unidad: string;
  otId: string;
  registradoPorUid: string;
};

export async function applySalidaStockPorOtTransaction(input: SalidaOtStockInput): Promise<void> {
  const db = getAdminDb();
  const matRef = db.collection(COLLECTIONS.materials).doc(input.materialId);
  const movRef = db.collection(STOCK_MOVIMIENTOS_COLLECTION).doc();

  await db.runTransaction(async (txn) => {
    const mat = await txn.get(matRef);
    if (!mat.exists) {
      throw new AppError("NOT_FOUND", "Material de catálogo no encontrado");
    }
    const matData = mat.data() as { stock_disponible?: number; centro_almacen?: string };
    const antes = Number(matData.stock_disponible ?? 0);
    const despues = antes - input.cantidad;
    txn.update(matRef, {
      stock_disponible: FieldValue.increment(-input.cantidad),
      updated_at: FieldValue.serverTimestamp(),
    });
    txn.set(movRef, {
      materialId: input.materialId,
      codigoMaterial: input.codigoMaterial,
      descripcion: input.descripcionMaterial,
      tipo: "salida",
      cantidad: input.cantidad,
      unidad: input.unidad,
      origen: "OT",
      otId: input.otId,
      centro_almacen: matData.centro_almacen ?? "",
      stockAntes: antes,
      stockDespues: despues,
      registradoPor: input.registradoPorUid,
      fecha: FieldValue.serverTimestamp(),
    });
  });
}

type EntradaStockInput = {
  materialId: string;
  codigoMaterial: string;
  descripcionMaterial: string;
  cantidad: number;
  unidad: string;
  origen: "ARAUCO" | "EXTERNO";
  observaciones?: string;
  registradoPorUid: string;
};

export async function applyEntradaStockTransaction(input: EntradaStockInput): Promise<void> {
  const db = getAdminDb();
  const matRef = db.collection(COLLECTIONS.materials).doc(input.materialId);
  const movRef = db.collection(STOCK_MOVIMIENTOS_COLLECTION).doc();

  await db.runTransaction(async (txn) => {
    const mat = await txn.get(matRef);
    if (!mat.exists) {
      throw new AppError("NOT_FOUND", "Material de catálogo no encontrado");
    }
    const matData = mat.data() as { stock_disponible?: number; centro_almacen?: string };
    const antes = Number(matData.stock_disponible ?? 0);
    const despues = antes + input.cantidad;
    txn.update(matRef, {
      stock_disponible: FieldValue.increment(input.cantidad),
      updated_at: FieldValue.serverTimestamp(),
    });
    txn.set(movRef, {
      materialId: input.materialId,
      codigoMaterial: input.codigoMaterial,
      descripcion: input.descripcionMaterial,
      tipo: "entrada",
      cantidad: input.cantidad,
      unidad: input.unidad,
      origen: input.origen,
      observaciones: input.observaciones ?? null,
      centro_almacen: matData.centro_almacen ?? "",
      stockAntes: antes,
      stockDespues: despues,
      registradoPor: input.registradoPorUid,
      fecha: FieldValue.serverTimestamp(),
    });
  });
}
