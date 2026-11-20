/**
 * Sonde : passe un PDF dans l'OCR du fournisseur configuré (AI_PROVIDER) et affiche ce qui revient,
 * pour vérifier sur l'API réelle les hypothèses du pipeline (texte caché de F4, confiance par mot).
 *
 *   npm run probe-ocr -w @juwa/pipeline -- factures/facture_4_hydrofluid_encodage.pdf
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../src/config.ts";
import { createProvider } from "../src/providers/index.ts";

const MOJIBAKE = /Ã[\u0080-¿]|Â[ -¿]|â[\u0080-€]|�/g;

const file = process.argv[2];
if (!file) {
  console.error("Usage : probe-ocr <chemin du PDF>");
  process.exit(1);
}

const provider = createProvider();
const result = await provider.ocr(readFileSync(path.resolve(ROOT_DIR, file)), path.basename(file));

const outDir = path.join(ROOT_DIR, ".cache", "probe");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${path.basename(file, ".pdf")}.${provider.name.split(" ")[0]}.json`);
writeFileSync(outFile, JSON.stringify(result, null, 2));

console.log(`Fournisseur : ${provider.name}`);
for (const page of result.pages) {
  const mojibake = page.markdown.match(MOJIBAKE) ?? [];
  const lowWords = page.words.filter((w) => w.confidence < 0.8);
  console.log(`\n===== Page ${page.index} =====`);
  console.log(page.markdown);
  console.log("\n----- Diagnostic -----");
  console.log(`Mojibake détecté : ${mojibake.length} occurrence(s) ${mojibake.slice(0, 5).join(" ")}`);
  console.log(`Mots avec confiance : ${page.words.length}`);
  console.log(`Confiance page : moyenne ${page.averageConfidence}, minimum ${page.minimumConfidence}`);
  console.log(`Mots < 0,80 : ${lowWords.map((w) => `${w.text} (${w.confidence.toFixed(2)})`).join(", ") || "aucun"}`);
  const sample = page.words[0];
  if (sample) {
    const atIndex = page.markdown.slice(sample.start, sample.start + sample.text.length);
    console.log(`Contrôle startIndex : mot « ${sample.text} » → markdown « ${atIndex} »`);
  }
}
console.log(`\nRéponse complète : ${path.relative(ROOT_DIR, outFile)}`);
