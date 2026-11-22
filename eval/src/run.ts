/**
 * npm run eval
 *
 * 1. Filet de sécurité (hors ligne) : erreurs injectées dans des extractions correctes.
 * 2. Si output/results.json existe : notation du dernier passage du pipeline contre la vérité terrain,
 *    avec, pour chaque erreur, sa cause probable (OCR ou LLM) d'après le texte OCR en cache.
 *
 * Écrit aussi eval/report.md. Les factures synthétiques ont leur propre commande (eval:synthetiques).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@juwa/pipeline/config.ts";
import { loadCases } from "./cases.ts";
import { runFilet } from "./filet.ts";
import { errorsSection, filetSection, loadBatch, metricsSection } from "./report.ts";
import { aggregate, scoreCase } from "./scoring.ts";

async function main() {
  const cases = await loadCases();
  const report = ["# Rapport d'évaluation", "", ...filetSection(runFilet(cases)), ""];

  const batch = await loadBatch(config.outputPath);
  if (!batch) {
    report.push("## Dernier passage du pipeline", "", "Aucun résultat trouvé : lancez `npm run pipeline`, puis `npm run eval`.");
  } else {
    const scores = cases.map((c) => scoreCase(c, batch.results.find((r) => r.source.fichier === c.fichier)));
    report.push(
      ...metricsSection("Dernier passage du pipeline contre la vérité terrain", aggregate(scores), batch.generatedAt),
      ...(await errorsSection(scores, batch)),
    );
  }

  const markdown = `${report.join("\n")}\n`;
  console.log(markdown);
  await writeFile(path.resolve(import.meta.dirname, "../report.md"), markdown);
  console.log("Rapport écrit dans eval/report.md");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
