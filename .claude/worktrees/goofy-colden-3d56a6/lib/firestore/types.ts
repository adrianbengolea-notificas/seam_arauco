import type { Timestamp } from "firebase/firestore";
import type { Rol } from "@/lib/permisos/index";

/**
 * Tipos de referencia para imports (seed) y documentación.
 * Los documentos reales en Firestore siguen los tipos canónicos:
 * - Activos: `modules/assets/types` → colección `assets`
 * - Equipos catálogo Excel: `equipos` (código nuevo como id)
 * - Avisos: `modules/notices/types` → colección `avisos`
 */

/** Fila lógica de Excel de equipos (antes de mapear a `Asset`). */
export type EquipoSeedRow = {
  codigo: string;
  codigoViejo: string;
  descripcion: string;
  ubicacionTecnica: string;
  especialidad: "AA" | "GG";
  centro: string;
};

/** Fila lógica de Excel de avisos preventivos. */
export type AvisoPreventivoSeedRow = {
  numero: string;
  descripcion: string;
  ubicacionTecnica: string;
  denomUbicTecnica: string;
  especialidadRaw: string;
  frecuencia: "M" | "T" | "S" | "A";
};

/** Subconjunto documental (ver `Aviso` en `modules/notices/types`). */
export type AvisoFirestoreShape = {
  id: string;
  n_aviso: string;
  asset_id: string;
  ubicacion_tecnica: string;
  centro: string;
  frecuencia: string;
  tipo: string;
  especialidad: string;
  texto_corto: string;
  texto_largo?: string;
  estado: string;
};

/** Documento `equipos/{codigo}` (seed Excel). */
export interface Equipo {
  id: string;
  codigo: string;
  codigoViejo: string;
  descripcion: string;
  ubicacionTecnica: string;
  denomUbicTecnica: string;
  especialidad: "A" | "GG";
  centro: string;
  createdAt: Timestamp;
}

/**
 * Vista orientada al prompt de diseño; en Firestore el aviso canónico es `modules/notices/types` (`n_aviso`, snake_case).
 */
export interface Aviso {
  id: string;
  numero: string;
  descripcion: string;
  ubicacionTecnica: string;
  denomUbicTecnica: string;
  especialidad: "A" | "E" | "GG" | "HG";
  tipo: "preventivo" | "correctivo";
  frecuencia?: "M" | "T" | "S" | "A";
  status: "PDTE" | "EN_CURSO" | "COMPLETADA" | "CANCELADA";
  centro?: string;
  ptoTrbRes?: string;
  fechaProgramada?: Timestamp;
  otId?: string;
  /** Trazabilidad / vencimientos (espejo conceptual de `modules/notices/types` Aviso). */
  ultimaEjecucionOtId?: string;
  ultimaEjecucionFecha?: Timestamp;
  proximoVencimiento?: Timestamp;
  diasParaVencimiento?: number;
  estadoVencimiento?: "ok" | "proximo" | "vencido";
  incluidoEnSemana?: string;
  createdAt: Timestamp;
}

// ─── Planillas digitales (templates + respuestas por OT) ─────────────────────

export type PlanillaTemplateEspecialidad = "A" | "E" | "GG" | "*";
export type PlanillaTemplateSubTipo = "preventivo" | "correctivo" | "*";

export type PlanillaSeccionTipo =
  | "checklist"
  | "libre"
  | "datos_equipo"
  | "grilla"
  | "datos_persona"
  | "estado_final";

export type ItemEstadoPlanilla = "BUENO" | "REGULAR" | "MALO" | "OK" | "FALLA" | "N/A";

export interface ItemTemplate {
  id: string;
  label: string;
  acciones?: string[];
  columnas?: string[];
  estadosDisponibles?: ItemEstadoPlanilla[];
  requiereObsEn?: ItemEstadoPlanilla[];
  obligatorio?: boolean;
}

