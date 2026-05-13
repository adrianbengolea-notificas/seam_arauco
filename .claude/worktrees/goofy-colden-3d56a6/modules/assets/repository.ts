import { getAdminDb } from "@/firebase/firebaseAdmin";
import { AppError } from "@/lib/errors/app-error";
import type { Asset, EspecialidadActivo } from "@/modules/assets/types";
import { FieldValue } from "firebase-admin/firestore";

export const ASSETS_COLLECTION = "assets";

function assetDocIdFromCodigo(codigo: string): string {
  return codigo.trim().replace(/\//g, "-");
}

export type AdminCreateAssetInput = {
  codigo_nuevo: string;
  codigo_legacy?: string;
  denominacion: string;
  ubicacion_tecnica: string;
  centro: string;
  clase?: string;
  grupo_planificacion?: string;
  especialidad_predeterminada?: EspecialidadActivo;
  activo_operativo: boolean;
};

/** Alta unitaria vía Admin SDK; el id del documento se deriva del código nuevo (misma regla que la importación Excel). */
export async function adminCreateAsset(input: AdminCreateAssetInput): Promise<{ id: string }> {
  const db = getAdminDb();
  const id = assetDocIdFromCodigo(input.codigo_nuevo);
  const ref = db.collection(ASSETS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (snap.exists) {
    throw new AppError("CONFLICT", "Ya existe un activo con ese código de equipo", {
      details: { id },
    });
  }

  const payload: Record<string, unknown> = {
    codigo_nuevo: input.codigo_nuevo.trim(),
    denominacion: input.denominacion.trim(),
    ubicacion_tecnica: input.ubicacion_tecnica.trim(),
    centro: input.centro.trim(),
    activo_operativo: input.activo_operativo,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  };
  if (input.codigo_legacy?.trim()) payload.codigo_legacy = input.codigo_legacy.trim();
  if (input.clase?.trim()) payload.clase = input.clase.trim();
  if (input.grupo_planificacion?.trim()) {
    payload.grupo_planificacion = input.grupo_planificacion.trim();
  }
  if (input.especialidad_predeterminada) {
    payload.especialidad_predeterminada = input.especialidad_predeterminada;
  }

  await ref.set(payload);
  return { id };
}

export type AdminUpdateAssetInput = {
  denominacion: string;
  codigo_legacy: string;
  ubicacion_tecnica: string;
  centro: string;
  clase: string;
  grupo_planificacion: string;
  especialidad_predeterminada?: EspecialidadActivo;
  activo_operativo: boolean;
};

/** Actualiza ficha (no cambia `codigo_nuevo` ni el id del documento). */
export async function adminUpdateAsset(assetId: string, input: AdminUpdateAssetInput): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection(ASSETS_COLLECTION).doc(assetId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new AppError("NOT_FOUND", "No existe un activo con ese id");
  }

  const payload: Record<string, unknown> = {
    denominacion: input.denominacion.trim(),
    ubicacion_tecnica: input.ubicacion_tecnica.trim(),
    centro: input.centro.trim(),
    activo_operativo: input.activo_operativo,
    updated_at: FieldValue.serverTimestamp(),
  };

  const legacy = input.codigo_legacy.trim();
  if (legacy) payload.codigo_legacy = legacy;
  else payload.codigo_legacy = FieldValue.delete();

  const clase = input.clase.trim();
  if (clase) payload.clase = clase;
  else payload.clase = FieldValue.delete();

  const grupo = input.grupo_planificacion.trim();
  if (grupo) payload.grupo_planificacion = grupo;
  else payload.grupo_planificacion = FieldValue.delete();

  if (input.especialidad_predeterminada) {
    payload.especialidad_predeterminada = input.especialidad_predeterminada;
  } else {
    payload.especialidad_predeterminada = FieldValue.delete();
  }

  await ref.update(payload);
}

export async function getAssetById(assetId: string): Promise<Asset | null> {
  const snap = await getAdminDb().collection(ASSETS_COLLECTION).doc(assetId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Omit<Asset, "id">;
  return { id: snap.id, ...data };
}
