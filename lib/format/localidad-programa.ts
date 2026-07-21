import { CENTRO_SELECTOR_TODAS_PLANTAS, KNOWN_CENTROS } from "@/lib/config/app-config";
import { isEspecialidadElectrica, isUtPrefijoBoss } from "@/lib/firestore/derive-centro";

/**
 * Etiqueta legible para filas de localidad en el programa semanal cuando solo hay código SAP/path.
 * Toma las últimas 2–3 partes y aplica expansiones mínimas (p. ej. LABORA → Laboratorio).
 */

const SEGMENTO_LEGIBLE: Record<string, string> = {
  // Sitios / plantas Arauco
  ESPE: "Esperanza",
  ESP: "Esperanza",
  BOSS: "Bossetti",
  BOS: "Bossetti",
  GARI: "Garita",
  GAR: "Garita",
  PIRA: "Piray",
  PIR: "Piray",
  YPOR: "Yporá",
  YPO: "Yporá",
  // Zonas dentro de sitio
  CEL: "Celulosa",
  GOF: "Oficina Central",
  HOT: "Hotel",
  BVR: "Barrio",
  MDF: "MDF",
  RUT: "Ruta",
  CLU: "Club",
  ESB: "Barrio",
  ELD: "El Dorado",
  // Sectores
  ADMIN1: "Administración 1",
  ADMIN2: "Administración 2",
  ADM1: "Administración 1",
  LABORA: "Laboratorio",
  LABORATORIO: "Laboratorio",
  OFICINA: "Oficina",
  TALLER: "Taller",
  PLANTA: "Planta",
  ALMACEN: "Almacén",
  ALMACÉN: "Almacén",
  COMEDO: "Comedor",
  COMEDOR: "Comedor",
  VIGILA: "Vigilancia",
  FOREST: "Forestal",
  LOGIST: "Logística",
  SISTEM: "Sistemas",
  BALANZ: "Balanza",
  VIVERO: "Vivero",
  ENFERMER: "Enfermería",
  EXPEDI: "Expedición",
  PROTPA: "Protección Patrimonial",
  CASACU: "Casa Cuadrilla",
  CHALET: "Chalet",
  PILETA: "Pileta",
  PORTER: "Portería",
  BOMBER: "Bomberos",
};

