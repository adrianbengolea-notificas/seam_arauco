import type { OtPropuestaFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import type { ConfigMotorFirestore } from "@/modules/centros/types";

export type HistorialAjustesMotor = {
  semana: string;
  ajustes: unknown[];
};

/**
 * Refinamiento IA (Genkit) — desactivado hasta tener historial real de aprobaciones.
 * Devuelve la propuesta greedy sin cambios.
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
  return {
    items: input.items,
    cambiosRespectoMotor: [],
    nuevasAdvertencias: [],
  };
}
