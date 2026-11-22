/**
 * Cloudflare Workers AI, via l'API REST.
 * - OCR : toMarkdown. Attention : pour un PDF, il lit la couche texte du fichier (pas de vrai OCR),
 *   donc pas de score de confiance, et un scan sans couche texte ne donne rien.
 * - LLM : /ai/run/{modèle} avec sortie JSON contrainte. Selon le modèle, le schéma passe par
 *   `guided_json` (ex. @cf/mistralai/mistral-small-3.1-24b-instruct) ou `response_format`.
 */
import { HttpError } from "../errors.ts";
import type { OcrResult } from "../ocr.ts";
import type { LlmProvider, OcrProvider } from "./types.ts";

/** Modèles Workers AI qui prennent le schéma JSON via `guided_json` plutôt que `response_format`. */
const GUIDED_JSON_MODELS = [/^@cf\/mistralai\/mistral-small/];

export function jsonConstraint(model: string, schema: Record<string, unknown>): Record<string, unknown> {
  return GUIDED_JSON_MODELS.some((re) => re.test(model))
    ? { guided_json: schema }
    : { response_format: { type: "json_schema", json_schema: schema } };
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { message: string }[];
}

function cloudflareClient(accountId: string, apiToken: string) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`;
  return async function call<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiToken}`, ...init.headers },
    });
    if (!response.ok) {
      throw new HttpError(response.status, response.headers, `Cloudflare ${response.status} : ${await response.text()}`);
    }
    const body = (await response.json()) as CloudflareEnvelope<T>;
    if (!body.success) throw new Error(`Cloudflare : ${body.errors?.map((e) => e.message).join(", ")}`);
    return body.result;
  };
}

export function cloudflareOcr(accountId: string, apiToken: string): OcrProvider {
  const call = cloudflareClient(accountId, apiToken);
  return {
    name: "cloudflare-tomarkdown",
    async ocr(pdf, fileName): Promise<OcrResult> {
      const form = new FormData();
      form.append("files", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), fileName);
      const [doc] = await call<{ format: string; data?: string; error?: string }[]>("/tomarkdown", {
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
  };
}

export function cloudflareLlm(accountId: string, apiToken: string, model: string): LlmProvider {
  const call = cloudflareClient(accountId, apiToken);
  return {
    name: `cloudflare (${model})`,
    async complete(messages, schema) {
      const result = await call<{ response: unknown }>(`/run/${model}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          temperature: 0,
          // Défaut Workers AI : 256, trop court. Une citation par champ allonge la réponse : au-delà
          // d'une trentaine de lignes, Cloudflare tronque (limite de tokens) ou abandonne (408).
          max_tokens: 8192,
          ...jsonConstraint(model, schema),
        }),
      });
      // En mode JSON, la réponse peut être un objet : on la remet en texte pour la validation commune.
      return typeof result.response === "string" ? result.response : JSON.stringify(result.response);
    },
  };
}
