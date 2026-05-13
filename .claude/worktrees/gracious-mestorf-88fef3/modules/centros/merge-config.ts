import {
  TODAS_ESPECIALIDADES,
  type CentroConfigEffective,
  type CentroFirestoreDoc,
  type ConfigMotorFirestore,
} from "@/modules/centros/types";
import type { Especialidad } from "@/modules/notices/types";

const DEFAULT_CONFIG_MOTOR: ConfigMotorFirestore = {
  horas_por_dia: 8,
  dias_habiles: ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"],
  dias_antes_alerta_proximo: 30,
  max_ots_por_dia_aire: 6,
  max_ots_por_dia_electrico: 8,
  max_ots_por_dia_gg: 4,
  agrupar_por_localidad: true,
  incluir_correctivos_en_propuesta: true,
  hora_generacion_diaria: "06:00",
};

function mergeConfigMotor(partial?: Partial<ConfigMotorFirestore>): ConfigMotorFirestore {
  if (!partial || typeof partial !== "object") return { ...DEFAULT_CONFIG_MOTOR };
  return {
    ...DEFAULT_CONFIG_MOTOR,
    ...partial,
    dias_habiles:
      Array.isArray(partial.dias_habiles) && partial.dias_habiles.length > 0
        ? [...partial.dias_habiles]
        : [...DEFAULT_CONFIG_MOTOR.dias_habiles],
  };
}

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
  const config_motor = mergeConfigMotor(data?.config_motor as Partial<ConfigMotorFirestore> | undefined);
  const auto_publicar_propuesta = data?.auto_publicar_propuesta === true;
  return {
    modulos,
    especialidades_activas,
    requiere_firma_usuario_cierre,
    config_motor,
    auto_publicar_propuesta,
  };
}
