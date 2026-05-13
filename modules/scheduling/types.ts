import type { Timestamp } from "firebase/firestore";
import type { Especialidad } from "@/modules/notices/types";

/** Días publicados en la grilla del programa (Lun–Dom). */
export type DiaSemanaPrograma =
  | "lunes"
  | "martes"
  | "miercoles"
  | "jueves"
  | "viernes"
  | "sabado"
  | "domingo";

export type EspecialidadPrograma = "Aire" | "Electrico" | "GG";

export type AvisoSlot = {
  numero: string;
  descripcion: string;
  tipo: "preventivo" | "correctivo";
  urgente: boolean;
  equipoCodigo?: string;
  /** Ubicación técnica / local (opcional en Firestore). */
  ubicacion?: string;
  /** Id documento `avisos` / plan (preventivos desde propuesta). Solo servidor / generación de OTs. */
  avisoFirestoreId?: string;
  /** OT existente (correctivos en propuesta). */
  workOrderId?: string;
  /** Hay OT anterior del mismo mantenimiento sin cerrar (SAP emitió aviso nuevo). */
  ordenPreviaPendiente?: boolean;
};

export type SlotSemanal = {
  localidad: string;
  /** Si el slot viene de una fusión multi-planta, documento `programa_semanal` de origen (arrastre / panel). */
  programaOrigenDocId?: string;
  /** Denominación legible de ubicación (p. ej. desde plan/import); si falta, la UI formatea `localidad`. */
  denomUbicTecnica?: string;
  especialidad: EspecialidadPrograma;
  dia: DiaSemanaPrograma;
  fecha: Timestamp;
  avisos: AvisoSlot[];
  notas?: string;
  tecnicoSugeridoUid?: string;
  tecnicoSugeridoNombre?: string;
};

export type ProgramaSemanaStatus = "borrador" | "publicado" | "con_ots" | "cerrada";

/** Documento raíz en `programa_semanal/{id}` (id típico `centro_YYYY-Www`, alineado con `propuestas_semana`). */
export type ProgramaSemana = {
  id: string;
  semanaLabel: string;
  fechaInicio: Timestamp;
  fechaFin: Timestamp;
  centro: string;
  slots: SlotSemanal[];
  createdAt: Timestamp;
  status?: ProgramaSemanaStatus;
  propuestaOrigenId?: string;
  generadoAutomaticamente?: boolean;
  aprobadoAutomaticamente?: boolean;
  updated_at?: Timestamp;
};

/** Programa semanal — documentos en `weekly_schedule` (id = YYYY-Www, ej. 2026-W14) */
export type WeeklyScheduleBucket = {
  id: string;
  semana_iso: string;
  centro: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type WeeklyScheduleSlot = {
  id: string;
  centro: string;
  work_order_id: string;
  /** Copia de `n_ot` al agendar (lectura rápida en listas). */
  n_ot_snapshot?: string;
  asset_id: string;
  ubicacion_tecnica: string;
  especialidad: Especialidad;
  dia_semana: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  turno?: "A" | "B" | "C";
  orden_en_dia: number;
  created_at: Timestamp;
};

/** Entrada de plan por texto (p. ej. importada de Excel o carga manual). `weekly_schedule/{weekId}/plan_rows`. */
export type WeeklyPlanRow = {
  id: string;
  centro: string;
  dia_semana: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  localidad: string;
  especialidad: string;
  texto: string;
  orden: number;
  created_at: Timestamp;
  updated_at?: Timestamp;
};
