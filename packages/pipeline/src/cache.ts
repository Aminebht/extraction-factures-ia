/**
 * Cache des réponses OCR sur disque, indexé par l'empreinte du contenu du PDF : un fichier renommé
 * n'est pas relu, un fichier modifié l'est. On ne met jamais en cache la réponse du LLM, pour que
 * chaque changement de prompt soit réellement testé.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OcrResult } from "./ocr.ts";

export const sha256 = (content: Buffer) => createHash("sha256").update(content).digest("hex");

export interface OcrCache {
  get(key: string): Promise<OcrResult | null>;
  set(key: string, result: OcrResult): Promise<void>;
}

export function diskOcrCache(dir: string): OcrCache {
  const file = (key: string) => path.join(dir, `${key}.json`);
  return {
    async get(hash) {
      try {
        return JSON.parse(await readFile(file(hash), "utf8")) as OcrResult;
      } catch {
        return null; // absent ou illisible : on relit le PDF
      }
    },
    async set(hash, result) {
      await mkdir(dir, { recursive: true });
      await writeFile(file(hash), JSON.stringify(result));
    },
  };
}

export const noOcrCache: OcrCache = { get: async () => null, set: async () => {} };
