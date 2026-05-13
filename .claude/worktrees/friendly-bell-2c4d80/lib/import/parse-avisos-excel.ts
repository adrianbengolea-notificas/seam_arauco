import type { Aviso } from "@/lib/firestore/types";
import type { ModoImportacionAvisos } from "@/lib/import/modo-importacion";
import * as XLSX from "xlsx";
import {
  listUnmappedColumnHeaders,
  mapHeaders,
  normalizeHeader,
  type HeaderMapResult,
} from "@/lib/import/normalize-headers";
import {
  inferEspecialidadDesdeDescripcionYPto,
  inferFrecuenciaMTSADescripcion,
  normalizeEspecialidad,
  normalizeFecha,
  normalizeFrecuencia,
  normalizeImportKey,
  normalizeNumeroAviso,
} from "@/lib/import/normalize-values";

export type ParsedAvisoRow = Partial<Omit<Aviso, "id" | "createdAt" | "fechaProgramada">> & {
  numero: string;
  fechaProgramada?: string;
  /** Texto SAP opcional (no siempre se persiste en Firestore). */
  autAviso?: string;
};

export interface ParseResult {
  avisos: ParsedAvisoRow[];
  errores: { fila: number; campo: string; valor: unknown; motivo: string }[];
  advertencias: { fila: number; mensaje: string }[];
  /** campo interno → cabecera real del Excel */
  columnasMapeadas: Record<string, string>;
  columnasNoReconocidas: string[];
  tipoDetectado: "preventivos" | "correctivos" | "mixto" | "desconocido";
  /** Mensaje fatal (p. ej. sin columna de aviso); las filas pueden ir vacías */
  fatal?: string;
  hojasProcesadas?: string[];
}

export type ParseAvisosOpciones = {
  frecuenciaForzada?: "M" | "T" | "S" | "A" | null;
  tipoForzado?: "preventivo" | "correctivo";
  soloHoja?: string | null;
  /** No exige ni usa columna frecuencia (correctivos). */
  omitirFrecuencia?: boolean;
  /** Listado semestral/anual: si no hay frecuencia en fila, inferir desde descripción */
  inferirFrecuenciaDesdeDescripcion?: boolean;
  /** Listado S/A: si especialidad SAP es null, usar heurística descripción + puesto */
  inferirEspecialidadDesdeContexto?: boolean;
};

type Matrix = unknown[][];

function cellStr(row: unknown[], idx: number | null): string {
  if (idx == null || idx < 0) return "";
  const v = row[idx];
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Math.abs(v - Math.round(v)) < 1e-9 && Math.abs(v) > 1e6) return String(Math.round(v));
  }
  return String(v).trim();
}

function cellRaw(row: unknown[], idx: number | null): unknown {
  if (idx == null || idx < 0) return null;
  return row[idx] ?? null;
}

function sheetToMatrix(sheet: XLSX.WorkSheet): Matrix {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as Matrix;
}

function pickSheet(wb: XLSX.WorkBook, soloHoja?: string | null): { name: string; sheet: XLSX.WorkSheet } | null {
  if (soloHoja && soloHoja.trim()) {
    const want = soloHoja.trim().toLowerCase();
    const name = wb.SheetNames.find((n) => n.toLowerCase().includes(want));
    if (!name) return null;
    const sheet = wb.Sheets[name];
    if (!sheet) return null;
    return { name, sheet };
  }
  const first = wb.SheetNames[0];
  if (!first) return null;
  const sheet = wb.Sheets[first];
  if (!sheet) return null;
  return { name: first, sheet };
}

function findHeaderRow(matrix: Matrix): number {
  for (let r = 0; r < Math.min(matrix.length, 45); r++) {
    const headers = (matrix[r] ?? []).map((c) => String(c ?? ""));
    const { byField } = mapHeaders(headers);
    if (byField.numero != null) return r;
  }
  return -1;
}

function compactMapped(h: HeaderMapResult): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(h.byField)) {
    if (v) o[k] = v;
  }
  return o;
}

