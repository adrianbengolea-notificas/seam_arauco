import { ai } from "@/lib/ai/genkit";
import { z } from "genkit";

const OutputSchema = z.object({
  observaciones: z
    .string()
    .describe("Observaciones redactadas en español, tono profesional rioplatense, sin inventar hechos."),
});

export type TranscribePlanillaObservacionesInput = {
  audioDataUrl: string;
  otN: string;
  assetLabel: string;
};

export async function runTranscribePlanillaObservaciones(input: TranscribePlanillaObservacionesInput) {
  const res = await ai.generate({
    prompt: [
      {
        text: `Sos asistente para planillas de mantenimiento industrial. Vas a recibir un audio grabado por un técnico.

Contexto:
- OT n.º: ${input.otN}
- Activo / ubicación: ${input.assetLabel}

Instrucciones:
1. Escuchá el audio y transcribí con fidelidad lo dicho (español).
2. Redactá el resultado como texto de "observaciones" para una planilla: claro, profesional, en español rioplatense, sin agregar datos que no surjan del audio.
3. Si el audio está vacío o es ininteligible, devolvé observaciones vacías o una frase breve pidiendo repetir la grabación.

Respondé únicamente con el objeto JSON según el esquema (campo observaciones).`,
      },
      { media: { url: input.audioDataUrl } },
    ],
    output: { schema: OutputSchema },
  });

  const out = res.output;
  if (!out?.observaciones?.trim()) {
    throw new Error("No se pudo obtener texto del audio");
  }
  return out.observaciones.trim();
}
