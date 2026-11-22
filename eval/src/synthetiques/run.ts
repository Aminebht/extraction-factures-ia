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

/** --seulement s12 : ne relance que les factures dont le nom contient ce motif (les autres gardent leur dernier résultat). */
function onlyFilter(): string | null {
  const i = process.argv.indexOf("--seulement");
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function extract(): Promise<BatchResult> {
  const ocr = createOcrProvider();
  const llm = createLlmProvider();
  const only = onlyFilter();
  const files = (await readdir(SYNTH_PDF_DIR))
    .filter((f) => f.endsWith(".pdf") && (!only || f.includes(only)))
    .sort()
    .map((f) => path.join(SYNTH_PDF_DIR, f));
  if (!files.length) throw new Error(only ? `Aucune facture synthétique ne correspond à « ${only} ».` : "Aucune facture synthétique : lancez d'abord `npm run eval:generer`.");
  console.log(`${files.length} facture(s) synthétique(s) · OCR ${ocr.name} · LLM ${llm.name}\n`);

  const batch = await processBatch(
    files,
    { ocr, llm, cache: diskOcrCache(config.ocrCacheDir), ocrConfidenceThreshold: config.ocrConfidenceThreshold },
    config.concurrency,
    (r) => console.log(`${r.status === "extracted" ? "·" : "✗"} ${r.source.fichier}${r.status === "failed" ? ` : ${r.error.message}` : ""}`),
  );

  // Relance partielle : on remplace seulement les factures relancées dans le dernier résultat.
  const previous = only ? await loadBatch(OUTPUT) : null;
  const merged: BatchResult = previous
    ? {
        generatedAt: batch.generatedAt,
        results: [
          ...previous.results.map((r) => batch.results.find((n) => n.source.fichier === r.source.fichier) ?? r),
          ...batch.results.filter((n) => !previous.results.some((r) => r.source.fichier === n.source.fichier)),
        ],
      }
    : batch;
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(BatchResult.parse(merged), null, 2));
  return merged;
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