function detectTipoSheet(
  matrix: Matrix,
  hr: number,
  idx: HeaderMapResult["indices"],
): "preventivos" | "correctivos" | "mixto" | "desconocido" {
  let conFecha = 0;
  let conFrec = 0;
  let filas = 0;
  const iFecha = idx.fecha;
  const iFrec = idx.frecuencia;
  const iNum = idx.numero;
  for (let r = hr + 1; r < Math.min(matrix.length, hr + 200); r++) {
    const line = matrix[r] ?? [];
    const numero = normalizeNumeroAviso(cellRaw(line, iNum));
    if (!numero) continue;
    filas++;
    if (iFecha != null) {
      const fd = normalizeFecha(cellRaw(line, iFecha));
      if (fd) conFecha++;
    }
    if (iFrec != null) {
      const fr = cellStr(line, iFrec);
      if (fr && normalizeFrecuencia(fr)) conFrec++;
    }
  }
  if (filas === 0) return "desconocido";
  if (conFecha > 0 && conFrec > 0) return "mixto";
  if (conFecha > 0) return "correctivos";
  if (conFrec > 0) return "preventivos";
  return "desconocido";
}

/**
 * Parser universal de una hoja de avisos SAP → filas normalizadas (sin Firestore).
 */
export async function parseAvisosExcel(
  buffer: ArrayBuffer,
  opciones: ParseAvisosOpciones = {},
): Promise<ParseResult> {
  const errores: ParseResult["errores"] = [];
  const advertencias: ParseResult["advertencias"] = [];
  const avisos: ParsedAvisoRow[] = [];

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch {
    return {
      avisos: [],
      errores: [],
      advertencias: [],
      columnasMapeadas: {},
      columnasNoReconocidas: [],
      tipoDetectado: "desconocido",
      fatal: "No se pudo leer el archivo (¿es un Excel válido?).",
    };
  }

  if (!wb.SheetNames?.length) {
    return {
      avisos: [],
      errores: [],
      advertencias: [],
      columnasMapeadas: {},
      columnasNoReconocidas: [],
      tipoDetectado: "desconocido",
      fatal: "El archivo no contiene hojas.",
    };
  }

  const picked = pickSheet(wb, opciones.soloHoja);
  if (!picked) {
    return {
      avisos: [],
      errores: [],
      advertencias: [],
      columnasMapeadas: {},
      columnasNoReconocidas: [],
      tipoDetectado: "desconocido",
      fatal: opciones.soloHoja
        ? `No se encontró ninguna hoja que coincida con «${opciones.soloHoja}».`
        : "No se pudo abrir la hoja activa.",
    };
  }

  const matrix = sheetToMatrix(picked.sheet);
  const hr = findHeaderRow(matrix);
  if (hr < 0) {
    return {
      avisos: [],
      errores: [],
      advertencias: [],
      columnasMapeadas: {},
      columnasNoReconocidas: [],
      tipoDetectado: "desconocido",
      fatal: "No se encontró una fila de encabezados con columna de número de aviso.",
      hojasProcesadas: [picked.name],
    };
  }

  const headerCells = (matrix[hr] ?? []).map((c) => String(c ?? ""));
  const headerMap = mapHeaders(headerCells);
  if (headerMap.byField.numero == null) {
    return {
      avisos: [],
      errores: [],
      advertencias: [],
      columnasMapeadas: compactMapped(headerMap),
      columnasNoReconocidas: listUnmappedColumnHeaders(headerCells, headerMap.indices),
      tipoDetectado: "desconocido",
      fatal: "No se encontró columna de número de aviso.",
      hojasProcesadas: [picked.name],
    };
  }

  const idx = headerMap.indices;
  const iDesc = idx.descripcion;
  const iUt = idx.ubicacionTecnica;
  if (iDesc == null || iUt == null) {
    return {
      avisos: [],
      errores: [],
      advertencias: [],
      columnasMapeadas: compactMapped(headerMap),
      columnasNoReconocidas: listUnmappedColumnHeaders(headerCells, headerMap.indices),
      tipoDetectado: "desconocido",
      fatal: "Faltan columnas obligatorias (descripción y/o ubicación técnica).",
      hojasProcesadas: [picked.name],
    };
  }

  let tipoDetectado = detectTipoSheet(matrix, hr, idx);
  if (opciones.tipoForzado) {
    tipoDetectado = opciones.tipoForzado === "correctivo" ? "correctivos" : "preventivos";
  }

  const omitirFrec = opciones.omitirFrecuencia === true;

  for (let r = hr + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? [];
    const excelRow = r + 1;
    const numeroRaw = cellRaw(line, idx.numero);
    const numero = normalizeNumeroAviso(numeroRaw);
    const descripcion = cellStr(line, iDesc);
    const ut = cellStr(line, iUt);

    if (!numero && !descripcion && !ut) continue;

    if (!numero) {
      if (descripcion || ut) {
        errores.push({
          fila: excelRow,
          campo: "numero",
          valor: numeroRaw,
          motivo: "Número de aviso inválido o vacío",
        });
      }
      continue;
    }

    const denom = cellStr(line, idx.denomUbicTecnica);
    const espRaw = cellStr(line, idx.especialidad);
    const frecRaw = omitirFrec ? "" : cellStr(line, idx.frecuencia);
    const tipoRaw = cellStr(line, idx.tipo);
    const statusRaw = cellStr(line, idx.status);
    const centroRaw = cellStr(line, idx.centro);
    const ptoRaw = cellStr(line, idx.ptoTrbRes);
    const autRaw = cellStr(line, idx.autAviso);
    const fechaRaw = cellRaw(line, idx.fecha);

    let esp = normalizeEspecialidad(espRaw || null);
    if (!esp && opciones.inferirEspecialidadDesdeContexto) {
      esp = inferEspecialidadDesdeDescripcionYPto(descripcion, ptoRaw);
    } else if (espRaw && esp) {
      const kr = normalizeImportKey(espRaw);
      if (kr.length > 1 && kr !== esp.toLowerCase()) {
        advertencias.push({
          fila: excelRow,
          mensaje: `Fila ${excelRow}: especialidad «${espRaw}» mapeada a «${esp}».`,
        });
      }
    } else if (espRaw && !esp) {
      advertencias.push({
        fila: excelRow,
        mensaje: `Fila ${excelRow}: especialidad «${espRaw}» no reconocida; se usará valor por defecto al importar.`,
      });
    }

    let frecM = omitirFrec ? null : normalizeFrecuencia(frecRaw || null);
    if (!frecM && opciones.frecuenciaForzada) {
      frecM = opciones.frecuenciaForzada;
    }
    if (!frecM && opciones.inferirFrecuenciaDesdeDescripcion) {
      frecM = inferFrecuenciaMTSADescripcion(descripcion);
    }

    const fecha = normalizeFecha(fechaRaw);

    let tipoFila: "preventivo" | "correctivo";
    if (opciones.tipoForzado) {
      tipoFila = opciones.tipoForzado;
    } else if (fecha && !omitirFrec) {
      tipoFila = "correctivo";
    } else if (!fecha && frecM) {
      tipoFila = "preventivo";
    } else if (tipoDetectado === "correctivos") {
      tipoFila = "correctivo";
    } else if (tipoDetectado === "preventivos") {
      tipoFila = "preventivo";
    } else {
      tipoFila = fecha ? "correctivo" : "preventivo";
    }

    if (tipoFila === "preventivo" && !frecM && !omitirFrec) {
      advertencias.push({
        fila: excelRow,
        mensaje: `Fila ${excelRow}: sin frecuencia reconocida; revisá la columna o usá import forzada por hoja.`,
      });
    }

    const row: ParsedAvisoRow = {
      numero,
      descripcion,
      ubicacionTecnica: ut,
      denomUbicTecnica: denom || undefined,
      especialidad: esp ?? undefined,
      frecuencia: omitirFrec ? undefined : frecM ?? undefined,
      tipo: tipoFila,
      centro: centroRaw || undefined,
      ptoTrbRes: ptoRaw || undefined,
      autAviso: autRaw || undefined,
    };

    if (tipoRaw) {
      const tr = normalizeHeader(tipoRaw);
      if (tr.includes("correct") || tr === "c") {
        row.tipo = "correctivo";
      } else if (tr.includes("prevent") || tr === "p") {
        row.tipo = "preventivo";
      }
    }

    if (fecha) row.fechaProgramada = fecha.toISOString();

    if (statusRaw) {
      const u = normalizeHeader(statusRaw);
      if (u.includes("pdte") || u.includes("pend")) row.status = "PDTE";
      else if (u.includes("curso") || u.includes("proce")) row.status = "EN_CURSO";
      else if (u.includes("compl") || u.includes("cerr") || u.includes("realiz")) row.status = "COMPLETADA";
      else if (u.includes("cancel") || u.includes("anul")) row.status = "CANCELADA";
    }

    avisos.push(row);
  }

  const columnasNoReconocidas = listUnmappedColumnHeaders(headerCells, headerMap.indices);

  return {
    avisos,
    errores,
    advertencias,
    columnasMapeadas: compactMapped(headerMap),
    columnasNoReconocidas,
    tipoDetectado,
    hojasProcesadas: [picked.name],
  };
}

