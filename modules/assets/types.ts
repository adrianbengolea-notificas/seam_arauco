import type { Timestamp } from "firebase/firestore";

export type EspecialidadActivo = "AA" | "ELECTRICO" | "GG" | "HG";

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
  // Datos técnicos del equipo GG (se completan una vez y quedan en el activo)
  gg_motor_marca?: string;
  gg_motor_modelo?: string;
  gg_motor_serie?: string;
  gg_gen_marca?: string;
  gg_gen_modelo?: string;
  gg_gen_serie?: string;
  gg_gen_kva?: string;
  gg_combustible?: string;
};

export type AssetCreateInput = Omit<Asset, "id" | "created_at" | "updated_at">;
