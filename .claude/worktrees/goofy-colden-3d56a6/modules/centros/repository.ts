import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CentroFirestoreDoc } from "@/modules/centros/types";

export async function getCentroDocAdmin(centroId: string): Promise<CentroFirestoreDoc | null> {
  const id = centroId.trim();
  if (!id) return null;
  const snap = await getAdminDb().collection(COLLECTIONS.centros).doc(id).get();
  if (!snap.exists) return null;
  return snap.data() as CentroFirestoreDoc;
}
