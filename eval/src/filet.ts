/**
 * Test du filet de sécurité : on part d'une extraction
 * correcte, on y glisse une erreur réaliste, et on regarde si l'ancrage et les contrôles métier la
 * repèrent. Hors ligne et déterministe : le document est reconstruit à partir de la vérité terrain.
 *
 * On mesure aussi les fausses alertes sur l'extraction correcte. Deux erreurs sont connues pour passer
 * le filet (limite assumée) : elles sont listées comme telles plutôt que cachées.
 */
import type { Invoice, LlmInvoice, Warning } from "@juwa/schema";
import { runBusinessChecks } from "@juwa/pipeline/checks.ts";
import { certifyInvoice } from "@juwa/pipeline/grounding.ts";
import type { OcrResult, OcrWord } from "@juwa/pipeline/ocr.ts";
import type { EvalCase } from "./cases.ts";

const euros = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number) => `${euros.format(value)} €`;
const frNumber = (value: number) => String(value).replace(".", ",");
const frDate = (iso: string) => iso.split("-").reverse().join("/");

const CLIENT_LINE = "Client : GARNIER Industrie, 14 rue de l'Artisanat, 38300 Bourgoin-Jallieu";

export interface SyntheticDoc {
  markdown: string;
  llm: LlmInvoice;
}

/** Reconstitue un document et l'extraction correcte correspondante (citations exactes). */
export function syntheticDoc(c: EvalCase): SyntheticDoc | null {
  const a = c.attendu;
  if (!a.fournisseur || !a.numero || !a.date || a.totalHT === null || a.tauxTVA === null || a.montantTVA === null || a.totalTTC === null) {
    return null; // un cas avec des valeurs illisibles ne sert pas de base de mutation
  }
  const supplier = Array.isArray(a.fournisseur) ? a.fournisseur[0]! : a.fournisseur;
  const rows = a.lignes.map(
    (l) => `| ${l.designation} | ${frNumber(l.quantite)} | ${money(l.prixUnitaire)} | ${money(l.totalLigne)} |`,
  );
  const markdown = [
    `# ${supplier}`,
    `Facture n° ${a.numero}`,
    `Date : ${frDate(a.date)}`,
    CLIENT_LINE,
    "| Désignation | Qté | P.U. HT | Total HT |",
    "|---|---|---|---|",
    ...rows,
    `Total HT ${money(a.totalHT)}`,
    `TVA ${frNumber(a.tauxTVA)} % ${money(a.montantTVA)}`,
    `Total TTC ${money(a.totalTTC)}`,
  ].join("\n");

  const llm: LlmInvoice = {
    fournisseur: { value: supplier, quote: supplier },
    numero: { value: a.numero, quote: `Facture n° ${a.numero}` },
    date: { value: a.date, quote: `Date : ${frDate(a.date)}` },
    lignes: a.lignes.map((l) => ({
      designation: { value: l.designation, quote: l.designation },
      quantite: { value: l.quantite, quote: `| ${l.designation} | ${frNumber(l.quantite)} |` },
      prixUnitaire: { value: l.prixUnitaire, quote: `${frNumber(l.quantite)} | ${money(l.prixUnitaire)}` },
      totalLigne: { value: l.totalLigne, quote: `${money(l.prixUnitaire)} | ${money(l.totalLigne)}` },
    })),
    totalHT: { value: a.totalHT, quote: `Total HT ${money(a.totalHT)}` },
    tauxTVA: { value: a.tauxTVA, quote: `TVA ${frNumber(a.tauxTVA)} %` },
    montantTVA: { value: a.montantTVA, quote: `TVA ${frNumber(a.tauxTVA)} % ${money(a.montantTVA)}` },
    totalTTC: { value: a.totalTTC, quote: `Total TTC ${money(a.totalTTC)}` },
  };
  return { markdown, llm };
}

