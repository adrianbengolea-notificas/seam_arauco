/**
 * Carga las definiciones de planillas en `planilla_templates/`.
 *
 *   npm run seed:templates
 */

import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ItemEstadoPlanilla, PlanillaTemplate } from "@/lib/firestore/types";

const ggMotor = [
  { id: "m_aceite", label: "Aceite del motor", acciones: ["Verificar nivel", "Cambiar"] },
  { id: "m_filtro_aceite", label: "Filtro de aceite de motor", acciones: ["Reemplazar"] },
  { id: "m_filtro_aire", label: "Filtro de Aire", acciones: ["Verificar", "Limpiar", "Cambiar"] },
  { id: "m_bateria", label: "Batería", acciones: ["Verificar", "Prueba de carga y descarga"] },
  { id: "m_bujias", label: "Bujías", acciones: ["Comprobar", "Ajustar", "Reemplazar"] },
  { id: "m_deposito", label: "Depósito de combustible", acciones: ["Limpiar"] },
  { id: "m_filtro_comb", label: "Filtro de combustible", acciones: ["Cambiar"] },
  { id: "m_correas", label: "Correas", acciones: ["Verificar", "Cambiar"] },
  { id: "m_refrigerante", label: "Líquido refrigerante", acciones: ["Verificar"] },
  { id: "m_func_motor", label: "Funcionamiento del motor", acciones: ["Prueba"] },
  { id: "m_arranque", label: "Sistema de arranque y parada", acciones: ["Verificar"] },
  { id: "m_limp_ext", label: "Limpieza exterior" },
];

const ggGen = [
  { id: "g_ext", label: "Exterior", acciones: ["Limpiar"] },
  { id: "g_transfer", label: "Transferencia automática", acciones: ["Verificar"] },
  { id: "g_bornes", label: "Bornes y terminales", acciones: ["Verificar"] },
  { id: "g_vent", label: "Ventilación y calentamiento", acciones: ["Verificar"] },
  { id: "g_ruidos", label: "Ruidos anormales y vibraciones", acciones: ["Verificar"] },
  { id: "g_cojinetes", label: "Cojinetes", acciones: ["Verificar"] },
  { id: "g_cargas", label: "Cargas con equipos de medición", acciones: ["Verificar"] },
  { id: "g_estado", label: "Estado general del generador", acciones: ["Verificar"] },
  { id: "g_escobillas", label: "Colector escobillas", acciones: ["Verificar"] },
  { id: "g_limp_int", label: "Limpieza interior", acciones: ["Verificar"] },
  { id: "g_hierro", label: "Entre hierro y devanados", acciones: ["Verificar"] },
  { id: "g_aislacion", label: "Aislación y puesta a tierra", acciones: ["Verificar"] },
  { id: "g_equilibrio", label: "Equilibrio del rotor", acciones: ["Verificar"] },
];

const elecItems = [
  "Verificación de protecciones (tablero principal, secundarios, térmicas, disyuntor y guardamotor)",
  "Verificación de conexión de puesta a tierra",
  "Verificación de sobrecarga en circuitos principales",
  "Verificación de desbalance eléctrico",
  "Verificación de terminales flojos",
  "Circuitos de iluminación de sectores",
  "Bomba de agua",
  "Tomas corrientes",
  "Módulo punto",
  "Fotocontrol",
  "Contactores",
  "Protección térmico (ajuste de protecciones según consumo)",
  "Interruptor diferencial",
  "Encendido automático",
  "Tablero de transferencia",
  "Otros (describir)",
  "Otros (describir)",
].map((label, i) => ({
  id: `e_${i + 1}`,
  label,
  obligatorio: i < 15,
}));

