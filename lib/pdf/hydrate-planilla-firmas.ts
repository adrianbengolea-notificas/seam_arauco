import type { PlanillaRespuesta } from "@/lib/firestore/types";

async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    if (!ct.startsWith("image/")) return null;
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Convierte firmas almacenadas como URL de Storage en data URLs para @react-pdf/renderer
 * (evita fallos de fetch remoto en el renderizador).
 */
export async function hydratePlanillaFirmasForPdf(resp: PlanillaRespuesta): Promise<PlanillaRespuesta> {
  const out: PlanillaRespuesta = { ...resp };

  const uUrl = resp.firmaUsuarioDownloadUrl?.trim();
  if (uUrl && /^https?:\/\//i.test(uUrl) && !out.firmaUsuario?.trim()) {
    const data = await urlToDataUrl(uUrl);
    if (data) out.firmaUsuario = data;
  }
  // planillaFirmaUsuarioSrc prioritizes firmaUsuarioDownloadUrl; clear it so the
  // data URL in firmaUsuario is used by react-pdf (storage URLs may be expired or
  // unreachable server-side)
  if (out.firmaUsuario?.trim()) out.firmaUsuarioDownloadUrl = "";

  const rUrl = resp.firmaResponsableDownloadUrl?.trim();
  if (rUrl && /^https?:\/\//i.test(rUrl) && !out.firmaResponsable?.trim()) {
    const data = await urlToDataUrl(rUrl);
    if (data) out.firmaResponsable = data;
  }
  if (out.firmaResponsable?.trim()) out.firmaResponsableDownloadUrl = "";

  return out;
}
