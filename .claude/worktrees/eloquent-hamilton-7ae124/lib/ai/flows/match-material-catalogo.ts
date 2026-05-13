import { ai } from "@/lib/ai/genkit";
import { z } from "genkit";

const InputSchema = z.object({
  textoOriginal: z.string(),
  especialidad: z.string(),
  cantidad: z.number(),
  unidad: z.string(),
  catalogoSnapshot: z.array(
    z.object({
      id: z.string(),
      codigo_material: z.string(),
      descripcion: z.string(),
      unidad_medida: z.string(),
    }),
  ),
});

const OutputSchema = z.object({
  matchEncontrado: z.boolean(),
  catalogoId: z.string().optional(),
  codigoMaterial: z.string().optional(),
  descripcionMatch: z.string().optional(),
  confianza: z.number(),
  nombreNormalizado: z.string(),
});

export type MatchMaterialCatalogoInput = z.infer<typeof InputSchema>;

const systemRules = `
Sos un asistente de mantenimiento industrial en Argentina.
Tu tarea es encontrar el mejor match entre un texto libre escrito por un técnico
y un catálogo de materiales existente.

Reglas:
1. Devolvé SOLO datos que cumplan el esquema de salida; sin markdown.
2. Considerá equivalentes: abreviaturas (cap=capacitor), unidades (uf=µF=microfarad,
   mm=milímetro), errores tipográficos comunes, ausencia de tildes.
3. confianza >= 0.85 = match seguro. Entre 0.6 y 0.85 = posible, requiere revisión.
   Menor a 0.6 = no hay match confiable.
4. Si hay match seguro, completá catalogoId y codigoMaterial del ítem del catálogo.
5. Si no hay match, matchEncontrado: false y nombreNormalizado con el texto limpio.
6. Especialidad A = Aire acondicionado, E = Eléctrico, GG = Grupos generadores.
`.trim();

const matchMaterialCatalogoFlow = ai.defineFlow(
  {
    name: "matchMaterialCatalogoFlow",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
  },
  async (input) => {
    const fallback = {
      matchEncontrado: false,
      confianza: 0,
      nombreNormalizado: input.textoOriginal.trim(),
    };
    const catalogoJson = JSON.stringify(input.catalogoSnapshot);
    const userPayload = [
      `textoOriginal: ${input.textoOriginal}`,
      `especialidad: ${input.especialidad}`,
      `cantidad: ${input.cantidad}`,
      `unidad: ${input.unidad}`,
      `catalogoSnapshot: ${catalogoJson}`,
    ].join("\n");

    try {
      const raced = await Promise.race([
        ai.generate({
          model: "googleai/gemini-1.5-flash",
          prompt: `${systemRules}\n\n${userPayload}`,
          output: { schema: OutputSchema },
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("timeout_match_material")), 8000);
        }),
      ]);

      const output = raced.output;
      if (!output) return fallback;
      return {
        matchEncontrado: output.matchEncontrado,
        catalogoId: output.catalogoId,
        codigoMaterial: output.codigoMaterial,
        descripcionMatch: output.descripcionMatch,
        confianza: Number.isFinite(output.confianza) ? output.confianza : 0,
        nombreNormalizado: output.nombreNormalizado || input.textoOriginal.trim(),
      };
    } catch {
      return fallback;
    }
  },
);

export async function runMatchMaterialCatalogo(input: MatchMaterialCatalogoInput) {
  return matchMaterialCatalogoFlow(input);
}
