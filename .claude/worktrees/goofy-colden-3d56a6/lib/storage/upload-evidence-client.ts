"use client";

import { getFirebaseStorage } from "@/firebase/firebaseClient";
import { compressImageFile } from "@/lib/media/compress-image";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

export type UploadEvidenceResult = {
  storage_path: string;
  download_url: string;
  content_type: string;
  tamano_bytes: number;
};

/**
 * Comprime, sube a Storage y devuelve metadatos para `registerEvidenceAfterUpload`.
 * Ruta: evidencias/{workOrderId}/{timestamp}_{random}.jpg
 */
export async function uploadWorkOrderEvidence(
  workOrderId: string,
  file: File,
  uid: string,
): Promise<UploadEvidenceResult> {
  const blob = await compressImageFile(file, { mimeType: "image/jpeg", quality: 0.82 });
  const storage = getFirebaseStorage();
  const name = `${Date.now()}_${Math.random().toString(16).slice(2)}.jpg`;
  const path = `evidencias/${workOrderId}/${uid}/${name}`;
  const storageRef = ref(storage, path);
  const contentType = "image/jpeg";
  await uploadBytes(storageRef, blob, { contentType });
  const download_url = await getDownloadURL(storageRef);
  return {
    storage_path: path,
    download_url,
    content_type: contentType,
    tamano_bytes: blob.size,
  };
}
