/**
 * npm run eval:generer
 *
 * Génère les factures synthétiques (PDF) et leur vérité terrain (YAML) dans eval/synthetiques/.
 * Les deux sont produits à partir des mêmes données : la vérité terrain est exacte par construction.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { compute, groundTruth } from "./compute.ts";
import { renderPdf } from "./render.ts";
import { SPECS } from "./specs.ts";

export const SYNTH_DIR = path.resolve(import.meta.dirname, "../../synthetiques");
export const SYNTH_PDF_DIR = path.join(SYNTH_DIR, "factures");
export const SYNTH_CASES_DIR = path.join(SYNTH_DIR, "cas");

async function main() {
  await rm(SYNTH_DIR, { recursive: true, force: true });
  await mkdir(SYNTH_PDF_DIR, { recursive: true });
  await mkdir(SYNTH_CASES_DIR, { recursive: true });

  for (const spec of SPECS) {
    const computed = compute(spec);
    await renderPdf(spec, computed, path.join(SYNTH_PDF_DIR, `${spec.id}.pdf`));
    const header = `# Généré par eval/src/synthetiques/generate.ts : ne pas modifier à la main.\n# Piège : ${spec.piege}\n`;
    await writeFile(path.join(SYNTH_CASES_DIR, `${spec.id}.yaml`), header + stringify(groundTruth(spec, computed)));
    console.log(`✓ ${spec.id.padEnd(24)} ${spec.piege}`);
  }
  console.log(`\n${SPECS.length} factures dans eval/synthetiques/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
