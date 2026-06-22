export const CODIGO_EE_GRAL = "EE-GRAL";
export const CODIGO_AA_GRAL = "AA-GRAL";

export function syntheticEeAssetId(centro: string): string {
  return `ee-gral-${centro.trim().toLowerCase()}`;
}

export function syntheticAaAssetId(centro: string): string {
  return `aa-gral-${centro.trim().toLowerCase()}`;
}

export type EspCodeImport = "A" | "E" | "GG" | "HG";

/**
 * Resuelve `asset_id` al importar avisos.
 * - Eléctrico: siempre activo sintético del centro (nunca catálogo).
 * - Aire: activo sintético solo si la UT no matchea catálogo (correctivos sin unidad AA).
 */
export function assetIdImportDesdeEspecialidad(
  espCode: EspCodeImport,
  centro: string,
  assetIdFromLookup: string,
): string {
  if (espCode === "E") return syntheticEeAssetId(centro);
  if (espCode === "A" && !assetIdFromLookup.trim()) return syntheticAaAssetId(centro);
  return assetIdFromLookup;
}

export function esActivoSinteticoElectricoGeneral(codigoActivo: string, assetId: string): boolean {
  if (codigoActivo.trim().toUpperCase() === CODIGO_EE_GRAL) return true;
  return assetId.trim().toLowerCase().startsWith("ee-gral-");
}

export function esActivoSinteticoAireGeneral(codigoActivo: string, assetId: string): boolean {
  if (codigoActivo.trim().toUpperCase() === CODIGO_AA_GRAL) return true;
  return assetId.trim().toLowerCase().startsWith("aa-gral-");
}

/** Activo «cajón general» por disciplina — no debe dominar rankings del dashboard. */
export function esActivoSinteticoGeneral(codigoActivo: string, assetId: string): boolean {
  return (
    esActivoSinteticoElectricoGeneral(codigoActivo, assetId) ||
    esActivoSinteticoAireGeneral(codigoActivo, assetId)
  );
}