function mergeResults(parts: ParseResult[]): ParseResult {
  if (!parts.length) {
    return {
      avisos: [],
      errores: [],
      advertencias: [],
      columnasMapeadas: {},
      columnasNoReconocidas: [],
      tipoDetectado: "desconocido",
    };
  }
  const avisos = parts.flatMap((p) => p.avisos);
  const errores = parts.flatMap((p) => p.errores);
  const advertencias = parts.flatMap((p) => p.advertencias);
  const hojasProcesadas = parts.flatMap((p) => p.hojasProcesadas ?? []);
  const fatals = parts.map((p) => p.fatal).filter(Boolean);
  const tipos = new Set(parts.map((p) => p.tipoDetectado));
  let tipoDetectado: ParseResult["tipoDetectado"] = "desconocido";
  if (tipos.size === 1) tipoDetectado = [...tipos][0]!;
  else if (tipos.size > 1) tipoDetectado = "mixto";

  const columnasMapeadas = parts.find((p) => Object.keys(p.columnasMapeadas).length)?.columnasMapeadas ?? {};
  const columnasNoReconocidas = [...new Set(parts.flatMap((p) => p.columnasNoReconocidas))];

  return {
    avisos,
    errores,
    advertencias,
    columnasMapeadas,
    columnasNoReconocidas,
    tipoDetectado,
    fatal: fatals.length ? fatals.join(" ") : undefined,
    hojasProcesadas,
  };
}

