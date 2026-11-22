/**
 * Google Gemini (API gratuite d'AI Studio), pour l'OCR et pour le LLM.
 *
 * OCR : le modèle lit le PDF par vision et le transcrit en markdown. On demande explicitement les
 * images des pages seules (PAGE_IMAGE), pour ne pas lui donner la couche texte du PDF (cf. facture
 * HydroFluid). Pas de score de confiance par mot : aucun champ ne passera « à vérifier ».
 *
 * LLM : sortie JSON contrainte par le schéma (responseJsonSchema) ; si l'API refuse ce paramètre,
 * repli sur le schéma dans le prompt, la validation Zod du pipeline restant la garantie.
 *
 * Usage de développement : le tier gratuit de Gemini peut servir à entraîner les modèles de Google.
 */
import { HttpError } from "../errors.ts";
import type { OcrResult } from "../ocr.ts";
import type { ChatMessage, LlmProvider, OcrProvider } from "./types.ts";

export const GEMINI_OCR_PROMPT = `Transcris fidèlement en Markdown tout le texte visible de ce document.
- Recopie exactement ce qui est écrit : mêmes mots, mêmes nombres (espaces, virgules, symboles €), même ordre.
  Ne corrige rien, ne calcule rien, ne résume rien, n'ajoute rien.
- Reproduis les tableaux sous forme de tableaux Markdown, une ligne du document par ligne du tableau.
- Signale les annotations manuscrites entre crochets : [manuscrit : …], et les tampons : [tampon : …].
- Si un passage est illisible ou masqué, écris [illisible] au lieu de le deviner.
- Réponds uniquement avec la transcription.`;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
}

/** Appel generateContent ; renvoie le texte de la réponse. */
async function generate(apiKey: string, model: string, body: Record<string, unknown>): Promise<string> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new HttpError(response.status, response.headers, `Gemini ${response.status} : ${await response.text()}`);
  }
  const data = (await response.json()) as GeminiResponse;
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) {
    throw new Error(`Gemini n'a renvoyé aucun texte (finishReason : ${candidate?.finishReason ?? "inconnu"})`);
  }
  return text;
}

export function geminiOcr(apiKey: string, model: string): OcrProvider {
  return {
    name: `gemini (${model})`,
    async ocr(pdf): Promise<OcrResult> {
      const markdown = await generate(apiKey, model, {
        contents: [
          {
            parts: [
              {
                inlineData: { mimeType: "application/pdf", data: pdf.toString("base64") },
                documentMetadata: { contentLayers: ["PAGE_IMAGE"] },
              },
              { text: GEMINI_OCR_PROMPT },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      });
      return {
        model,
        pages: [{ index: 0, markdown, words: [], averageConfidence: null, minimumConfidence: null }],
      };
    },
  };
}

/** Messages au format Gemini : le message système à part, « assistant » devient « model ». */
export function toGeminiContents(messages: ChatMessage[]) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  return { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents };
}

export function geminiLlm(apiKey: string, model: string, maxOutputTokens: number): LlmProvider {
  let jsonSchemaSupported = true;
  return {
    name: `gemini (${model})`,
    async complete(messages, schema) {
      const base = { temperature: 0, maxOutputTokens, responseMimeType: "application/json" };
      if (jsonSchemaSupported) {
        try {
          return await generate(apiKey, model, {
            ...toGeminiContents(messages),
            generationConfig: { ...base, responseJsonSchema: schema },
          });
        } catch (error) {
          if (!(error instanceof HttpError) || error.statusCode !== 400) throw error;
          jsonSchemaSupported = false; // schéma refusé par l'API : repli sur le prompt
        }
      }
      const withSchema: ChatMessage[] = [
        ...messages.slice(0, -1),
        {
          role: "user",
          content: `${messages.at(-1)?.content ?? ""}\n\nRéponds uniquement avec un objet JSON conforme à ce schéma :\n${JSON.stringify(schema)}`,
        },
      ];
      return generate(apiKey, model, { ...toGeminiContents(withSchema), generationConfig: base });
    },
  };
}
