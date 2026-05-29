import type { ProgramaSemana, SlotSemanal } from "@/modules/scheduling/types";
import { etiquetaLocalidadExport } from "@/lib/format/localidad-programa";
import { parseIsoWeekIdFromSemanaParam, parseIsoWeekToBounds } from "@/modules/scheduling/iso-week";

const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const;
type DiaExport = (typeof DIAS)[number];

const DIA_LABEL: Record<DiaExport, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sábado",
};

function fechaDia(inicio: Date, offsetDias: number): string {
  const d = new Date(inicio);
  d.setDate(d.getDate() + offsetDias);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

type GrupoLocalidad = {
  localidad: string;
  etiqueta: string;
  especialidades: {
    especialidad: string;
    porDia: Record<DiaExport, string>;
  }[];
};

function agruparSlots(slots: SlotSemanal[], centroPrograma?: string): GrupoLocalidad[] {
  const mapLoc = new Map<
    string,
    { mapEsp: Map<string, Map<DiaExport, string[]>>; slotRef: SlotSemanal }
  >();

  for (const slot of slots) {
    const loc = (slot.localidad?.trim() || "—");
    if (!mapLoc.has(loc)) {
      mapLoc.set(loc, { mapEsp: new Map(), slotRef: slot });
    }
    const mapEsp = mapLoc.get(loc)!.mapEsp;

    const esp = slot.especialidad?.trim() || "—";
    if (!mapEsp.has(esp)) mapEsp.set(esp, new Map());
    const mapDia = mapEsp.get(esp)!;

    const dia = slot.dia as DiaExport;
    if (!DIAS.includes(dia)) continue;

    const textos = slot.avisos
      .map((a) => {
        const num = a.numero?.trim() ? `[${a.numero.trim()}] ` : "";
        const desc = a.descripcion?.trim() || "";
        return num + desc;
      })
      .filter(Boolean);

    if (textos.length) {
      const existing = mapDia.get(dia) ?? [];
      mapDia.set(dia, [...existing, ...textos]);
    }

    if (slot.notas?.trim()) {
      const existing = mapDia.get(dia) ?? [];
      mapDia.set(dia, [...existing, `Nota: ${slot.notas.trim()}`]);
    }
  }

  const grupos: GrupoLocalidad[] = [];
  for (const [loc, { mapEsp, slotRef }] of mapLoc) {
    const etiqueta = etiquetaLocalidadExport(slotRef, centroPrograma);
    const especialidades = [];
    for (const [esp, mapDia] of mapEsp) {
      const porDia = {} as Record<DiaExport, string>;
      for (const dia of DIAS) {
        porDia[dia] = (mapDia.get(dia) ?? []).join("\n");
      }
      especialidades.push({ especialidad: esp, porDia });
    }
    grupos.push({ localidad: loc, etiqueta, especialidades });
  }

  return grupos.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
}

export async function exportarProgramaSemanalExcel(programa: ProgramaSemana): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SEAM CMMS";

  const semanaIso = parseIsoWeekIdFromSemanaParam(programa.id) ?? "";
  const { start: lunesDate } = semanaIso
    ? parseIsoWeekToBounds(semanaIso)
    : { start: programa.fechaInicio?.toDate?.() ?? new Date() };

  const semanaLabel = programa.semanaLabel ?? "";

  const C = {
    tituloBg: "FF1F3864",
    tituloFg: "FFFFFFFF",
    headerBg: "FF2F5496",
    headerFg: "FFFFFFFF",
    locBg: "FFDEEAF1",
    locFg: "FF1F3864",
    espBg: "FFEDEDED",
    espFg: "FF000000",
    cellBg: "FFFFFFFF",
    cellFg: "FF000000",
    border: "FFB8B8B8",
    borderDark: "FF2F5496",
  };

  const ws = wb.addWorksheet("Programa Semanal");

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 14;
  for (let c = 3; c <= 8; c++) ws.getColumn(c).width = 38;

  const numCols = 8;

  // ── Fila 1: Título ────────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, numCols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Trabajos — ${semanaLabel}`;
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.tituloBg } };
  titleCell.font = { bold: true, color: { argb: C.tituloFg }, name: "Arial", size: 14 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  // ── Fila 2: Cabecera con días y fechas ────────────────────────────────────
  const headerLabels = [
    "Localidad",
    "Especialidad",
    ...DIAS.map((d, i) => `${DIA_LABEL[d]}\n${fechaDia(lunesDate, i)}`),
  ];
  const headerRow = ws.addRow(headerLabels);
  headerRow.height = 32;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  headerRow.eachCell((cell: any, colNum: number) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.headerBg } };
    cell.font = { bold: true, color: { argb: C.headerFg }, name: "Arial", size: 10 };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    cell.border = {
      top: { style: "medium", color: { argb: C.borderDark } },
      left: { style: colNum === 1 ? "medium" : "thin", color: { argb: colNum === 1 ? C.borderDark : C.border } },
      bottom: { style: "medium", color: { argb: C.borderDark } },
      right: { style: colNum === numCols ? "medium" : "thin", color: { argb: C.border } },
    };
  });

  // ── Filas de datos ────────────────────────────────────────────────────────
  const grupos = agruparSlots(programa.slots ?? [], programa.centro);

  for (const grupo of grupos) {
    const startRow = ws.rowCount + 1;
    const numRows = grupo.especialidades.length;

    for (let i = 0; i < numRows; i++) {
      const esp = grupo.especialidades[i]!;
      const rowValues = [
        grupo.etiqueta,
        esp.especialidad,
        ...DIAS.map((d) => esp.porDia[d]),
      ];
      const row = ws.addRow(rowValues);
      row.height = 15;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      row.eachCell((cell: any, colNum: number) => {
        const isLast = i === numRows - 1;
        const isLocCol = colNum === 1;
        const isEspCol = colNum === 2;
        const isDayCol = colNum >= 3;

        cell.font = {
          name: "Arial",
          size: 9,
          bold: isLocCol || isEspCol,
          color: { argb: isLocCol ? C.locFg : C.cellFg },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: isLocCol ? C.locBg : isEspCol ? C.espBg : C.cellBg },
        };
        cell.alignment = {
          horizontal: isLocCol || isEspCol ? "center" : "left",
          vertical: "top",
          wrapText: true,
        };
        cell.border = {
          top: { style: i === 0 ? "medium" : "hair", color: { argb: i === 0 ? C.borderDark : C.border } },
          left: {
            style: colNum === 1 ? "medium" : isDayCol && colNum === 3 ? "medium" : "thin",
            color: { argb: colNum === 1 || (isDayCol && colNum === 3) ? C.borderDark : C.border },
          },
          bottom: { style: isLast ? "medium" : "hair", color: { argb: isLast ? C.borderDark : C.border } },
          right: {
            style: colNum === numCols ? "medium" : "thin",
            color: { argb: colNum === numCols ? C.borderDark : C.border },
          },
        };
      });

      // Ajustar altura de filas con mucho texto
      const maxLineas = Math.max(
        1,
        ...DIAS.map((d) => (esp.porDia[d] ? esp.porDia[d].split("\n").length : 0)),
      );
      if (maxLineas > 1) row.height = Math.max(15, maxLineas * 14);
    }

    // Merge de la columna Localidad si hay más de una especialidad
    if (numRows > 1) {
      ws.mergeCells(startRow, 1, startRow + numRows - 1, 1);
      const locCell = ws.getCell(startRow, 1);
      locCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    }
  }

  // ── Descargar ─────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeSemana = semanaLabel.replace(/[^a-zA-Z0-9À-ÿ\s\-]/g, "").replace(/\s+/g, "_");
  a.download = `Programa_${safeSemana}.xlsx`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}
