/**
 * npm run eval:synthetiques [-- --rescorer]
 *
 * Passe les factures synthétiques dans la chaîne complète (OCR + LLM + ancrage + contrôles, avec les
 * fournisseurs configurés dans .env), puis note le résultat contre leur vérité terrain.
 * --rescorer : note le dernier résultat (output/synthetiques.json) sans rappeler les API.
 *
 * N'écrase ni output/results.json ni l'interface : ces factures servent à mesurer, pas au comptable.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BatchResult } from "@juwa/schema";
import { diskOcrCache } from "@juwa/pipeline/cache.ts";
import { ROOT_DIR, config } from "@juwa/pipeline/config.ts";
import { processBatch } from "@juwa/pipeline/pipeline.ts";
import { createLlmProvider, createOcrProvider } from "@juwa/pipeline/providers/index.ts";
import { loadCases } from "../cases.ts";
import { errorsSection, loadBatch, metricsSection, trapsSection } from "../report.ts";
import { aggregate, scoreCase } from "../scoring.ts";
import { SYNTH_CASES_DIR, SYNTH_PDF_DIR } from "./generate.ts";
import { htmlReport } from "./html.ts";

const OUTPUT = path.join(ROOT_DIR, "output", "synthetiques.json");

async function extract(): Promise<BatchResult> {
  const ocr = createOcrProvider();
  const llm = createLlmProvider();
  const files = (await readdir(SYNTH_PDF_DIR)).filter((f) => f.endsWith(".pdf")).sort().map((f) => path.join(SYNTH_PDF_DIR, f));
  if (!files.length) throw new Error("Aucune facture synthétique : lancez d'abord `npm run eval:generer`.");
  console.log(`${files.length} factures synthétiques · OCR ${ocr.name} · LLM ${llm.name}\n`);

  const batch = await processBatch(
    files,
    { ocr, llm, cache: diskOcrCache(config.ocrCacheDir), ocrConfidenceThreshold: config.ocrConfidenceThreshold },
    config.concurrency,
    (r) => console.log(`${r.status === "extracted" ? "·" : "✗"} ${r.source.fichier}`),
  );
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(BatchResult.parse(batch), null, 2));
  return batch;
}

async function main() {
  const batch = process.argv.includes("--rescorer") ? await loadBatch(OUTPUT) : await extract();
  if (!batch) throw new Error("Aucun résultat synthétique : lancez `npm run eval:synthetiques` sans --rescorer.");

  const cases = await loadCases(SYNTH_CASES_DIR);
  const scores = cases.map((c) => scoreCase(c, batch.results.find((r) => r.source.fichier === c.fichier)));
  const report = [
    "# Factures synthétiques à pièges contrôlés",
    "",
    "Factures générées par `eval/src/synthetiques/` : chacune isole un piège ; la vérité terrain est produite à partir des mêmes données que le PDF.",
    "",
    ...metricsSection("Chaîne complète contre la vérité terrain", aggregate(scores), batch.generatedAt),
    ...trapsSection(cases, scores),
    ...(await errorsSection(scores, batch)),
  ];
  const markdown = `${report.join("\n")}\n`;
  console.log(`\n${markdown}`);
  await writeFile(path.resolve(import.meta.dirname, "../../report-synthetiques.md"), markdown);
  const html = await htmlReport(cases, scores, batch, aggregate(scores), SYNTH_PDF_DIR);
  await writeFile(path.resolve(import.meta.dirname, "../../report-synthetiques.html"), html);
  console.log("Rapports écrits dans eval/report-synthetiques.md et eval/report-synthetiques.html (à ouvrir dans un navigateur)");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