function tituloSegmentoPalabras(s: string): string {
  const t = s.replace(/_/g, " ").trim();
  if (!t) return s;
  return t
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function humanizarSegmento(seg: string): string {
  const raw = seg.trim();
  if (!raw) return raw;
  const up = raw.toUpperCase();

  if (SEGMENTO_LEGIBLE[up]) return SEGMENTO_LEGIBLE[up];

  const ofic = /^OFIC(?:0*)(\d+)$/i.exec(raw);
  if (ofic) return `Oficina ${parseInt(ofic[1]!, 10)}`;

  const sala = /^SALA(?:0*)(\d+)$/i.exec(raw);
  if (sala) return `Sala ${parseInt(sala[1]!, 10)}`;

  if (/^[A-Z0-9Ñ]+$/i.test(raw) && raw.length <= 4) return raw.toUpperCase();

  return tituloSegmentoPalabras(raw.toLowerCase());
}

function partesCodigoLocalidad(raw: string): string[] {
  return raw
    .split(/[-/]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Cuántas partes finales tomar del path (2–3) según la longitud total.
 */
function cantidadPartesFinales(n: number): number {
  if (n <= 0) return 0;
  if (n <= 3) return n;
  if (n >= 6) return 2;
  return 3;
}

export function formatearCodigoLocalidadSap(codigo: string): string {
  const t = codigo.trim();
  if (!t || t === "—") return "—";
  const parts = partesCodigoLocalidad(t);
  if (parts.length === 0) return t;

  // La primera parte es siempre el sitio (ESPE, BOSS, PIRA, YPOR, GARI).
  // Si se puede humanizar, lo mostramos como prefijo para que el operador sepa
  // de qué planta es aunque el path sea largo.
  const sitio = humanizarSegmento(parts[0]!);
  const sitioCambiado = sitio !== parts[0]!.toUpperCase();

  const take = cantidadPartesFinales(parts.length);
  // Tomamos las últimas partes pero nunca el segmento 1 (abreviatura del sitio, ej. ESP)
  const slice = parts.slice(-take).filter((p) => {
    const up = p.toUpperCase();
    // Excluir el duplicado abreviado del sitio (ej. ESP cuando ya pusimos Esperanza)
    const esDuplicadoSitio = sitioCambiado && (
      up === "ESP" || up === "BOS" || up === "PIR" || up === "YPO" || up === "GAR"
    );
    return !esDuplicadoSitio;
  });

  const resto = slice.map(humanizarSegmento);

  // Si el sitio ya aparece en las últimas partes (paths cortos), no repetirlo
  if (sitioCambiado && !resto.includes(sitio)) {
    return [sitio, ...resto].join(" · ");
  }
  return resto.join(" · ");
}

export function etiquetaLocalidadSlot(
  localidadRaw: string,
  denomUbicTecnica?: string | null,
): string {
  const denom = denomUbicTecnica?.trim();
  if (denom) return denom;
  return formatearCodigoLocalidadSap(localidadRaw);
}

function centroDesdeProgramaDocId(programaDocId: string): string | null {
  const id = programaDocId.trim();
  if (!id) return null;
  const sorted = [...KNOWN_CENTROS].sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    if (id.startsWith(`${c}_`)) return c;
  }
  return null;
}

function parsePrefijoCentroEnLocalidadFusion(localidadGrid: string): { centro: string | null; resto: string } {
  const t = localidadGrid.trim();
  const sorted = [...KNOWN_CENTROS].sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    const prefix = `${c} · `;
    if (t.startsWith(prefix)) {
      return { centro: c.toUpperCase(), resto: t.slice(prefix.length).trim() };
    }
  }
  return { centro: null, resto: t };
}

/**
 * Ubicación técnica para export (Excel): segmentos SAP en mayúsculas, sin denominación legible.
 * Misma heurística de recorte que la grilla, pero sin expandir CEL → Celulosa, etc.
 */
export function formatearUbicacionTecnicaExport(codigo: string): string {
  const t = codigo.trim();
  if (!t || t === "—") return "—";
  const parts = partesCodigoLocalidad(t);
  if (parts.length === 0) return t.toUpperCase();

  const take = cantidadPartesFinales(parts.length);
  const slice = parts.slice(-take);
  return slice.map((p) => p.toUpperCase()).join(" · ");
}

type SlotLocalidadExport = {
  localidad: string;
  localidadDocPrograma?: string;
  programaOrigenDocId?: string;
};

/**
 * Columna «Localidad» del Excel del programa: SECO en mayúsculas (fusión multi-planta) + códigos UT.
 * No usa `denomUbicTecnica` (descripción SAP). Si falta UT, devuelve solo el SECO.
 *
 * Para UT Bossetti (`BOSS-*`): si el SECO del programa/fusión sería PF01 (Predio Forestal)
 * pero la fila es eléctrica, se muestra PM02 (planta Bossetti) — misma regla operativa
 * que `resolveCentroForAviso` con especialidad ELECTRICO.
 */
export function etiquetaLocalidadExport(
  slot: SlotLocalidadExport & { especialidad?: string | null },
  centroPrograma?: string | null,
): string {
  const locGrid = slot.localidad?.trim() || "—";
  const { centro: centroFusion, resto } = parsePrefijoCentroEnLocalidadFusion(locGrid);
  const utRaw = slot.localidadDocPrograma?.trim() || resto;

  let centro = centroFusion;
  if (!centro && slot.programaOrigenDocId?.trim()) {
    centro = centroDesdeProgramaDocId(slot.programaOrigenDocId)?.toUpperCase() ?? null;
  }
  if (!centro) {
    const cp = centroPrograma?.trim();
    if (cp && cp !== CENTRO_SELECTOR_TODAS_PLANTAS) {
      centro = cp.toUpperCase();
    }
  }

  const utFmt = formatearUbicacionTecnicaExport(utRaw);
  const esFusion = Boolean(centroFusion || slot.programaOrigenDocId?.trim());
  let seco = centroFusion ?? centro;

  const utParaRegla = slot.localidadDocPrograma?.trim() || locGrid;
  if (seco === "PF01" && isUtPrefijoBoss(utParaRegla) && isEspecialidadElectrica(slot.especialidad)) {
    seco = "PM02";
  }

  if (utFmt && utFmt !== "—") {
    return esFusion && seco ? `${seco} · ${utFmt}` : utFmt;
  }
  return seco ?? "—";
}
