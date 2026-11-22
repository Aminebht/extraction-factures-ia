/**
 * Choix des fournisseurs, indépendamment pour l'OCR (OCR_PROVIDER) et pour le LLM (LLM_PROVIDER).
 * Mistral par défaut pour les deux : c'est la configuration exigée par le sujet.
 */
import { cloudflareLlm, cloudflareOcr } from "./cloudflare.ts";
import { geminiLlm, geminiOcr } from "./gemini.ts";
import { mistralLlm, mistralOcr } from "./mistral.ts";
import type { LlmProvider, OcrProvider } from "./types.ts";

export type { ChatMessage, LlmProvider, OcrProvider } from "./types.ts";

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} manquante : renseignez-la dans .env (voir .env.example).`);
  return value;
}

const choice = (name: string) => (process.env[name]?.trim().toLowerCase() || "mistral");

export function createOcrProvider(): OcrProvider {
  const provider = choice("OCR_PROVIDER");
  switch (provider) {
    case "mistral":
      return mistralOcr(env("MISTRAL_API_KEY"));
    case "gemini":
      return geminiOcr(env("GEMINI_API_KEY"), process.env.GEMINI_OCR_MODEL?.trim() || "gemini-3.8-flash");
    case "cloudflare":
      return cloudflareOcr(env("CLOUDFLARE_ACCOUNT_ID"), env("CLOUDFLARE_API_TOKEN"));
    default:
      throw new Error(`OCR_PROVIDER inconnu : « ${provider} » (valeurs possibles : mistral, gemini, cloudflare).`);
  }
}

export function createLlmProvider(): LlmProvider {
  const provider = choice("LLM_PROVIDER");
  switch (provider) {
    case "mistral":
      return mistralLlm(env("MISTRAL_API_KEY"), process.env.MISTRAL_LLM_MODEL?.trim() || "mistral-medium-latest");
    case "cloudflare":
      return cloudflareLlm(
        env("CLOUDFLARE_ACCOUNT_ID"),
        env("CLOUDFLARE_API_TOKEN"),
        process.env.CLOUDFLARE_LLM_MODEL?.trim() || "@cf/mistralai/mistral-small-3.1-24b-instruct",
      );
    case "gemini":
      return geminiLlm(
        env("GEMINI_API_KEY"),
        process.env.GEMINI_LLM_MODEL?.trim() || "gemini-3.8-flash",
        Number(process.env.GEMINI_MAX_TOKENS) || 32768,
      );
    default:
      throw new Error(`LLM_PROVIDER inconnu : « ${provider} » (valeurs possibles : mistral, gemini, cloudflare).`);
  }
}
