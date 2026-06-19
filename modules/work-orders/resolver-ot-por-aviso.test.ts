import { describe, expect, it } from "vitest";
import { coincideOtConNumeroAviso } from "@/modules/work-orders/resolver-ot-por-aviso";

describe("coincideOtConNumeroAviso", () => {
  it("empareja por aviso_numero, n_ot o variantes sin ceros", () => {
    expect(
      coincideOtConNumeroAviso(
        { id: "a", estado: "CERRADA", aviso_numero: "11374445", n_ot: "11374445" },
        "11374445",
      ),
    ).toBe(true);
    expect(
      coincideOtConNumeroAviso(
        { id: "b", estado: "CERRADA", aviso_numero: undefined, n_ot: "011374445" },
        "11374445",
      ),
    ).toBe(true);
    expect(
      coincideOtConNumeroAviso(
        { id: "c", estado: "CERRADA", aviso_numero: "11/374445", n_ot: "OT-99" },
        "11374445",
      ),
    ).toBe(true);
    expect(
      coincideOtConNumeroAviso(
        { id: "d", estado: "CERRADA", aviso_numero: "999", n_ot: "888" },
        "11374445",
      ),
    ).toBe(false);
  });
});
