import { AppError } from "@/lib/errors/app-error";
import { getAssetById } from "@/modules/assets/repository";

export async function requireAsset(assetId: string) {
  const asset = await getAssetById(assetId);
  if (!asset) {
    throw new AppError("NOT_FOUND", "Activo no encontrado", { details: { assetId } });
  }
  return asset;
}
