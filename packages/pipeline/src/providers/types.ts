import type { OcrResult } from "../ocr.ts";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Lecture du document : PDF → texte markdown (et confiance par mot si le fournisseur la donne). */
export interface OcrProvider {
  readonly name: string;
  ocr(pdf: Buffer, fileName: string): Promise<OcrResult>;
}

/** Structuration : renvoie le texte brut de la réponse (JSON attendu), contraint par `schema`. */
export interface LlmProvider {
  readonly name: string;
  complete(messages: ChatMessage[], schema: Record<string, unknown>): Promise<string>;
}