const aaActividades = [
  "Comprobar funcionamiento general del equipo",
  "Limpieza de evaporador",
  "Limpieza de condensador",
  "Limpieza filtros de aire",
  "Limpieza general del equipo",
  "Lubricación de motor de ventilador",
  "Control de vibraciones, inspeccionar soportes antivibratorios",
  "Ajuste de paletas o turbinas",
  "Control de fuga de gas, corrección",
  "Chequeo de presión de gas, ajuste de carga",
  "Medición de temperaturas",
  "Medición de corriente consumida",
  "Verificación de cuadro de mando eléctrico",
  "Chequeo de funcionamiento de todas las partes",
  "Verificar presión de alta (en caso de alta temp. de descarga)",
  "Verificar presión de baja (en caso de sobrecalentamiento de retorno)",
].map((label, i) => ({
  id: `aa_${i + 1}`,
  label,
  estadosDisponibles: ["BUENO", "REGULAR", "MALO"] as ItemEstadoPlanilla[],
  requiereObsEn: ["REGULAR", "MALO"] as ItemEstadoPlanilla[],
  obligatorio: true,
}));

const templates: PlanillaTemplate[] = [
  {
    id: "GG",
    nombre: "Planilla GG — Grupos generadores",
    especialidad: "GG",
    subTipo: "*",
    secciones: [
      {
        id: "gg_datos",
        titulo: "Datos del equipo / intervención",
        tipo: "datos_equipo",
        obligatorio: false,
      },
      {
        id: "gg_motor",
        titulo: "Motor",
        tipo: "checklist",
        items: ggMotor.map((r) => ({ ...r, obligatorio: true })),
      },
      {
        id: "gg_generador",
        titulo: "Generador y tableros TTA",
        tipo: "checklist",
        items: ggGen.map((r) => ({ ...r, obligatorio: true })),
      },
      {
        id: "gg_obs",
        titulo: "Observaciones",
        tipo: "libre",
        obligatorio: false,
        etiquetaLibre: "Observaciones generales",
      },
    ],
  },
  {
    id: "ELEC",
    nombre: "Planilla eléctrica preventiva",
    especialidad: "E",
    subTipo: "preventivo",
    secciones: [
      {
        id: "elec_grilla",
        titulo: "Verificaciones",
        tipo: "grilla",
        grillaColumnas: ["Verificada", "Cant. en falla", "Operativas", "Comentarios"],
        items: elecItems,
      },
      {
        id: "elec_rec",
        titulo: "Recomendaciones",
        tipo: "libre",
        obligatorio: false,
      },
      {
        id: "elec_pedido",
        titulo: "Pedido de materiales",
        tipo: "libre",
        obligatorio: false,
      },
    ],
  },
  {
    id: "AA",
    nombre: "Planilla AA — Aire acondicionado",
    especialidad: "A",
    subTipo: "preventivo",
    secciones: [
      {
        id: "aa_datos",
        titulo: "Datos del equipo",
        tipo: "datos_equipo",
        obligatorio: false,
      },
      {
        id: "aa_act",
        titulo: "Actividades",
        tipo: "checklist",
        items: aaActividades,
      },
      {
        id: "aa_estado_final",
        titulo: "Estado final del equipo",
        tipo: "estado_final",
      },
      {
        id: "aa_obs",
        titulo: "Observaciones",
        tipo: "libre",
        obligatorio: false,
      },
    ],
  },
  {
    id: "CORRECTIVO",
    nombre: "Planilla correctivos",
    especialidad: "*",
    subTipo: "correctivo",
    secciones: [
      {
        id: "corr_personal",
        titulo: "Personal ejecutor",
        tipo: "datos_persona",
        maxFilasPersona: 5,
        obligatorio: false,
      },
      {
        id: "corr_actividad",
        titulo: "Actividad realizada",
        tipo: "libre",
        obligatorio: true,
        etiquetaLibre: "Definir trabajos en detalle",
      },
      {
        id: "corr_mats",
        titulo: "Materiales utilizados",
        tipo: "libre",
        obligatorio: false,
      },
      {
        id: "corr_obs",
        titulo: "Observaciones del usuario",
        tipo: "libre",
        obligatorio: false,
      },
      {
        id: "corr_ssgg",
        titulo: "Control aleatorio calidad SSGG",
        tipo: "libre",
        obligatorio: false,
        soloAdmin: true,
        etiquetaLibre: "Solo administración",
      },
    ],
  },
];

async function main() {
  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.planilla_templates);
  for (const t of templates) {
    await col.doc(t.id).set(t, { merge: true });
    console.log("OK planilla_templates/", t.id);
  }
  console.log("\nListo:", templates.length, "templates.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
