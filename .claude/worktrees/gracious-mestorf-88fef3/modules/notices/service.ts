import { AppError } from "@/lib/errors/app-error";
import { getAvisoById } from "@/modules/notices/repository";

export async function requireAviso(avisoId: string) {
  const aviso = await getAvisoById(avisoId);
  if (!aviso) {
    throw new AppError("NOT_FOUND", "Aviso no encontrado", { details: { avisoId } });
  }
  if (aviso.estado === "ANULADO") {
    throw new AppError("CONFLICT", "Aviso anulado");
  }
  return aviso;
}
