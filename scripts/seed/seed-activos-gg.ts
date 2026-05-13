/**
 * Crea (o actualiza con merge) los activos GG del catálogo.
 * Son 15 equipos únicos: en planillas suele aparecer cada uno dos veces (p. ej. "SERVIS ANUAL …"
 * y "CHECK …") y a veces con prefijo distinto (p. ej. "GGE-PM02CH50KVA" = mismo activo que `PM02CH50KVA`).
 * Centros: PC01, PF01, PM02, PT01.
 *
 *   npx tsx --env-file=.env.local scripts/seed/seed-activos-gg.ts
 */

import { getAdminDb } from "@/firebase/firebaseAdmin";
import { ASSETS_COLLECTION } from "@/lib/firestore/collections";
import { FieldValue } from "firebase-admin/firestore";

type GGAsset = {
  codigo_nuevo: string;
  denominacion: string;
  ubicacion_tecnica: string;
  denom_ubicacion: string; // referencia interna; no se guarda en Firestore
  centro: string;
};

const ASSETS: GGAsset[] = [
  // ── PC01 – Esperanza / Celulosa ─────────────────────────────────────────────
  {
    codigo_nuevo:      "PC01BC7KVA",
    denominacion:      "GRUPO GENERADOR 7KVA",
    ubicacion_tecnica: "ESPE-ESP-CEL-BALANZ",
    denom_ubicacion:   "BALANZA",
    centro:            "PC01",
  },
  {
    codigo_nuevo:      "PC01GP11KVA",
    denominacion:      "GRUPO GENERADOR 11KVA",
    ubicacion_tecnica: "ESPE-ESP-ESB-CENTRO-CASAGPER",
    denom_ubicacion:   "CASA GERENTE DE PERSONAS",
    centro:            "PC01",
  },
  {
    codigo_nuevo:      "PC01SHI11KVA",
    denominacion:      "GRUPO GENERADOR 11KVA",
    ubicacion_tecnica: "ESPE-ESP-CEL-ADMIN2-OFSGTECO",
    denom_ubicacion:   "DEPOSITO SSGG (Frente Chaparral)",
    centro:            "PC01",
  },

  // ── PF01 – Y-Porá ───────────────────────────────────────────────────────────
  {
    codigo_nuevo:      "PF01GF164KVA",
    denominacion:      "GRUPO GENERADOR 164KVA",
    ubicacion_tecnica: "YPOR-YPO-GOF-VIVERO-SGENERAD",
    denom_ubicacion:   "SALA DE GENERADORES PREDIO Y-PORA",
    centro:            "PF01",
  },
  {
    codigo_nuevo:      "PF01HOS100KVA",
    denominacion:      "GRUPO GENERADOR 100KVA",
    ubicacion_tecnica: "YPOR-YPO-GOF-VIVERO-SGENERAD",
    denom_ubicacion:   "SALA DE GENERADORES PREDIO Y-PORA",
    centro:            "PF01",
  },
  {
    codigo_nuevo:      "PF01PAL7KVA",
    denominacion:      "GRUPO GENERADOR 7KVA",
    ubicacion_tecnica: "YPOR-YPO-GOF-VIVERO-SGENERAD",
    denom_ubicacion:   "SALA DE GENERADORES PREDIO Y-PORA",
    centro:            "PF01",
  },
  {
    codigo_nuevo:      "PF01VY132KVA",
    denominacion:      "GRUPO GENERADOR 132KVA",
    ubicacion_tecnica: "YPOR-YPO-GOF-VIVERO-SGENERAD",
    denom_ubicacion:   "SALA DE GENERADORES PREDIO Y-PORA",
    centro:            "PF01",
  },

  // ── PF01 – Bossetti ─────────────────────────────────────────────────────────
  {
    codigo_nuevo:      "PF01VB100KVA",
    denominacion:      "GRUPO GENERADOR 100KVA",
    ubicacion_tecnica: "BOSS-BOS-ADM-VIVERO-SGENERAD",
    denom_ubicacion:   "SALA DE GENERADORES VIVERO BOSSETTI",
    centro:            "PF01",
  },
  {
    codigo_nuevo:      "PF01VB80KVA",
    denominacion:      "GRUPO GENERADOR 80KVA",
    ubicacion_tecnica: "BOSS-BOS-ADM-VIVERO-SGENERAD",
    denom_ubicacion:   "SALA DE GENERADORES VIVERO BOSSETTI",
    centro:            "PF01",
  },
  {
    codigo_nuevo:      "PM01BB7KVA",
    denominacion:      "GRUPO GENERADOR 7KVA",
    ubicacion_tecnica: "BOSS-BOS-ADM-EXPEDI-TALLERBO",
    denom_ubicacion:   "TALLER DE EQUIPOS MOVILES BOSSETTI",
    centro:            "PF01", // PM01 sin prefijo SAP reconocido → fallback UT BOSS → PF01
  },
  {
    codigo_nuevo:      "PM0TA31KVA",
    denominacion:      "GRUPO GENERADOR 31KVA",
    ubicacion_tecnica: "BOSS-BOS-ADM-EXPEDI-TALLERBO",
    denom_ubicacion:   "TALLER DE EQUIPOS MOVILES BOSSETTI",
    centro:            "PF01", // PM0* sin prefijo SAP reconocido → fallback UT BOSS → PF01
  },

  // ── PM02 – Chalet / CLB Bossetti ────────────────────────────────────────────
  {
    codigo_nuevo:      "PM02CH50KVA",
    denominacion:      "GRUPO GENERADOR 50KVA",
    ubicacion_tecnica: "BOSS-BOS-ADM-CHALET-SGENERAD",
    denom_ubicacion:   "SALA DE GENERADORES CHALET BOSSETTI",
    centro:            "PM02",
  },
  {
    codigo_nuevo:      "PM02CLB40KVA",
    denominacion:      "GRUPO GENERADOR 40KVA",
    ubicacion_tecnica: "BOSS-BOS-ADM-EXPEDI-SGENERAD",
    denom_ubicacion:   "SALA DE GENERADOR CLB",
    centro:            "PM02",
  },

  // ── PT01 – Pirané ───────────────────────────────────────────────────────────
  {
    codigo_nuevo:      "GGE-11KVA-GCE",
    denominacion:      "GRUPO GENERADOR 11KVA",
    ubicacion_tecnica: "PIRA-PIR-ELD-CASGTE-KM8GTECE",
    denom_ubicacion:   "ALQUILER - CASA GTE CELULOSA",
    centro:            "PT01",
  },
  {
    codigo_nuevo:      "GGE-7,5KVA-BAP",
    denominacion:      "GRUPO GENERADOR 7,5KVA",
    ubicacion_tecnica: "PIRA-PIR-MDF-BALANZ",
    denom_ubicacion:   "BALANZA",
    centro:            "PT01",
  },
];

