/** Misma URL base que `apphosting.yaml` → `NEXT_PUBLIC_APP_ORIGIN`. Solo si falta la env en build/SSR. */
const PRODUCTION_CANONICAL_ORIGIN_DEFAULT =
  "https://seam-arauco-web--seamarauco.us-east4.hosted.app";

function stripTrailingSlashes(s: string): string {
  return s.trim().replace(/\/+$/, "");
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Origen público de la app (sin barra final), para QR y enlaces absolutos.
 *
 * 1. `NEXT_PUBLIC_APP_ORIGIN` si está definida (recomendado: misma en App Hosting BUILD + RUNTIME).
 * 2. Cliente en **desarrollo**: `window.location.origin` (suele ser localhost).
 * 3. Cliente en **producción**: el host actual si no es loopback; si abrís un build prod en localhost,
 *    se usa `NEXT_PUBLIC_APP_ORIGIN_FALLBACK` o el dominio canónico por defecto (dominio custom: fijá la env).
 * 4. SSR en producción sin env: mismo fallback canónico para no emitir URL vacía.
 */
export function resolvePublicAppOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (fromEnv) return stripTrailingSlashes(fromEnv);

  const isProd = process.env.NODE_ENV === "production";
  const envFallback = process.env.NEXT_PUBLIC_APP_ORIGIN_FALLBACK?.trim();

  if (typeof window !== "undefined") {
    const live = stripTrailingSlashes(window.location.origin);
    if (!isProd) return live;
    if (!isLoopbackOrigin(live)) return live;
    return stripTrailingSlashes(envFallback || PRODUCTION_CANONICAL_ORIGIN_DEFAULT);
  }

  if (isProd) {
    return stripTrailingSlashes(envFallback || PRODUCTION_CANONICAL_ORIGIN_DEFAULT);
  }

  return "";
}

/** Centro por defecto para filtros en campo (configurar por planta). */
export const DEFAULT_CENTRO =
  process.env.NEXT_PUBLIC_DEFAULT_CENTRO?.trim() || "PC01";

/** Ítems de `NEXT_PUBLIC_KNOWN_CENTROS` separados por comas; cada uno se normaliza con `.trim()`. */
const fromEnvCentros = process.env.NEXT_PUBLIC_KNOWN_CENTROS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Dependencias / centros operativos listados en filtros (p. ej. dashboard).
 * Variable: `NEXT_PUBLIC_KNOWN_CENTROS` = lista separada por comas (ej. `PC01,PT01`).
 */
export const KNOWN_CENTROS: readonly string[] =
  fromEnvCentros?.length
    ? Array.from(new Set([DEFAULT_CENTRO, ...fromEnvCentros]))
    : [DEFAULT_CENTRO];

/**
 * Nombres de planta para la UI (sin código SAP).
 * Ajustá aquí o con `NEXT_PUBLIC_CENTRO_NOMBRES_JSON` (objeto JSON código → nombre).
 */
export const CENTRO_NOMBRES: Record<string, string> = {
  PC01: "Esperanza",
  PF01: "Predio Forestal",
  PM02: "Bossetti",
  PT01: "Piray",
};

/** Sobrescribe `CENTRO_NOMBRES` sin redeploy (App Hosting: misma env en BUILD y RUNTIME). JSON: {"PC01":"…"} */
function parseCentroNombresEnv(): Record<string, string> {
  const raw = process.env.NEXT_PUBLIC_CENTRO_NOMBRES_JSON?.trim();
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (typeof o !== "object" || o === null || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      const key = String(k).trim();
      if (key && typeof v === "string" && v.trim()) out[key] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

const CENTRO_NOMBRES_DESDE_ENV = parseCentroNombresEnv();

function nombreCentroPorClaveExacta(map: Record<string, string>, key: string): string | undefined {
  const v = map[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Resuelve nombre mostrable; prueba clave exacta y luego sin distinguir mayúsculas (p. ej. env vs datos). */
export function nombreCentro(centro: string): string {
  const t = centro.trim();
  if (!t) return "";
  const exactEnv = nombreCentroPorClaveExacta(CENTRO_NOMBRES_DESDE_ENV, t);
  if (exactEnv) return exactEnv;
  const exactStatic = nombreCentroPorClaveExacta(CENTRO_NOMBRES, t);
  if (exactStatic) return exactStatic;
  const lower = t.toLowerCase();
  for (const [k, v] of Object.entries(CENTRO_NOMBRES_DESDE_ENV)) {
    if (k.trim().toLowerCase() === lower) {
      const n = typeof v === "string" && v.trim() ? v.trim() : undefined;
      if (n) return n;
    }
  }
  for (const [k, v] of Object.entries(CENTRO_NOMBRES)) {
    if (k.trim().toLowerCase() === lower) {
      const n = typeof v === "string" && v.trim() ? v.trim() : undefined;
      if (n) return n;
    }
  }
  return t;
}

/**
 * Indica si un código de centro (p. ej. de un aviso importado) está en la lista conocida.
 * Usa `.trim()` en ambos lados para evitar desajustes por espacios.
 */
export function isCentroInKnownList(centro: string): boolean {
  const t = centro.trim();
  if (!t) return false;
  return KNOWN_CENTROS.some((k) => k.trim() === t);
}

/**
 * Valor del query `?centro=` para ver el programa publicado de todas las plantas a la vez (solo superadmin).
 * No es un código de centro operativo en Firestore.
 */
export const CENTRO_SELECTOR_TODAS_PLANTAS = "todas";

/**
 * Correo sugerido en la pantalla de login (dueño / cuenta principal).
 * Debe existir en Firebase Authentication con ese mismo email.
 */
export const DEFAULT_LOGIN_EMAIL =
  process.env.NEXT_PUBLIC_DEFAULT_LOGIN_EMAIL?.trim() ?? "";

/**
 * Si es `true` (por defecto), en el detalle de OT el alta de materiales es solo texto libre
 * (sin sugerencias de catálogo ni mensaje de IA). Desactivar con `NEXT_PUBLIC_MATERIALES_SOLO_TEXTO_LIBRE=0`.
 */
export const MATERIALES_UI_SOLO_TEXTO_LIBRE =
  process.env.NEXT_PUBLIC_MATERIALES_SOLO_TEXTO_LIBRE?.trim() !== "0";

/**
 * Vista «Editar esta semana» (agendar OTs en `weekly_schedule` + tabla de órdenes agendadas).
 * Desactivada: el plan se edita en Programa publicado (grilla). Pasar a `true` para rehabilitar.
 */
export const PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA = false;
