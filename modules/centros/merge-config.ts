import {
  TODAS_ESPECIALIDADES,
  type CentroConfigEffective,
  type CentroFirestoreDoc,
} from "@/modules/centros/types";
import type { Especialidad } from "@/modules/notices/types";

export function mergeCentroConfig(raw: CentroFirestoreDoc | Record<string, unknown> | undefined): CentroConfigEffective {
  const data = raw as CentroFirestoreDoc | undefined;
  const modulos: CentroConfigEffective["modulos"] = {
    materiales: data?.modulos?.materiales !== false,
    activos: data?.modulos?.activos !== false,
    ia: data?.modulos?.ia !== false,
  };
  let especialidades_activas: Especialidad[] = [...TODAS_ESPECIALIDADES];
  if (Array.isArray(data?.especialidades_activas) && data.especialidades_activas.length > 0) {
    const set = new Set(data.especialidades_activas as Especialidad[]);
    especialidades_activas = TODAS_ESPECIALIDADES.filter((e) => set.has(e));
    if (especialidades_activas.length === 0) {
      especialidades_activas = [...TODAS_ESPECIALIDADES];
    }
  }
  const requiere_firma_usuario_cierre = data?.requiere_firma_usuario_cierre !== false;
  return { modulos, especialidades_activas, requiere_firma_usuario_cierre };
}
