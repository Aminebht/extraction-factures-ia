import { cloudflareProvider } from "./cloudflare.ts";
import { mistralProvider } from "./mistral.ts";
import type { AiProvider } from "./types.ts";

export type { AiProvider, ChatMessage } from "./types.ts";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} manquante : renseignez-la dans .env (voir .env.example).`);
  return value;
}

/** Construit le fournisseur choisi par AI_PROVIDER (mistral par défaut). */
export function createProvider(): AiProvider {
  const provider = (process.env.AI_PROVIDER ?? "mistral").trim().toLowerCase();
  switch (provider) {
    case "mistral":
      return mistralProvider(required("MISTRAL_API_KEY"), process.env.MISTRAL_LLM_MODEL || "mistral-medium-latest");
    case "cloudflare":
      return cloudflareProvider(
        required("CLOUDFLARE_ACCOUNT_ID"),
        required("CLOUDFLARE_API_TOKEN"),
        process.env.CLOUDFLARE_LLM_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      );
    default:
      throw new Error(`AI_PROVIDER inconnu : « ${provider} » (valeurs possibles : mistral, cloudflare).`);
  }
}
