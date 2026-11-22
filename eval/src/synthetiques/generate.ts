/**
 * npm run eval:generer
 *
 * Génère les factures synthétiques (PDF) et leur vérité terrain (YAML) dans eval/synthetiques/ :
 * - s* : PDF natifs, chacun isolant un piège de contenu ;
 * - d* : variantes « scannées » de certaines d'entre elles (image abîmée, sans couche texte).
 * La vérité terrain est produite à partir des mêmes données que le PDF : exacte par construction.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import type { EvalCase } from "../cases.ts";
import { compute, degradedGroundTruth, groundTruth } from "./compute.ts";
import { degradePdf } from "./degrade.ts";
import { renderPdf } from "./render.ts";
import { DEGRADED, SPECS } from "./specs.ts";

export const SYNTH_DIR = path.resolve(import.meta.dirname, "../../synthetiques");
export const SYNTH_PDF_DIR = path.join(SYNTH_DIR, "factures");
export const SYNTH_CASES_DIR = path.join(SYNTH_DIR, "cas");

export const caseFile = (id: string, piege: string, truth: EvalCase) =>
  `# Généré par eval/src/synthetiques/generate.ts : ne pas modifier à la main.\n# Piège : ${piege}\n${stringify(truth)}`;

async function main() {
  await rm(SYNTH_DIR, { recursive: true, force: true });
  await mkdir(SYNTH_PDF_DIR, { recursive: true });
  await mkdir(SYNTH_CASES_DIR, { recursive: true });

  for (const spec of SPECS) {
    const computed = compute(spec);
    await renderPdf(spec, computed, path.join(SYNTH_PDF_DIR, `${spec.id}.pdf`));
    await writeFile(path.join(SYNTH_CASES_DIR, `${spec.id}.yaml`), caseFile(spec.id, spec.piege, groundTruth(spec, computed)));
    console.log(`✓ ${spec.id.padEnd(24)} ${spec.piege}`);
  }

  for (const d of DEGRADED) {
    const source = SPECS.find((s) => s.id === d.source);
    if (!source) throw new Error(`Facture d'origine inconnue pour ${d.id} : ${d.source}`);
    await degradePdf(path.join(SYNTH_PDF_DIR, `${source.id}.pdf`), path.join(SYNTH_PDF_DIR, `${d.id}.pdf`), d.degradation, d.id);
    await writeFile(path.join(SYNTH_CASES_DIR, `${d.id}.yaml`), caseFile(d.id, d.piege, degradedGroundTruth(d, source)));
    console.log(`✓ ${d.id.padEnd(24)} ${d.piege}`);
  }
  console.log(`\n${SPECS.length + DEGRADED.length} factures dans eval/synthetiques/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
