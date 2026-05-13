import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import * as XLSX from "xlsx";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { normalizeCentro } from "@/lib/firestore/derive-centro";
import type { EspecialidadActivo } from "@/modules/assets/types";

export type ParsedAssetImportRow = {
  codigo_nuevo: string;
  codigo_legacy?: string;
  denominacion: string;
  ubicacion_tecnica: string;
  centro: string;
  especialidad_predeterminada: EspecialidadActivo;
  activo_operativo: boolean;
};

type Matrix = (string | number | null | undefined)[][];

function normHeader(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function sheetEspecialidad(sheetName: string): EspecialidadActivo | null {
  const n = sheetName.trim().toLowerCase();
  if (n.includes("aire") && n.includes("acondicionado")) return "AA";
  if (n.includes("grupo") && n.includes("generador")) return "GG";
  return null;
}

function findHeaderRowIndex(matrix: Matrix): number {
  const maxScan = Math.min(matrix.length, 40);
  for (let r = 0; r < maxScan; r++) {
    const cells = matrix[r].map((c) => normHeader(String(c ?? "")));
    const hitNuevoCodigo = cells.some((c) => c.includes("nuevo") && c.includes("codigo"));
    const hitCodigoEquipo = cells.some(
      (c) => c.includes("codigo") && c.includes("equipo"),
    );
    const hitUbicacion = cells.some((c) => c.includes("ubicacion") && c.includes("tecnica"));
    const hitNuevaUt = cells.some((c) => c.includes("nueva") && c.includes("ut"));
    if (hitNuevoCodigo || hitCodigoEquipo || (hitUbicacion && hitNuevaUt)) {
      return r;
    }
  }
  return -1;
}

function headerIndexMap(headerRow: Matrix[0]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < headerRow.length; i++) {
    const key = normHeader(String(headerRow[i] ?? ""));
    if (key && !m.has(key)) m.set(key, i);
  }
  return m;
}

function colByIncludes(map: Map<string, number>, fragments: string[]): number | undefined {
  outer: for (const [key, idx] of map) {
    for (const f of fragments) {
      if (!key.includes(f)) continue outer;
    }
    return idx;
  }
  return undefined;
}

function resolveColumns(map: Map<string, number>) {
  const ut =
    map.get("nueva ut") ??
    map.get("ubicacion tecnica") ??
    colByIncludes(map, ["ubicacion", "tecnica"]);
  const codigo =
    map.get("nuevo codigo") ??
    map.get("codigo del equipo") ??
    colByIncludes(map, ["codigo", "del", "equipo"]) ??
    colByIncludes(map, ["codigo", "equipo"]);
  const desc =
    map.get("descripcion") ??
    map.get("detalle del equipo") ??
    colByIncludes(map, ["detalle", "del", "equipo"]) ??
    colByIncludes(map, ["detalle", "equipo"]);
  const legacy = map.get("codigo viejo");
  const centroRow = map.get("centro") ?? map.get("planta");
  return { ut, codigo, desc, legacy, centroRow };
}

function str(cell: string | number | null | undefined): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).trim();
}

