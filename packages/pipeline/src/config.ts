import { existsSync } from "node:fs";
import path from "node:path";

/** Racine du monorepo (là où se trouvent `.env` et `factures/`). */
export const ROOT_DIR = path.resolve(import.meta.dirname, "../../..");

const envFile = path.join(ROOT_DIR, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = {
  invoicesDir: path.resolve(ROOT_DIR, process.env.INVOICES_DIR || "factures"),
  outputPath: path.resolve(ROOT_DIR, process.env.OUTPUT_PATH || "output/results.json"),
  /** Dossier public de l'interface : le pipeline y copie le résultat et les PDF. */
  webPublicDir: path.resolve(ROOT_DIR, "packages/web/public"),
  ocrCacheDir: path.resolve(ROOT_DIR, ".cache/ocr"),
  concurrency: number("CONCURRENCY", 2),
  ocrConfidenceThreshold: number("OCR_CONFIDENCE_THRESHOLD", 0.8),
};
