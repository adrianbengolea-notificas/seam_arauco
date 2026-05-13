/**
 * ID determinista del activo sintético Eléctrico General por centro (ej. ee-gral-pc01).
 * En un archivo aparte para poder importarlo desde otros scripts sin ejecutar `seed-activos-ee-sinteticos`.
 */
export function syntheticEeAssetId(centro: string): string {
  return `ee-gral-${centro.toLowerCase()}`;
}