export function docIdFromAssetCodigo(codigo: string): string {
  return codigo.trim().replace(/\//g, "-");
}

export function parseAssetsWorkbook(
  workbook: XLSX.WorkBook,
  centroDefault: string,
): { rows: ParsedAssetImportRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const rows: ParsedAssetImportRow[] = [];
  const seenCodigo = new Set<string>();

  for (const sheetName of workbook.SheetNames) {
    const esp = sheetEspecialidad(sheetName);
    if (!esp) continue;

    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<Matrix[0]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as Matrix;

    const hr = findHeaderRowIndex(matrix);
    if (hr < 0) {
      warnings.push(`Hoja «${sheetName}»: no se encontró fila de encabezados; omitida.`);
      continue;
    }

    const hmap = headerIndexMap(matrix[hr]);
    const cols = resolveColumns(hmap);
    if (cols.codigo === undefined || cols.ut === undefined || cols.desc === undefined) {
      warnings.push(
        `Hoja «${sheetName}»: columnas incompletas (ut=${cols.ut}, codigo=${cols.codigo}, desc=${cols.desc}); omitida.`,
      );
      continue;
    }

    for (let r = hr + 1; r < matrix.length; r++) {
      const line = matrix[r] ?? [];
      const codigo_nuevo = str(line[cols.codigo]);
      const ubicacion_tecnica = str(line[cols.ut]);
      const denominacion = str(line[cols.desc]);
      const codigo_legacy =
        cols.legacy !== undefined ? str(line[cols.legacy]) : "";
      const centroCell =
        cols.centroRow !== undefined ? str(line[cols.centroRow]) : "";
      const centro = normalizeCentro(centroCell || centroDefault, ubicacion_tecnica, codigo_nuevo);

      if (!codigo_nuevo && !ubicacion_tecnica && !denominacion) continue;
      if (!codigo_nuevo) {
        warnings.push(`Hoja «${sheetName}» fila ${r + 1}: sin código nuevo; omitida.`);
        continue;
      }
      if (!centro) {
        warnings.push(
          `Hoja «${sheetName}» fila ${r + 1}: sin centro (ni columna Centro/Planta ni valor por defecto); omitida.`,
        );
        continue;
      }

      const idKey = docIdFromAssetCodigo(codigo_nuevo).toLowerCase();
      if (seenCodigo.has(idKey)) {
        warnings.push(`Código duplicado en archivo: ${codigo_nuevo}; se mantiene la primera fila.`);
        continue;
      }
      seenCodigo.add(idKey);

      const baja = /baja/i.test(codigo_nuevo) || /baja/i.test(denominacion);

      rows.push({
        codigo_nuevo,
        denominacion: denominacion || codigo_nuevo,
        ubicacion_tecnica: ubicacion_tecnica || "—",
        centro,
        especialidad_predeterminada: esp,
        activo_operativo: !baja,
        ...(codigo_legacy ? { codigo_legacy } : {}),
      });
    }
  }

  return { rows, warnings };
}

export function readAssetsWorkbookFromBuffer(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "buffer" });
}

export async function commitAssetsImportRows(parsed: ParsedAssetImportRow[]): Promise<void> {
  const db = getAdminDb();
  const collection = db.collection("assets");
  const batchSize = 400;
  const getChunk = 10;

  for (let i = 0; i < parsed.length; i += batchSize) {
    const chunk = parsed.slice(i, i + batchSize);
    const refs = chunk.map((p) => collection.doc(docIdFromAssetCodigo(p.codigo_nuevo)));
    const snapsMap = new Map<string, DocumentSnapshot>();
    for (let j = 0; j < refs.length; j += getChunk) {
      const slice = refs.slice(j, j + getChunk);
      const snaps = await db.getAll(...slice);
      for (const s of snaps) snapsMap.set(s.ref.id, s);
    }

    const batch = db.batch();
    for (let k = 0; k < chunk.length; k++) {
      const p = chunk[k];
      const ref = refs[k];
      const snap = snapsMap.get(ref.id)!;
      const payload: Record<string, unknown> = {
        codigo_nuevo: p.codigo_nuevo.trim(),
        denominacion: p.denominacion.trim(),
        ubicacion_tecnica: p.ubicacion_tecnica.trim(),
        centro: p.centro.trim(),
        especialidad_predeterminada: p.especialidad_predeterminada,
        activo_operativo: p.activo_operativo,
        updated_at: FieldValue.serverTimestamp(),
      };
      if (p.codigo_legacy?.trim()) payload.codigo_legacy = p.codigo_legacy.trim();
      if (!snap.exists) payload.created_at = FieldValue.serverTimestamp();
      batch.set(ref, payload, { merge: true });
    }
    await batch.commit();
  }
}