function docId(codigo: string): string {
  return codigo.trim().replace(/\//g, "-");
}

async function main() {
  const db = getAdminDb();
  const col = db.collection(ASSETS_COLLECTION);

  let creados = 0;
  let actualizados = 0;

  for (const a of ASSETS) {
    const id = docId(a.codigo_nuevo);
    const ref = col.doc(id);
    const snap = await ref.get();

    const payload: Record<string, unknown> = {
      codigo_nuevo:               a.codigo_nuevo.trim(),
      denominacion:               a.denominacion.trim(),
      ubicacion_tecnica:          a.ubicacion_tecnica.trim(),
      centro:                     a.centro.trim(),
      especialidad_predeterminada: "GG",
      activo_operativo:           true,
      updated_at:                 FieldValue.serverTimestamp(),
    };

    if (!snap.exists) {
      payload.created_at = FieldValue.serverTimestamp();
      creados++;
    } else {
      actualizados++;
    }

    await ref.set(payload, { merge: true });

    const estado = snap.exists ? "actualizado" : "creado   ";
    console.log(`${estado}  assets/${id.padEnd(22)}  centro: ${a.centro}  (${a.denom_ubicacion})`);
  }

  console.log(`\nListo: ${creados} creados, ${actualizados} ya existían (actualizados).`);
  console.log(`Total: ${ASSETS.length} activos GG.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
