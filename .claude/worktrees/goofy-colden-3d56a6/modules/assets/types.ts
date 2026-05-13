import type { Timestamp } from "firebase/firestore";

export type EspecialidadActivo = "AA" | "ELECTRICO" | "GG";

/** Activo industrial — colección `assets` */
export type Asset = {
  id: string;
  codigo_nuevo: string;
  codigo_legacy?: string;
  denominacion: string;
  ubicacion_tecnica: string;
  centro: string;
  clase?: string;
  grupo_planificacion?: string;
  especialidad_predeterminada?: EspecialidadActivo;
  activo_operativo: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type AssetCreateInput = Omit<Asset, "id" | "created_at" | "updated_at">;