function sheetFreqFromName(sheetName: string): "M" | "T" | "S" | "A" | null {
  const n = normalizeHeader(sheetName);
  if (n.includes("semestral")) return "S";
  if (n.includes("anual") && !n.includes("semest")) return "A";
  if (n.includes("trim")) return "T";
  if (n.startsWith("men") || n.includes("mensual")) return "M";
  return null;
}

function findMensualSheetName(names: string[]): string | null {
  const found = names.find((n) => {
    const x = normalizeHeader(n);
    return x.includes("mensual") || /^men/.test(x) || x.includes(" men");
  });
  return found ?? null;
}

function filtraPreventivoSheets(
  modo: ModoImportacionAvisos,
  sheetName: string,
): { ok: boolean; frecuencia: "M" | "T" | "S" | "A" | null } {
  const f = sheetFreqFromName(sheetName);
  if (!f) return { ok: false, frecuencia: null };
  if (modo === "preventivos_todas") return { ok: true, frecuencia: f };
  if (modo === "preventivos_mensual") return { ok: f === "M", frecuencia: f };
  if (modo === "preventivos_trimestral") return { ok: f === "T", frecuencia: f };
  if (modo === "preventivos_semestral") return { ok: f === "S", frecuencia: f };
  if (modo === "preventivos_anual") return { ok: f === "A", frecuencia: f };
  return { ok: false, frecuencia: null };
}

