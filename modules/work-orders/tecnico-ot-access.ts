import type { WorkOrder } from "@/modules/work-orders/types";

/** Alineado con Firestore `tecnicoPuedeLeerOt`: propias o pool sin asignar en alguno de los centros del usuario. */
export function tecnicoPuedeVerOtEnCentro(wo: WorkOrder, uid: string, centrosUsuario: string[]): boolean {
  if (!centrosUsuario.includes(wo.centro)) return false;
  if (wo.tecnico_asignado_uid === uid) return true;
  const t = wo.tecnico_asignado_uid;
  return t === null || t === undefined || t === "";
}
