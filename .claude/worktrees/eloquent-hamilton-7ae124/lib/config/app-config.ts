/** Centro por defecto para filtros en campo (configurar por planta). */
export const DEFAULT_CENTRO =
               process.env.NEXT_PUBLIC_DEFAULT_CENTRO ?? "CENTRO-01";

const fromEnvCentros = process.env.NEXT_PUBLIC_KNOWN_CENTROS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Dependencias / centros operativos listados en filtros (p. ej. dashboard).
 * Ampliar con `NEXT_PUBLIC_KNOWN_CENTROS=CENTRO-01,CENTRO-02` cuando existan más.
 */
export const KNOWN_CENTROS: readonly string[] =
  fromEnvCentros?.length
    ? Array.from(new Set([DEFAULT_CENTRO, ...fromEnvCentros]))
    : [DEFAULT_CENTRO];

/**
 * Correo sugerido en la pantalla de login (dueño / cuenta principal).
 * Debe existir en Firebase Authentication con ese mismo email.
 */
export const DEFAULT_LOGIN_EMAIL =
  process.env.NEXT_PUBLIC_DEFAULT_LOGIN_EMAIL?.trim() ?? "";
