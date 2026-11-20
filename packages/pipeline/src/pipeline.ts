/**
 * Orchestration : une facture = OCR → LLM → Zod → ancrage → contrôles métier.
 * `processInvoice` ne lève jamais d'exception : un échec devient un résultat « failed »,
 * si bien qu'une facture en erreur ne peut pas faire tomber le traitement des autres.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BatchResult, InvoiceResult, Source } from "@juwa/schema";
import pLimit from "p-limit";
import { sha256, type OcrCache } from "./cache.ts";
import { runBusinessChecks } from "./checks.ts";
import { PipelineError, toPipelineError } from "./errors.ts";
import { certifyInvoice } from "./grounding.ts";
import { extractWithLlm } from "./llm.ts";
import type { OcrResult } from "./ocr.ts";
import type { LlmProvider, OcrProvider } from "./providers/index.ts";
import { DEFAULT_RETRY, withRetry, type RetryOptions } from "./retry.ts";

export interface PipelineDeps {
  ocr: OcrProvider;
  llm: LlmProvider;
  cache: OcrCache;
  ocrConfidenceThreshold: number;
  retry?: RetryOptions;
}

function failed(source: Source, error: PipelineError): InvoiceResult {
  return { status: "failed", source, error: { kind: error.kind, message: error.message } };
}

/** Clé de cache : contenu du PDF + fournisseur OCR (changer d'OCR ne réutilise pas l'ancienne lecture). */
export const ocrCacheKey = (sha256: string, ocrName: string) => `${sha256}.${ocrName.replace(/[^a-z0-9.-]+/gi, "_")}`;

async function ocrWithCache(pdf: Buffer, hash: string, fileName: string, deps: PipelineDeps): Promise<OcrResult> {
  const key = ocrCacheKey(hash, deps.ocr.name);
  const cached = await deps.cache.get(key);
  if (cached) return cached;
  const result = await withRetry(() => deps.ocr.ocr(pdf, fileName), deps.retry ?? DEFAULT_RETRY);
  if (!result.pages.some((p) => p.markdown.trim())) {
    throw new PipelineError("OCR", "Aucun texte n'a pu être lu sur ce document.");
  }
  await deps.cache.set(key, result);
  return result;
}

export async function processInvoice(filePath: string, deps: PipelineDeps): Promise<InvoiceResult> {
  const fichier = path.basename(filePath);

  let pdf: Buffer;
  try {
    pdf = await readFile(filePath);
  } catch {
    return failed({ fichier, sha256: "" }, new PipelineError("FICHIER_ILLISIBLE", "Le fichier est introuvable ou illisible."));
  }
  const source: Source = { fichier, sha256: sha256(pdf) };
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return failed(source, new PipelineError("FICHIER_ILLISIBLE", "Le fichier n'est pas un PDF valide."));
  }

  let ocr: OcrResult;
  try {
    ocr = await ocrWithCache(pdf, source.sha256, fichier, deps);
  } catch (error) {
    return failed(source, toPipelineError(error, "OCR"));
  }

  try {
    const llmInvoice = await extractWithLlm(deps.llm, ocr, deps.retry);
    const { invoice, warnings } = certifyInvoice(llmInvoice, ocr, deps.ocrConfidenceThreshold);
    return { status: "extracted", source, invoice, warnings: [...warnings, ...runBusinessChecks(invoice)] };
  } catch (error) {
    return failed(source, toPipelineError(error, "LLM"));
  }
}

/** Traite un lot de factures en parallèle, avec une limite de concurrence. */
export async function processBatch(
  filePaths: string[],
  deps: PipelineDeps,
  concurrency: number,
  onDone?: (result: InvoiceResult) => void,
): Promise<BatchResult> {
  const limit = pLimit(concurrency);
  const results = await Promise.all(
    filePaths.map((file) =>
      limit(async () => {
        const result = await processInvoice(file, deps);
        onDone?.(result);
        return result;
      }),
    ),
  );
  return { generatedAt: new Date().toISOString(), results };
}
