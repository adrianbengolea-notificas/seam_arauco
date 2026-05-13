import { describe, expect, it } from "vitest";
import { MOTOR_PROPUESTA_MAX_ADVERTENCIAS } from "@/lib/config/limits";
import { mergeAdvertenciasAcotadas } from "@/lib/motor/advertencias-merge";

describe("mergeAdvertenciasAcotadas", () => {
  it("mantiene sólo las últimas N entradas", () => {
    const prev = Array.from({ length: MOTOR_PROPUESTA_MAX_ADVERTENCIAS }, (_, i) => `p${i}`);
    const nuevas = ["a", "b"];
    const out = mergeAdvertenciasAcotadas(prev, nuevas);
    expect(out.length).toBe(MOTOR_PROPUESTA_MAX_ADVERTENCIAS);
    expect(out[out.length - 1]).toBe("b");
    expect(out[out.length - 2]).toBe("a");
  });

  it("filtra elementos no string del historial", () => {
    const out = mergeAdvertenciasAcotadas(["ok", 1, null, "x"], ["y"]);
    expect(out).toEqual(["ok", "x", "y"]);
  });
});
