import type { Rol } from "@/lib/permisos/index";
import type { Timestamp } from "firebase/firestore";

/** Rol canónico (JWT / lógica de permisos). */
export type UserRol = Rol;

/** Incluye valor legado almacenado en Firestore antes de la migración. */
export type UserRole = UserRol | "super_admin";

/** Perfil extendido en Firestore: users/{uid} */
export type UserProfile = {
  email: string;
  display_name: string;
  rol: UserRole;
  centro: string;
  planta_codigo?: string;
  especialidades?: Array<"AA" | "ELECTRICO" | "GG">;
  activo: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type UserProfileInput = Omit<UserProfile, "created_at" | "updated_at">;
