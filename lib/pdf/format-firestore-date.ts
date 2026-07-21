import { TZ_REPORTE } from "@/lib/reportes/periodo-reporte";

type FormatParts = {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
};

function coerceDate(value: unknown): Date | null {
  if (value == null) return null;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  return null;
}

/** Partes de calendario/hora siempre en America/Argentina/Buenos_Aires. */
function partsEnArgentina(date: Date): FormatParts {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ_REPORTE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: get("day"),
    month: get("month"),
    year: get("year"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/**
 * Formatea timestamps Firestore / Date en hora Argentina (UTC−3).
 * Necesario en PDF/API (servidor en UTC): sin TZ fija, la firma/cierre salía +3 h.
 */
export function formatFirestoreDate(value: unknown, pattern = "dd/MM/yyyy HH:mm"): string {
  const date = coerceDate(value);
  if (!date) {
    if (value == null) return "—";
    return String(value);
  }

  const p = partsEnArgentina(date);
  const year2 = p.year.slice(-2);

  switch (pattern) {
    case "dd/MM/yyyy":
      return `${p.day}/${p.month}/${p.year}`;
    case "dd/MM/yy HH:mm":
      return `${p.day}/${p.month}/${year2} ${p.hour}:${p.minute}`;
    case "dd/MM/yyyy HH:mm":
    default:
      return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
  }
}
