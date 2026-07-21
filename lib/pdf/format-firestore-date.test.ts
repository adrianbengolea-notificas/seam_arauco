import { describe, expect, it } from "vitest";
import { formatFirestoreDate } from "@/lib/pdf/format-firestore-date";

describe("formatFirestoreDate", () => {
  it("muestra hora Argentina aunque el instante sea UTC (caso firma/PDF +3h)", () => {
    // 15:30 AR = 18:30 UTC
    const d = new Date(Date.UTC(2026, 6, 21, 18, 30, 0));
    expect(formatFirestoreDate(d)).toBe("21/07/2026 15:30");
    expect(formatFirestoreDate(d, "dd/MM/yyyy")).toBe("21/07/2026");
  });

  it("acepta Timestamp-like con toDate()", () => {
    const d = new Date(Date.UTC(2026, 6, 21, 18, 15, 0)); // 15:15 AR
    expect(formatFirestoreDate({ toDate: () => d })).toBe("21/07/2026 15:15");
  });

  it("devuelve — si es null/undefined", () => {
    expect(formatFirestoreDate(null)).toBe("—");
    expect(formatFirestoreDate(undefined)).toBe("—");
  });
});
