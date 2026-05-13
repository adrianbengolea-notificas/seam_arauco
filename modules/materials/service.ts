import { AppError } from "@/lib/errors/app-error";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { MaterialCatalogItem } from "@/modules/materials/types";

export async function requireMaterial(materialId: string): Promise<MaterialCatalogItem> {
  const snap = await getAdminDb().collection(COLLECTIONS.materials).doc(materialId).get();
  if (!snap.exists) {
    throw new AppError("NOT_FOUND", "Material no encontrado", { details: { materialId } });
  }
  return { id: snap.id, ...(snap.data() as Omit<MaterialCatalogItem, "id">) };
}
