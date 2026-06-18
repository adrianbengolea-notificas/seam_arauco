import { describe, expect, it } from "vitest";
import {
  calcularCertificacionDisciplina,
  calcularIndiceCertificacion,
  METAS_CERTIFICACION_2026_DEFAULT,
  PESOS_CERTIFICACION_CONTRATO,
  planAcumuladoEnPeriodo,
  tierFrecuenciaDesdeOt,
} from "@/lib/reportes/certificacion-objetivos";

describe("certificacion-objetivos", () => {
  it("pesos contractuales del Excel Mayo 26", () => {
    expect(PESOS_CERTIFICACION_CONTRATO.AA).toBe(0.5);
    expect(PESOS_CERTIFICACION_CONTRATO.ELECTRICO).toBe(0.4);
    expect(PESOS_CERTIFICACION_CONTRATO.GG).toBe(0.1);
    expect(
      PESOS_CERTIFICACION_CONTRATO.AA +
        PESOS_CERTIFICACION_CONTRATO.ELECTRICO +
        PESOS_CERTIFICACION_CONTRATO.GG,
    ).toBe(1);
  });

  it("tierFrecuenciaDesdeOt", () => {
    expect(tierFrecuenciaDesdeOt({ frecuencia_plan_mtsa: "M" })).toBe("M");
    expect(tierFrecuenciaDesdeOt({ frecuencia: "TRIMESTRAL" })).toBe("T");
    expect(tierFrecuenciaDesdeOt({ frecuencia: "UNICA" })).toBeNull();
  });

  it("plan acumulado trimestre mayo (mes 5, pos 2)", () => {
    expect(planAcumuladoEnPeriodo(11, 5, 3)).toBeCloseTo(7.333, 2);
  });

  it("certificación AA mayo: 36 mensuales = 100% en tier mensual", () => {
    const meta = METAS_CERTIFICACION_2026_DEFAULT.disciplinas.AA;
    const r = calcularCertificacionDisciplina(
      meta,
      {
        mes: { M: 36, T: 0, S: 0, A: 0 },
        acumTrim: 0,
        acumSem: 0,
        acumAnual: 0,
        totalMes: 36,
      },
      5,
    );
    expect(r.pct_mensual).toBe(1);
  });

  it("índice ponderado", () => {
    const porDisc = {
      AA: calcularCertificacionDisciplina(
        METAS_CERTIFICACION_2026_DEFAULT.disciplinas.AA,
        {
          mes: { M: 36, T: 0, S: 0, A: 0 },
          acumTrim: 0,
          acumSem: 0,
          acumAnual: 0,
          totalMes: 36,
        },
        5,
      ),
      ELECTRICO: calcularCertificacionDisciplina(
        METAS_CERTIFICACION_2026_DEFAULT.disciplinas.ELECTRICO,
        {
          mes: { M: 46, T: 0, S: 0, A: 0 },
          acumTrim: 0,
          acumSem: 0,
          acumAnual: 0,
          totalMes: 46,
        },
        5,
      ),
      GG: calcularCertificacionDisciplina(
        METAS_CERTIFICACION_2026_DEFAULT.disciplinas.GG,
        {
          mes: { M: 2, T: 0, S: 0, A: 0 },
          acumTrim: 0,
          acumSem: 0,
          acumAnual: 0,
          totalMes: 2,
        },
        5,
      ),
    };
    const idx = calcularIndiceCertificacion(porDisc);
    expect(idx).toBeGreaterThan(0.2);
    expect(idx).toBeLessThanOrEqual(1);
  });
});
