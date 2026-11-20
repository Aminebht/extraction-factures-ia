/**
 * Cloudflare Workers AI, via l'API REST.
 * - OCR : toMarkdown. Attention : pour un PDF, il lit la couche texte du fichier (pas de vrai OCR),
 *   donc pas de score de confiance, et un scan sans couche texte ne donne rien.
 * - LLM : /ai/run/{modèle} en mode JSON (response_format json_schema).
 */
import { HttpError } from "../errors.ts";
import type { OcrResult } from "../ocr.ts";
import type { AiProvider } from "./types.ts";

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { message: string }[];
}

export function cloudflareProvider(accountId: string, apiToken: string, llmModel: string): AiProvider {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`;
  const headers = { Authorization: `Bearer ${apiToken}` };

  async function call<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
    if (!response.ok) {
      throw new HttpError(response.status, response.headers, `Cloudflare ${response.status} : ${await response.text()}`);
    }
    const body = (await response.json()) as CloudflareEnvelope<T>;
    if (!body.success) throw new Error(`Cloudflare : ${body.errors?.map((e) => e.message).join(", ")}`);
    return body.result;
  }

  return {
    name: `cloudflare (${llmModel})`,

    async ocr(pdf, fileName): Promise<OcrResult> {
      const form = new FormData();
      form.append("files", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), fileName);
      const [doc] = await call<{ format: string; data?: string; error?: string }[]>(`${base}/tomarkdown`, {
        method: "POST",
        body: form,
      });
      if (!doc || doc.format === "error" || !doc.data?.trim()) {
        throw new Error(`toMarkdown n'a extrait aucun texte${doc?.error ? ` : ${doc.error}` : ""}`);
      }
      return {
        model: "cloudflare-tomarkdown",
        pages: [{ index: 0, markdown: doc.data, words: [], averageConfidence: null, minimumConfidence: null }],
      };
    },

    async complete(messages, schema) {
      const result = await call<{ response: unknown }>(`${base}/run/${llmModel}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          temperature: 0,
          max_tokens: 4096,
          response_format: { type: "json_schema", json_schema: schema },
        }),
      });
      // En mode JSON, la réponse est un objet ; on la remet en texte pour la validation commune.
      return typeof result.response === "string" ? result.response : JSON.stringify(result.response);
    },
  };
}
