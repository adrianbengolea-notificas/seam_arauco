/**
 * Resolución de activo por ubicación técnica SAP: variantes de prefijos (ESPE-ESP- vs ESP-),
 * mayúsculas y espacios; opcionalmente por codigo_nuevo.
 */
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

/** Genera claves equivalentes para comparar UTs SAP ↔ Firestore. */
export function sapUtMatchVariants(ut: string): string[] {
  const t = ut.trim();
  if (!t) return [];
  const variants = new Set<string>();
  const collapsed = t.replace(/\s+/g, " ");
  const up = collapsed.toUpperCase();
  variants.add(collapsed);
  variants.add(up);
  variants.add(collapsed.replace(/\s/g, ""));
  variants.add(up.replace(/\s/g, ""));

  // ESPE-ESP-REST ⇄ ESP-REST (caso típico correctivos / export SAP)
  const longPref = /^ESPE-ESP-(.+)$/i.exec(up);
  if (longPref?.[1]) {
    variants.add(`ESP-${longPref[1]}`);
  }

  const shortPref = /^ESP-(.+)$/i.exec(up);
  if (shortPref?.[1] && !up.startsWith("ESPE-")) {
    variants.add(`ESPE-ESP-${shortPref[1]}`);
  }

  return [...variants].filter(Boolean);
}

export function resolveAssetIdFromLookup(map: Map<string, string>, utRaw: string): string | undefined {
  for (const k of sapUtMatchVariants(utRaw)) {
    const id = map.get(k);
    if (id) return id;
  }
  return undefined;
}

/**
 * Mapa clave(canónica o variante) → asset id. Primera variante gana si hay colisión.
 */
export function buildUbicacionToAssetIdLookup(
  docs: QueryDocumentSnapshot[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of docs) {
    const ut = String(d.get("ubicacion_tecnica") ?? "").trim();
    const codigo = String(d.get("codigo_nuevo") ?? "").trim();
    const id = d.id;
    for (const source of [ut, codigo]) {
      if (!source) continue;
      for (const k of sapUtMatchVariants(source)) {
        if (!map.has(k)) map.set(k, id);
      }
    }
  }
  return map;
}
