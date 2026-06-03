import { describe, expect, it } from "vitest";
import {
  calcularTotalesPreventivo,
  emptyDiscMap,
  esOtCerradaEnPeriodo,
  formulaPctText,
  mergeDiscMap,
} from "@/lib/reportes/cumplimiento-metrics";

describe("cumplimiento-metrics", () => {
  it("calcularTotalesPreventivo no supera 100% con universo coherente", () => {
    const m = emptyDiscMap();
    m.AA.planificadas = 60;
    m.AA.ejecutadas = 55;
    m.ELECTRICO.planificadas = 58;
    m.ELECTRICO.ejecutadas = 50;
    m.GG.planificadas = 2;
    m.GG.ejecutadas = 2;
    const t = calcularTotalesPreventivo(m);
    expect(t.preventivos_planificados).toBe(120);
    expect(t.preventivos_ejecutados).toBe(107);
    expect(t.preventivos_pendientes).toBe(13);
    expect(t.pct_general).toBeCloseTo(107 / 120, 2);
    expect(t.pct_general).toBeLessThanOrEqual(1);
  });

  it("mergeDiscMap suma disciplinas", () => {
    const a = emptyDiscMap();
    a.AA.planificadas = 10;
    a.AA.ejecutadas = 8;
    const b = emptyDiscMap();
    b.AA.planificadas = 5;
    b.AA.ejecutadas = 5;
    mergeDiscMap(a, b);
    expect(a.AA.planificadas).toBe(15);
    expect(a.AA.ejecutadas).toBe(13);
    expect(a.AA.pendientes).toBe(2);
  });

  it("formulaPctText", () => {
    expect(formulaPctText(108, 120)).toBe("108 / 120 = 90%");
  });

  it("esOtCerradaEnPeriodo exige CERRADA y fecha_fin en el mes", () => {
    const inicio = Date.parse("2026-03-01T00:00:00");
    const fin = Date.parse("2026-04-01T00:00:00");
    const cierreMarzo = { toMillis: () => Date.parse("2026-03-15T12:00:00") };
    const cierreAbril = { toMillis: () => Date.parse("2026-04-02T12:00:00") };

    expect(esOtCerradaEnPeriodo("CERRADA", cierreMarzo, inicio, fin)).toBe(true);
    expect(esOtCerradaEnPeriodo("CERRADA", cierreAbril, inicio, fin)).toBe(false);
    expect(esOtCerradaEnPeriodo("ABIERTA", cierreMarzo, inicio, fin)).toBe(false);
    expect(esOtCerradaEnPeriodo("CERRADA", null, inicio, fin)).toBe(false);
  });
});
