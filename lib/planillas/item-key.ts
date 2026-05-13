export function planillaItemKey(seccionId: string, itemId: string): string {
  return `${seccionId}::${itemId}`;
}

export function parsePlanillaItemKey(key: string): { seccionId: string; itemId: string } | null {
  const i = key.indexOf("::");
  if (i <= 0) return null;
  return { seccionId: key.slice(0, i), itemId: key.slice(i + 2) };
}
