import type { OcrResult } from "../ocr.ts";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Fournisseur d'IA : un OCR (PDF → texte) et un LLM à sortie structurée.
 * Choisi par AI_PROVIDER dans .env ; le reste du pipeline n'en dépend pas.
 */
export interface AiProvider {
  readonly name: string;
  ocr(pdf: Buffer, fileName: string): Promise<OcrResult>;
  /** Renvoie le texte brut de la réponse (JSON attendu), contraint par `schema`. */
  complete(messages: ChatMessage[], schema: Record<string, unknown>): Promise<string>;
}
