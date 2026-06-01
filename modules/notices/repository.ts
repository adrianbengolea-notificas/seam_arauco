import { getAdminDb } from "@/firebase/firebaseAdmin";
import { AVISOS_COLLECTION } from "@/lib/firestore/collections";
import { FieldValue, type UpdateData } from "firebase-admin/firestore";
import type { Aviso } from "@/modules/notices/types";

export { AVISOS_COLLECTION };

export async function getAvisoById(avisoId: string): Promise<Aviso | null> {
  const snap = await getAdminDb().collection(AVISOS_COLLECTION).doc(avisoId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<Aviso, "id">) };
}

export async function updateAviso(
  avisoId: string,
  patch: UpdateData<Omit<Aviso, "id">>,
): Promise<void> {
  await getAdminDb()
    .collection(AVISOS_COLLECTION)
    .doc(avisoId)
    .update({
      ...patch,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
}
