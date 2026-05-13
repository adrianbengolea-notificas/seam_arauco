import { AppError } from "@/lib/errors/app-error";
import { getUserProfileByUid } from "@/modules/users/repository";
import { roleSatisfiesAllowed } from "@/modules/users/roles";
import type { UserProfile, UserRole } from "@/modules/users/types";

export async function assertUserCanAct(
  uid: string,
  roles: readonly UserRole[],
): Promise<UserProfile> {
  const profile = await getUserProfileByUid(uid);
  if (!profile || !profile.activo) {
    throw new AppError("FORBIDDEN", "Usuario inactivo o sin perfil");
  }
  if (!roleSatisfiesAllowed(profile.rol, roles)) {
    throw new AppError("FORBIDDEN", "Rol no autorizado para esta acción");
  }
  return profile;
}
