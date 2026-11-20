import { existsSync } from "node:fs";
import path from "node:path";

/** Racine du monorepo (là où se trouvent `.env` et `factures/`). */
export const ROOT_DIR = path.resolve(import.meta.dirname, "../../..");

const envFile = path.join(ROOT_DIR, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function requireApiKey(): string {
  const key = process.env.MISTRAL_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "MISTRAL_API_KEY manquante : copiez .env.example en .env et renseignez votre clé Mistral.",
    );
  }
  return key;
}
