import type { Mistral } from "@mistralai/mistralai";

export const OCR_MODEL = "mistral-ocr-latest";

/** Confiance OCR d'un mot, positionné dans le markdown de sa page. */
export interface OcrWord {
  text: string;
  confidence: number;
  /** Index du premier caractère du mot dans `OcrPage.markdown`. */
  start: number;
}

export interface OcrPage {
  index: number;
  markdown: string;
  words: OcrWord[];
  averageConfidence: number | null;
  minimumConfidence: number | null;
}

export interface OcrResult {
  model: string;
  pages: OcrPage[];
}

/**
 * Lit un PDF avec Mistral OCR. On envoie le PDF entier : l'OCR travaille sur le rendu visuel,
 * et l'on n'utilise jamais la couche texte du fichier (cf. facture HydroFluid).
 */
export async function runOcr(client: Mistral, pdf: Buffer): Promise<OcrResult> {
  const response = await client.ocr.process({
    model: OCR_MODEL,
    document: {
      type: "document_url",
      documentUrl: `data:application/pdf;base64,${pdf.toString("base64")}`,
    },
    includeImageBase64: false,
    confidenceScoresGranularity: "word",
  });

  return {
    model: response.model,
    pages: response.pages.map((page) => ({
      index: page.index,
      markdown: page.markdown,
      words: (page.confidenceScores?.wordConfidenceScores ?? []).map((w) => ({
        text: w.text,
        confidence: w.confidence,
        start: w.startIndex,
      })),
      averageConfidence: page.confidenceScores?.averagePageConfidenceScore ?? null,
      minimumConfidence: page.confidenceScores?.minimumPageConfidenceScore ?? null,
    })),
  };
}
