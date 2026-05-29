import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  avisoPasaBusqueda,
  busquedaProgramaListaParaCrossWeek,
  type ContextoBusquedaAvisoPrograma,
} from "@/modules/scheduling/busqueda-programa-aviso";
import { parseIsoWeekIdFromSemanaParam } from "@/modules/scheduling/iso-week";
import type { AvisoSlot, DiaSemanaPrograma, EspecialidadPrograma, SlotSemanal } from "@/modules/scheduling/types";
import type { DocumentData } from "firebase-admin/firestore";

export type AvisoProgramaSearchHit = {
  programaDocId: string;
  isoSemana: string;
  centro: string;
  avisoNumero: string;
  descripcion: string;
  localidad: string;
  dia: DiaSemanaPrograma;
  especialidad: EspecialidadPrograma;
};

function uniqCentros(centros: string[]): string[] {
  const seen = new Set<string>();
  for (const c of centros) {
    const t = c.trim();
    if (t) seen.add(t);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function chunkIn<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function hitsDesdeProgramaDoc(
  docId: string,
  centro: string,
  slots: SlotSemanal[] | undefined,
  query: string,
): AvisoProgramaSearchHit[] {
  const iso = parseIsoWeekIdFromSemanaParam(docId);
  if (!iso) return [];
  const hits: AvisoProgramaSearchHit[] = [];
  for (const slot of slots ?? []) {
    const ctx: ContextoBusquedaAvisoPrograma = {
      localidad: slot.localidad,
      denomUbicTecnica: slot.denomUbicTecnica,
      especialidad: slot.especialidad,
    };
    for (const aviso of slot.avisos ?? []) {
      if (!avisoPasaBusqueda(aviso as AvisoSlot, query, ctx)) continue;
      hits.push({
        programaDocId: docId,
        isoSemana: iso,
        centro,
        avisoNumero: String(aviso.numero ?? "").trim(),
        descripcion: String(aviso.descripcion ?? "").trim(),
        localidad: slot.localidad?.trim() || "—",
        dia: slot.dia,
        especialidad: slot.especialidad,
      });
    }
  }
  return hits;
}

/**
 * Busca avisos en todas las grillas publicadas (`programa_semanal`) de los centros indicados.
 * Orden: semana ISO descendente (más reciente primero).
 */
export async function searchAvisoEnProgramaSemanalAdmin(opts: {
  centros: string[];
  query: string;
  maxResults?: number;
}): Promise<AvisoProgramaSearchHit[]> {
  const query = opts.query.trim();
  if (!busquedaProgramaListaParaCrossWeek(query)) return [];

  const centros = uniqCentros(opts.centros);
  if (centros.length === 0) return [];

  const maxResults = opts.maxResults ?? 30;
  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.programa_semanal);
  const hits: AvisoProgramaSearchHit[] = [];

  for (const batch of chunkIn(centros, 10)) {
    const snap =
      batch.length === 1
        ? await col.where("centro", "==", batch[0]).get()
        : await col.where("centro", "in", batch).get();

    for (const d of snap.docs) {
      const data = d.data() as DocumentData & { centro?: string; slots?: SlotSemanal[] };
      const centro = String(data.centro ?? "").trim();
      if (!centro) continue;
      hits.push(...hitsDesdeProgramaDoc(d.id, centro, data.slots, query));
    }
  }

  hits.sort((a, b) => {
    const bySem = b.isoSemana.localeCompare(a.isoSemana, undefined, { numeric: true });
    if (bySem !== 0) return bySem;
    return a.avisoNumero.localeCompare(b.avisoNumero, "es", { numeric: true });
  });

  return hits.slice(0, maxResults);
}