/**
 * Punto de entrada por modo de importación (multi-hoja cuando aplica).
 */
export async function parseAvisosPorModo(
  buffer: ArrayBuffer,
  modo: Exclude<ModoImportacionAvisos, "mensuales_parche">,
): Promise<ParseResult> {
  if (modo === "correctivos") {
    return parseAvisosExcel(buffer, {
      tipoForzado: "correctivo",
      frecuenciaForzada: null,
      omitirFrecuencia: true,
    });
  }

  if (modo === "listado_semestral_anual") {
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    const h1 = wb.SheetNames.includes("Hoja1") ? "Hoja1" : wb.SheetNames[0];
    if (!h1) {
      return {
        avisos: [],
        errores: [],
        advertencias: [],
        columnasMapeadas: {},
        columnasNoReconocidas: [],
        tipoDetectado: "desconocido",
        fatal: "El archivo no contiene hojas.",
      };
    }
    return parseAvisosExcel(buffer, {
      soloHoja: h1,
      tipoForzado: "preventivo",
      frecuenciaForzada: null,
      inferirFrecuenciaDesdeDescripcion: true,
      inferirEspecialidadDesdeContexto: true,
    });
  }

  if (
    modo === "preventivos_todas" ||
    modo === "preventivos_mensual" ||
    modo === "preventivos_trimestral" ||
    modo === "preventivos_semestral" ||
    modo === "preventivos_anual"
  ) {
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    let names = [...wb.SheetNames];
    if (modo === "preventivos_mensual") {
      const one = findMensualSheetName(names);
      if (one) names = [one];
    }

    const parts: ParseResult[] = [];
    const sheetAdv: ParseResult["advertencias"] = [];
    for (const sheetName of names) {
      const { ok, frecuencia } = filtraPreventivoSheets(modo, sheetName);
      if (!ok) continue;
      const u8 = XLSX.write(
        { SheetNames: [sheetName], Sheets: { [sheetName]: wb.Sheets[sheetName]! } },
        { type: "array", bookType: "xlsx" },
      );
      const partBuf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      const pr = await parseAvisosExcel(partBuf, {
        soloHoja: sheetName,
        frecuenciaForzada: frecuencia,
        tipoForzado: "preventivo",
      });
      if (pr.fatal) {
        sheetAdv.push({ fila: 0, mensaje: `Hoja «${sheetName}» omitida: ${pr.fatal}` });
        continue;
      }
      parts.push(pr);
    }
    if (!parts.length) {
      return {
        avisos: [],
        errores: [],
        advertencias: sheetAdv,
        columnasMapeadas: {},
        columnasNoReconocidas: [],
        tipoDetectado: "desconocido",
        fatal:
          sheetAdv.length > 0
            ? sheetAdv.map((a) => a.mensaje).join(" ")
            : modo === "preventivos_todas"
              ? "No se encontraron hojas de preventivos (mensual/trimestral/semestral/anual) en el archivo."
              : "No hay hojas que coincidan con esta pestaña en el archivo.",
      };
    }
    const merged = mergeResults(parts);
    merged.advertencias = [...sheetAdv, ...merged.advertencias];
    if (!merged.avisos.length && !merged.fatal) {
      merged.fatal =
        modo === "preventivos_todas"
          ? "No se encontraron hojas de preventivos (mensual/trimestral/semestral/anual) en el archivo."
          : "No hay hojas que coincidan con esta pestaña en el archivo.";
    }
    return merged;
  }

  return parseAvisosExcel(buffer, {});
}
