import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";

/**
 * Requiere `GOOGLE_GENAI_API_KEY` o variable compatible con el plugin Google AI de Genkit.
 * @see https://genkit.dev
 */
export const ai = genkit({
  plugins: [googleAI()],
  model: "googleai/gemini-2.0-flash",
});
