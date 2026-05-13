import { ai } from "@/lib/ai/genkit";
import { z } from "genkit";

const InputSchema = z.object({
  keywords: z.string().describe("Palabras clave o borrador del técnico."),
  fieldType: z
    .enum(["trabajo_realizado", "observaciones"])
    .describe("Tipo de texto a generar."),
  assetLabel: z.string().describe("Etiqueta corta del activo (código y ubicación)."),
  otN: z.string().describe("Número de orden de trabajo."),
});

const OutputSchema = z.object({
  generatedText: z.string().describe("Texto listo para el informe."),
});

export type GenerateWorkReportInput = z.infer<typeof InputSchema>;

const prompt = ai.definePrompt({
  name: "araucoSeamWorkReportPrompt",
  input: { schema: InputSchema },
  output: { schema: OutputSchema },
  prompt: `
Eres asistente de redacción para técnicos de mantenimiento industrial en español rioplatense (profesional, claro).

Contexto:
- Orden de trabajo: {{{otN}}}
- Activo / ubicación: {{{assetLabel}}}
- Tipo de campo: {{{fieldType}}}
- Aporte del técnico: {{{keywords}}}

Instrucciones:
1. Si fieldType es "trabajo_realizado", redactá el trabajo ejecutado en tono de informe (pasos, hallazgos, repuestos mencionados en las palabras clave si las hay).
2. Si fieldType es "observaciones", redactá observaciones, recomendaciones o seguimiento.
3. No inventes repuestos, mediciones ni procedimientos que no se desprendan del aporte del técnico.
4. Devolvé solo el texto del informe, sin encabezados ni comillas.

Generá el texto para el caso dado.
`,
});

const generateWorkReportFlow = ai.defineFlow(
  {
    name: "generateWorkReportFlow",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
  },
  async (input) => {
    try {
      const { output } = await prompt(input);
      if (!output?.generatedText) {
        throw new Error("Salida vacía");
      }
      return output;
    } catch (e) {
      console.error("[Genkit] generateWorkReportFlow", e);
      return { generatedText: input.keywords };
    }
  },
);

export async function runGenerateWorkReport(input: GenerateWorkReportInput) {
  return generateWorkReportFlow(input);
}