function ocrOf(markdown: string): OcrResult {
  const words: OcrWord[] = [...markdown.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index, confidence: 0.99 }));
  return { model: "synthetique", pages: [{ index: 0, markdown, words, averageConfidence: 0.99, minimumConfidence: 0.99 }] };
}

export function certify(doc: SyntheticDoc): { invoice: Invoice; warnings: Warning[] } {
  const { invoice, warnings } = certifyInvoice(doc.llm, ocrOf(doc.markdown), 0.8);
  return { invoice, warnings: [...warnings, ...runBusinessChecks(invoice)] };
}

export interface Mutation {
  nom: string;
  /** Erreur connue pour passer le filet : documentée, pas cachée. */
  limiteConnue?: string;
  /** Applique l'erreur ; null si elle n'a pas de sens pour ce cas. */
  apply(doc: SyntheticDoc): SyntheticDoc | null;
  detected(result: { invoice: Invoice; warnings: Warning[] }): boolean;
}

const clone = (doc: SyntheticDoc): SyntheticDoc => structuredClone(doc);
const hasCode = (warnings: Warning[], ...codes: Warning["code"][]) => warnings.some((w) => codes.includes(w.code));

/** Change le premier chiffre significatif d'un montant (« 1 167,40 » → « 4 167,40 »), comme une erreur de lecture. */
const misread = (value: number) => {
  const text = value.toFixed(2);
  const digit = Number(text[0]);
  return Number(`${(digit + 3) % 10 || 7}${text.slice(1)}`);
};

