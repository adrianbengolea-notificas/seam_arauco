import type { OtPropuestaFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import type { ConfigMotorFirestore } from "@/modules/centros/types";

export type HistorialAjustesMotor = {
  semana: string;
  ajustes: unknown[];
};

const REFINAR_IA_TIMEOUT_MS = 15_000;

/**
 * Refinamiento IA (Genkit) — desactivado hasta tener historial real de aprobaciones.
 * Devuelve la propuesta greedy sin cambios.
 * Cuando se active la llamada real, un timeout evita bloquear el motor si la IA falla o tarda.
 */
export async function refinarPropuestaOtsConIa(input: {
  centro: string;
  semana: string;
  items: OtPropuestaFirestore[];
  historialAjustes: HistorialAjustesMotor[];
  configCentro: ConfigMotorFirestore;
  advertenciasMotor: string[];
}): Promise<{
  items: OtPropuestaFirestore[];
  cambiosRespectoMotor: string[];
  nuevasAdvertencias: string[];
}> {
  void input.historialAjustes;
  void input.configCentro;
  void input.centro;
  void input.semana;

  async function ejecutarRefinamiento(): Promise<{
    items: OtPropuestaFirestore[];
    cambiosRespectoMotor: string[];
    nuevasAdvertencias: string[];
  }> {
    // Aquí irá la integración real (p. ej. Genkit). Mientras tanto: passthrough.
    return {
      items: input.items,
      cambiosRespectoMotor: [],
      nuevasAdvertencias: [],
    };
  }

  try {
    return await Promise.race([
      ejecutarRefinamiento(),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => {
          clearTimeout(t);
          reject(new Error("motor_ia_refinar_timeout"));
        }, REFINAR_IA_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[motor] refinamiento IA omitido:", msg);
    return {
      items: input.items,
      cambiosRespectoMotor: [],
      nuevasAdvertencias: [`Refinamiento IA no disponible (fallback a propuesta base): ${msg}`],
    };
  }
}
