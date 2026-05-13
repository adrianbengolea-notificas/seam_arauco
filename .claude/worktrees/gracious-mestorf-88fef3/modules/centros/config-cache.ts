import { mergeCentroConfig } from "@/modules/centros/merge-config";
import type { CentroConfigEffective } from "@/modules/centros/types";
import { getCentroDocAdmin } from "@/modules/centros/repository";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; config: CentroConfigEffective }>();

/**
 * Config efectiva del centro con caché en memoria (~60s) para no consultar Firestore en cada server action.
 */
export async function getCentroConfigMergedCached(centroId: string): Promise<CentroConfigEffective> {
  const id = centroId.trim() || "__default__";
  const now = Date.now();
  const hit = cache.get(id);
  if (hit && now - hit.at < TTL_MS) {
    return hit.config;
  }
  const raw = id === "__default__" ? null : await getCentroDocAdmin(id);
  const config = mergeCentroConfig(raw ?? undefined);
  cache.set(id, { at: now, config });
  return config;
}