export interface SeccionTemplate {
  id: string;
  titulo: string;
  tipo: PlanillaSeccionTipo;
  items?: ItemTemplate[];
  /** Columnas comunes para toda la grilla (p. ej. Elec). */
  grillaColumnas?: string[];
  etiquetaLibre?: string;
  obligatorio?: boolean;
  soloAdmin?: boolean;
  maxFilasPersona?: number;
}

export interface PlanillaTemplate {
  id: string;
  nombre: string;
  especialidad: PlanillaTemplateEspecialidad;
  subTipo: PlanillaTemplateSubTipo;
  secciones: SeccionTemplate[];
}

export interface ItemRespuesta {
  checklist?: boolean;
  servis?: boolean;
  estado?: "BUENO" | "REGULAR" | "MALO" | "N/A";
  verificada?: boolean;
  cantEnFalla?: number;
  operativas?: number;
  observacion?: string;
  accionSeleccionada?: string;
  /** Texto libre por ítem (p. ej. “Otros”). */
  comentario?: string;
}

export type PlanillaPersonaFila = {
  nombreApellido?: string;
  cargoCategoria?: string;
  observaciones?: string;
};

export type PlanillaRespuestaStatus = "borrador" | "completada" | "firmada";

export interface PlanillaRespuesta {
  id: string;
  templateId: string;
  otId: string;
  equipoCodigo?: string;
  datosEquipo?: {
    tipo?: string;
    marca?: string;
    modelo?: string;
    rendimiento?: "A" | "B" | "C" | "D";
    tipoGas?: string;
    frigorias?: string;
    potencia?: string;
    tipoPlaca?: "Original" | "Universal" | "C/Vistato";
    frioCalor?: boolean;
    frioSolo?: boolean;
    codigoEquipo?: string;
    serie_ext?: string;
    serie_int?: string;
  };
  frecuencia?: "M" | "T" | "S" | "A";
  intervencion?: "preventiva" | "correctiva";
  respuestas: Record<string, ItemRespuesta>;
  textoLibrePorSeccion?: Record<string, string>;
  actividadRealizada?: string;
  materialesTexto?: string;
  recomendaciones?: string;
  pedidoMateriales?: string;
  observacionesUsuario?: string;
  estadoFinal?: "BUENO" | "REGULAR" | "REPARAR";
  observacionesFinales?: string;
  controlCalidadSSGG?: string;
  filasPersonal?: PlanillaPersonaFila[];
  firmaUsuario?: string;
  firmaUsuarioNombre?: string;
  firmaUsuarioLegajo?: string;
  firmaUsuarioFecha?: Timestamp;
  firmaResponsable?: string;
  firmaResponsableNombre?: string;
  status: PlanillaRespuestaStatus;
  completadoPor: string;
  completadoAt?: Timestamp;
  creadoAt: Timestamp;
}

/** Comentario en `work_orders/{otId}/comentarios/{id}` */
export interface Comentario {
  id: string;
  otId: string;
  texto: string;
  autorId: string;
  autorNombre: string;
  autorRol: Rol;
  adjuntos?: string[];
  respondidoA?: string;
  /** Compat: lectura agregada; preferir `leidoPor`. */
  leido: boolean;
  /** Lectura por usuario (uid → visto). */
  leidoPor?: Record<string, boolean>;
  creadoAt: Timestamp;
}

export type NotificacionTipo =
  | "ot_urgente_abierta"
  | "ot_cerrada_firmada"
  | "material_externo_cargado"
  | "comentario_nuevo"
  | "comentario_respondido"
  | "stock_bajo"
  | "ot_asignada"
  | "ot_vencida"
  | "propuesta_disponible";

/** Ítem en `notificaciones/{uid}/items/{id}` */
export interface Notificacion {
  id: string;
  tipo: NotificacionTipo;
  titulo: string;
  cuerpo: string;
  leida: boolean;
  otId?: string;
  materialId?: string;
  creadoAt: Timestamp;
  pushEnviado: boolean;
}
