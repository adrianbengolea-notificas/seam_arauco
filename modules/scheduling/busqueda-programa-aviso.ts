import type { AvisoSlot, EspecialidadPrograma } from "@/modules/scheduling/types";

export type ContextoBusquedaAvisoPrograma = {
  localidad?: string;
  denomUbicTecnica?: string;
  especialidad?: EspecialidadPrograma;
};

export function textoBusquedaAvisoEnPrograma(a: AvisoSlot, ctx?: ContextoBusquedaAvisoPrograma): string {
  const esp =
    ctx?.especialidad === "Electrico"
      ? "electrico eléctrico"
      : ctx?.especialidad === "Aire"
        ? "aire"
        : ctx?.especialidad === "GG"
          ? "gg"
          : ctx?.especialidad === "HG"
            ? "hg hidrogrua hidrogrúa"
            : "";
  return [
    a.numero,
    a.descripcion,
    a.equipoCodigo,
    a.ubicacion,
    ctx?.localidad,
    ctx?.denomUbicTecnica,
    esp,
  ]
    .filter((x) => typeof x === "string" && x.trim())
    .join(" ")
    .toLowerCase();
}

export function avisoPasaBusqueda(a: AvisoSlot, busqueda: string, ctx?: ContextoBusquedaAvisoPrograma): boolean {
  const q = busqueda.trim().toLowerCase();
  if (!q) return true;
  if (textoBusquedaAvisoEnPrograma(a, ctx).includes(q)) return true;
  const qNum = q.replace(/\s/g, "");
  const num = a.numero.replace(/\s/g, "").toLowerCase();
  return Boolean(qNum && num.includes(qNum));
}

/** Mínimo de caracteres para disparar búsqueda transversal (números de aviso permiten menos). */
export function busquedaProgramaListaParaCrossWeek(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (/^\d+$/.test(q)) return q.length >= 1;
  return q.length >= 2;
}
