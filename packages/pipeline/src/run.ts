/**
 * Point d'entrée : traite toutes les factures PDF du dossier configuré et écrit le résultat
 * lu par l'interface.
 *
 *   npm run pipeline [-- --no-cache]
 */
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BatchResult, type InvoiceResult } from "@juwa/schema";
import { diskOcrCache, noOcrCache } from "./cache.ts";
import { ROOT_DIR, config } from "./config.ts";
import { processBatch } from "./pipeline.ts";
import { createLlmProvider, createOcrProvider } from "./providers/index.ts";

function summarize(result: InvoiceResult): string {
  if (result.status === "failed") return `✗ ${result.source.fichier} : ÉCHEC (${result.error.kind}) ${result.error.message}`;
  const blocking = result.warnings.filter((w) => w.severity === "bloquant").length;
  const attention = result.warnings.length - blocking;
  const icon = blocking ? "⚠" : attention ? "•" : "✓";
  return `${icon} ${result.source.fichier} : ${blocking} écart(s), ${attention} point(s) à vérifier`;
}

async function main() {
  const ocr = createOcrProvider();
  const llm = createLlmProvider();
  const useCache = !process.argv.includes("--no-cache");
  const files = (await readdir(config.invoicesDir))
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort()
    .map((f) => path.join(config.invoicesDir, f));

  if (!files.length) {
    console.error(`Aucun PDF trouvé dans ${path.relative(ROOT_DIR, config.invoicesDir)}.`);
    process.exit(1);
  }
  console.log(
    `${files.length} facture(s) · OCR ${ocr.name} · LLM ${llm.name} · concurrence ${config.concurrency}${useCache ? "" : " · sans cache"}\n`,
  );

  const batch = await processBatch(
    files,
    {
      ocr,
      llm,
      cache: useCache ? diskOcrCache(config.ocrCacheDir) : noOcrCache,
      ocrConfidenceThreshold: config.ocrConfidenceThreshold,
    },
    config.concurrency,
    (result) => console.log(summarize(result)),
  );

  // Garde-fou : on n'écrit jamais un fichier que l'interface rejetterait.
  const json = JSON.stringify(BatchResult.parse(batch), null, 2);
  await mkdir(path.dirname(config.outputPath), { recursive: true });
  await writeFile(config.outputPath, json);

  // L'interface lit le résultat et affiche les PDF depuis son dossier public.
  const pdfDir = path.join(config.webPublicDir, "factures");
  await mkdir(pdfDir, { recursive: true });
  await writeFile(path.join(config.webPublicDir, "results.json"), json);
  await Promise.all(files.map((f) => copyFile(f, path.join(pdfDir, path.basename(f)))));

  console.log(`\nRésultat : ${path.relative(ROOT_DIR, config.outputPath)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
