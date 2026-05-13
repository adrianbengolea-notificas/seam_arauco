/** Límites compartidos importación / payloads (evitar literales mágicos dispersos). */

/** Máximo tamaño de Excel enviado desde el cliente (base64 o FormData). */
export const MAX_EXCEL_IMPORT_BYTES = 20 * 1024 * 1024;

/** Tope de strings en `propuestas_semana.advertencias` para no crecer el documento sin límite. */
export const MOTOR_PROPUESTA_MAX_ADVERTENCIAS = 200;

/** Si la propuesta sigue pendiente y nadie abrió la pantalla de aprobación, mostrar alerta (horas desde `generada_en`). */
export const HORAS_ALERTA_PROPUESTA_SIN_VISTA = 48;