export const MUTATIONS: Mutation[] = [
  {
    nom: "Valeur inventée par le LLM (citation absente du document)",
    apply(doc) {
      const d = clone(doc);
      const fake = (d.llm.totalTTC.value ?? 0) + 100;
      d.llm.totalTTC = { value: fake, quote: `Total TTC ${money(fake)}` };
      return d;
    },
    detected: ({ invoice }) => invoice.totalTTC.status === "absent",
  },
  {
    nom: "Total recalculé par le LLM, citation d'origine conservée",
    apply(doc) {
      const d = clone(doc);
      d.llm.totalHT.value = Math.round(((d.llm.totalHT.value ?? 0) * 0.9) * 100) / 100;
      return d;
    },
    detected: ({ invoice }) => invoice.totalHT.status === "absent",
  },
  {
    nom: "Jour et mois inversés dans la date",
    apply(doc) {
      const d = clone(doc);
      const [y, m, day] = (d.llm.date.value ?? "").split("-");
      if (!y || !m || !day || day === m || Number(day) > 12) return null;
      d.llm.date.value = `${y}-${day}-${m}`;
      return d;
    },
    detected: ({ invoice }) => invoice.date.status === "absent",
  },
  {
    nom: "Taux de TVA supposé au lieu du taux lu",
    apply(doc) {
      const d = clone(doc);
      d.llm.tauxTVA.value = d.llm.tauxTVA.value === 20 ? 5.5 : 20;
      return d;
    },
    detected: ({ invoice }) => invoice.tauxTVA.status === "absent",
  },
  {
    nom: "Ligne de produit inventée",
    apply(doc) {
      const d = clone(doc);
      d.llm.lignes.push({
        designation: { value: "Joint torique NBR 20x3", quote: "Joint torique NBR 20x3" },
        quantite: { value: 2, quote: "| Joint torique NBR 20x3 | 2 |" },
        prixUnitaire: { value: 7.5, quote: "2 | 7,50 €" },
        totalLigne: { value: 15, quote: "7,50 € | 15,00 €" },
      });
      return d;
    },
    detected: ({ invoice }) => invoice.lignes.at(-1)?.designation.status === "absent",
  },
  {
    nom: "Erreur de lecture OCR sur un total de ligne (lue identiquement par le LLM)",
    apply(doc) {
      const d = clone(doc);
      const line = d.llm.lignes[0];
      if (!line?.totalLigne.value || !line.prixUnitaire.value) return null;
      const wrong = misread(line.totalLigne.value);
      d.markdown = d.markdown.replace(`| ${money(line.totalLigne.value)} |`, `| ${money(wrong)} |`);
      line.totalLigne = { value: wrong, quote: `${money(line.prixUnitaire.value)} | ${money(wrong)}` };
      return d;
    },
    detected: ({ warnings }) => hasCode(warnings, "ECART_LIGNE", "ECART_SOMME_LIGNES"),
  },
  {
    nom: "Erreur de lecture OCR sur le total TTC (lue identiquement par le LLM)",
    apply(doc) {
      const d = clone(doc);
      if (!d.llm.totalTTC.value) return null;
      const wrong = misread(d.llm.totalTTC.value);
      d.markdown = d.markdown.replace(`Total TTC ${money(d.llm.totalTTC.value)}`, `Total TTC ${money(wrong)}`);
      d.llm.totalTTC = { value: wrong, quote: `Total TTC ${money(wrong)}` };
      return d;
    },
    detected: ({ warnings }) => hasCode(warnings, "ECART_TTC"),
  },
  {
    nom: "Quantité et prix unitaire échangés, citations comprises",
    limiteConnue:
      "Le produit quantité × prix est inchangé et chaque valeur figure dans sa citation : ni l'ancrage ni l'arithmétique ne voient l'erreur.",
    apply(doc) {
      const d = clone(doc);
      const line = d.llm.lignes.find((l) => l.quantite.value !== null && l.quantite.value !== l.prixUnitaire.value);
      if (!line) return null;
      [line.quantite, line.prixUnitaire] = [
        { value: line.prixUnitaire.value, quote: line.prixUnitaire.quote },
        { value: line.quantite.value, quote: line.quantite.quote },
      ];
      return d;
    },
    detected: ({ invoice, warnings }) =>
      invoice.lignes.some((l) => l.quantite.status === "absent" || l.prixUnitaire.status === "absent") ||
      hasCode(warnings, "ECART_LIGNE", "ECART_SOMME_LIGNES"),
  },
  {
    nom: "Client pris pour le fournisseur",
    limiteConnue:
      "Le nom du client figure bien sur la facture : l'ancrage prouve que la valeur n'est pas inventée, pas qu'elle est dans le bon champ.",
    apply(doc) {
      const d = clone(doc);
      d.llm.fournisseur = { value: "GARNIER Industrie", quote: "Client : GARNIER Industrie" };
      return d;
    },
    detected: ({ invoice }) => invoice.fournisseur.status !== "ok",
  },
];

export interface MutationOutcome {
  nom: string;
  limiteConnue?: string;
  essais: number;
  detectees: number;
}

export interface FiletReport {
  mutations: MutationOutcome[];
  /** Avertissements bloquants levés sur l'extraction correcte alors que le document n'a pas d'écart. */
  faussesAlertes: { fichier: string; codes: string[] }[];
  casUtilises: number;
}

export function runFilet(cases: EvalCase[]): FiletReport {
  const docs = cases.map((c) => ({ c, doc: syntheticDoc(c) })).filter((x): x is { c: EvalCase; doc: SyntheticDoc } => x.doc !== null);

  const faussesAlertes = docs
    .map(({ c, doc }) => ({
      fichier: c.fichier,
      codes: certify(doc).warnings.filter((w) => !c.avertissements_attendus.includes(w.code)).map((w) => w.code),
    }))
    .filter((f) => f.codes.length > 0);

  const mutations = MUTATIONS.map((m) => {
    let essais = 0;
    let detectees = 0;
    for (const { doc } of docs) {
      const mutated = m.apply(doc);
      if (!mutated) continue;
      essais++;
      if (m.detected(certify(mutated))) detectees++;
    }
    return { nom: m.nom, ...(m.limiteConnue ? { limiteConnue: m.limiteConnue } : {}), essais, detectees };
  });

  return { mutations, faussesAlertes, casUtilises: docs.length };
}
