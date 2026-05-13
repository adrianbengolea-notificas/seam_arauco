import { format } from "date-fns";
import { es } from "date-fns/locale/es";

export function formatFirestoreDate(value: unknown, pattern = "dd/MM/yyyy HH:mm"): string {
  if (value == null) return "—";
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    try {
      return format((value as { toDate: () => Date }).toDate(), pattern, { locale: es });
    } catch {
      return "—";
    }
  }
  if (value instanceof Date) {
    return format(value, pattern, { locale: es });
  }
  return String(value);
}
