/**
 * Cloud Functions v2 — disparan los mismos endpoints que el resto del repo (`app/api/cron/*`).
 * La lógica sigue viviendo en Next; acá solo el schedule + HTTP interno.
 */
import { logger } from "firebase-functions";
import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

const cronSecret = defineSecret("CRON_SECRET");
/** URL base del sitio ya desplegado (sin barra final), ej. https://tu-dominio.web.app */
const cronTargetUrl = defineString("CRON_TARGET_URL", {
  default: "",
  description: "Base URL de la app Next (App Hosting) para GET /api/cron/...",
});

const REGION = "southamerica-east1";
const TZ = "America/Argentina/Buenos_Aires";

async function invokeCronPath(path: string): Promise<void> {
  const base = cronTargetUrl.value().trim().replace(/\/$/, "");
  if (!base) {
    logger.error("Configurá CRON_TARGET_URL (params / consola) con la URL pública de la app.", { path });
    throw new Error("CRON_TARGET_URL sin configurar");
  }
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const secret = cronSecret.value();
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const text = await res.text();
  if (!res.ok) {
    logger.error("Cron HTTP error", { path, status: res.status, body: text.slice(0, 800) });
    throw new Error(`Cron ${path} → HTTP ${res.status}`);
  }
  logger.info("Cron OK", { path, status: res.status, bodyPreview: text.slice(0, 300) });
}

/** Diario ~05:05 ART — antes del motor (recalcula vencimientos en avisos). */
export const scheduledActualizarVencimientos = onSchedule(
  {
    schedule: "5 5 * * *",
    timeZone: TZ,
    region: REGION,
    secrets: [cronSecret],
  },
  async () => {
    await invokeCronPath("/api/cron/actualizar-vencimientos");
  },
);

/** Diario 06:00 ART — alinea con `config_motor.hora_generacion_diaria` por defecto. */
export const scheduledMotorOtDiario = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: TZ,
    region: REGION,
    secrets: [cronSecret],
  },
  async () => {
    await invokeCronPath("/api/cron/motor-ot-diario");
  },
);
