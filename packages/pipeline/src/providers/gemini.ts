/**
 * OCR par Google Gemini (API gratuite d'AI Studio) : le modèle lit le PDF par vision et le transcrit
 * en markdown. On demande explicitement les images des pages seules (PAGE_IMAGE), pour ne pas lui
 * donner la couche texte du PDF (cf. facture HydroFluid).
 *
 * Pas de score de confiance par mot : aucun champ ne passera « à vérifier » avec ce fournisseur.
 * Usage de développement : le tier gratuit de Gemini peut servir à entraîner les modèles de Google.
 */
import { HttpError } from "../errors.ts";
import type { OcrResult } from "../ocr.ts";
import type { OcrProvider } from "./types.ts";

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

export function geminiOcr(apiKey: string, model: string): OcrProvider {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return {
    name: `gemini (${model})`,
    async ocr(pdf): Promise<OcrResult> {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
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
        }),
      });
      if (!response.ok) {
        throw new HttpError(response.status, response.headers, `Gemini ${response.status} : ${await response.text()}`);
      }
      const body = (await response.json()) as GeminiResponse;
      const candidate = body.candidates?.[0];
      const markdown = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!markdown.trim()) {
        throw new Error(`Gemini n'a renvoyé aucun texte (finishReason : ${candidate?.finishReason ?? "inconnu"})`);
      }
      return {
        model,
        pages: [{ index: 0, markdown, words: [], averageConfidence: null, minimumConfidence: null }],
      };
    },
  };
}
