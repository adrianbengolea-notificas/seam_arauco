import { describe, expect, it } from "vitest";
import {
  formatFechaReporteAR,
  inicioMesArgentinaMs,
  mesCalendarioArgentina,
  msEnMesReporte,
  rangeMesReporte,
} from "@/lib/reportes/periodo-reporte";

describe("periodo-reporte", () => {
  it("msEnMesReporte usa calendario Argentina", () => {
    // 30/04/2026 22:00 AR = 01/05/2026 01:00 UTC → sigue siendo abril en AR
    const finAbrilTarde = Date.UTC(2026, 4, 1, 1, 0, 0);
    expect(mesCalendarioArgentina(finAbrilTarde)).toEqual({ año: 2026, mes: 4 });
    expect(msEnMesReporte(finAbrilTarde, 2026, 4)).toBe(true);
    expect(msEnMesReporte(finAbrilTarde, 2026, 5)).toBe(false);

    // 15/04/2026 mediodía AR
    const midAbril = Date.UTC(2026, 3, 15, 15, 0, 0);
    expect(msEnMesReporte(midAbril, 2026, 4)).toBe(true);
    expect(msEnMesReporte(midAbril, 2026, 5)).toBe(false);
    expect(msEnMesReporte(midAbril, 2026, 6)).toBe(false);
  });

  it("rangeMesReporte alinea inicio/fin con medianoche AR", () => {
    const { inicioMs, finMs } = rangeMesReporte(2026, 6);
    expect(inicioMs).toBe(inicioMesArgentinaMs(2026, 6));
    expect(mesCalendarioArgentina(inicioMs)).toEqual({ año: 2026, mes: 6 });
    expect(mesCalendarioArgentina(finMs - 1)).toEqual({ año: 2026, mes: 6 });
    expect(mesCalendarioArgentina(finMs)).toEqual({ año: 2026, mes: 7 });
  });

  it("formatFechaReporteAR muestra día calendario AR", () => {
    const ms = Date.UTC(2026, 3, 30, 23, 0, 0); // 30/04/2026 ~20:00 AR
    expect(formatFechaReporteAR(ms)).toMatch(/30\/04\/2026/);
  });
});
