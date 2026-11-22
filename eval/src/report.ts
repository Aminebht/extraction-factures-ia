/**
 * Sections du rapport d'évaluation (markdown), communes aux factures réelles et synthétiques.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BatchResult } from "@juwa/schema";
import { config } from "@juwa/pipeline/config.ts";
import type { OcrResult } from "@juwa/pipeline/ocr.ts";
import type { EvalCase } from "./cases.ts";
import type { FiletReport } from "./filet.ts";
import { presentInOcr, type CaseScore, type FieldScore, type Metrics } from "./scoring.ts";

const pct = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 1000) / 10} %`);
const show = (v: unknown) => (v === null ? "∅" : Array.isArray(v) ? v.join(" | ") : String(v));

export async function loadBatch(file: string): Promise<BatchResult | null> {
  try {
    return BatchResult.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

/** Texte OCR en cache pour ce PDF (le nom du fichier de cache commence par son sha256). */
async function loadOcr(sha256: string): Promise<string | null> {
  try {
    const file = (await readdir(config.ocrCacheDir)).find((f) => f.startsWith(`${sha256}.`));
    if (!file) return null;
    const ocr = JSON.parse(await readFile(path.join(config.ocrCacheDir, file), "utf8")) as OcrResult;
    return ocr.pages.map((p) => p.markdown).join("\n");
  } catch {
    return null;
  }
}

export function filetSection(report: FiletReport): string[] {
  const lines = [
    "## Filet de sécurité (erreurs injectées, hors ligne)",
    "",
    `Extractions correctes reconstituées à partir de ${report.casUtilises} cas, puis une erreur réaliste glissée à chaque essai.`,
    "",
    "| Erreur injectée | Repérée | |",
    "|---|---|---|",
  ];
  for (const m of report.mutations) {
    const status = m.limiteConnue ? "limite connue" : m.detectees === m.essais ? "✓" : "✗ À CORRIGER";
    lines.push(`| ${m.nom} | ${m.detectees}/${m.essais} | ${status} |`);
  }
  const caught = report.mutations.filter((m) => !m.limiteConnue);
  const total = caught.reduce((n, m) => n + m.essais, 0);
  const found = caught.reduce((n, m) => n + m.detectees, 0);
  lines.push("", `**Erreurs repérées (hors limites connues) : ${found}/${total}.**`);
  lines.push(
    `**Fausses alertes sur les extractions correctes : ${report.faussesAlertes.length === 0 ? "aucune" : report.faussesAlertes.map((f) => `${f.fichier} (${f.codes.join(", ")})`).join(", ")}.**`,
  );
  const limits = report.mutations.filter((m) => m.limiteConnue);
  if (limits.length) {
    lines.push("", "Limites connues :");
    for (const m of limits) lines.push(`- ${m.nom} : ${m.limiteConnue}`);
  }
  return lines;
}

export function metricsSection(title: string, metrics: Metrics, generatedAt: string): string[] {
  return [
    `## ${title}`,
    "",
    `Résultat du ${generatedAt}.`,
    "",
    "| Métrique | Valeur |",
    "|---|---|",
    `| **Fiabilité des valeurs affichées comme sûres** (cible 100 %) | **${pct(metrics.fiabiliteDesValeursSures)}** |`,
    `| Valeurs fausses affichées comme sûres | ${metrics.fausseSilencieuse} |`,
    `| Valeurs fausses mais marquées « à vérifier » | ${metrics.fausseSignalee} |`,
    `| Faux amis renvoyés (client, échéance, total recalculé…) | ${metrics.interdits} |`,
    `| Couverture (valeurs attendues correctement extraites) | ${pct(metrics.couverture)} (${metrics.juste} champs) |`,
    `| Abstentions (valeur lisible non extraite) | ${metrics.abstention} |`,
    `| Abstentions correctes (rien à lire) | ${metrics.abstentionCorrecte} |`,
    `| Écarts attendus détectés | ${metrics.avertissementsAttendus - metrics.avertissementsManques}/${metrics.avertissementsAttendus} |`,
    `| Fausses alertes (écart bloquant sans écart réel) | ${metrics.faussesAlertes} |`,
    `| Factures en échec | ${metrics.facturesEnEchec} |`,
  ];
}

/** Une ligne par facture : le piège est-il déjoué ? (tous les champs justes, écarts attendus levés, aucune fausse alerte) */
export function trapsSection(cases: EvalCase[], scores: CaseScore[]): string[] {
  const lines = ["", "### Pièges", "", "| Facture | Piège | Résultat |", "|---|---|---|"];
  for (const c of cases) {
    const s = scores.find((x) => x.fichier === c.fichier);
    if (!s) continue;
    const wrong = s.fields.filter((f) => f.outcome !== "juste" && f.outcome !== "abstention_correcte");
    const problems = [
      ...(s.failed ? ["facture en échec"] : []),
      ...wrong.map((f) => `${f.path} : ${f.outcome}${f.interdit ? " (faux ami)" : ""}`),
      ...s.missingWarnings.map((w) => `${w} non signalé`),
      ...s.unexpectedBlocking.map((w) => `fausse alerte ${w}`),
    ];
    const piege = (c.description ?? "").replace(/^Synthétique : /, "");
    lines.push(`| ${c.fichier} | ${piege} | ${problems.length ? `✗ ${problems.slice(0, 3).join(" ; ")}${problems.length > 3 ? ` (+${problems.length - 3})` : ""}` : "✓"} |`);
  }
  return lines;
}

export async function errorsSection(scores: CaseScore[], batch: BatchResult): Promise<string[]> {
  const errors = scores.flatMap((s) => s.fields).filter((f) => f.outcome !== "juste" && f.outcome !== "abstention_correcte");
  if (!errors.length) return ["", "Aucune erreur ni abstention."];

  const ocrByFile = new Map<string, string | null>();
  for (const r of batch.results) ocrByFile.set(r.source.fichier, r.source.sha256 ? await loadOcr(r.source.sha256) : null);

  const cause = (f: FieldScore) => {
    const ocr = ocrByFile.get(f.fichier);
    if (f.expected === null || !ocr) return "?";
    return presentInOcr(f.kind, f.expected, ocr) ? "LLM / ancrage" : "OCR";
  };

  const lines = ["", "### Erreurs et abstentions", "", "| Facture | Champ | Attendu | Obtenu | Résultat | Cause probable |", "|---|---|---|---|---|---|"];
  for (const f of errors) {
    const outcome = f.interdit ? `${f.outcome} (faux ami)` : f.outcome;
    lines.push(`| ${f.fichier} | ${f.path} | ${show(f.expected)} | ${show(f.got)} | ${outcome} | ${cause(f)} |`);
  }
  for (const s of scores.filter((s) => s.missingWarnings.length || s.unexpectedBlocking.length)) {
    if (s.missingWarnings.length) lines.push("", `- ${s.fichier} : écarts attendus non signalés : ${s.missingWarnings.join(", ")}`);
    if (s.unexpectedBlocking.length) lines.push(`- ${s.fichier} : fausses alertes : ${s.unexpectedBlocking.join(", ")}`);
  }
  return lines;
}
