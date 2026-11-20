/**
 * Ancrage par citation : le LLM renvoie pour chaque champ { value, quote } ; ici, du code
 * déterministe vérifie que la citation existe dans le texte OCR et que la valeur s'y lit.
 * Une valeur non prouvée par le document est rendue null : jamais de valeur inventée.
 */
import type { Field, Invoice, LineItem, LlmField, LlmInvoice, Warning } from "@juwa/schema";
import type { OcrPage, OcrResult } from "./ocr.ts";
import { amountAppearsIn, datesIn, foldText, numberAppearsIn, toCents } from "./parsing.ts";

export type FieldKind = "text" | "designation" | "date" | "amount" | "number";

interface Normalized {
  text: string;
  /** Pour chaque caractère normalisé, son index dans le texte d'origine. */
  map: number[];
}

/**
 * Normalisation tolérante à la mise en forme : casse, accents, espaces multiples, séparateurs de
 * tableau markdown (« | », « ** », « <br> »), apostrophes et tirets typographiques.
 * Garde la correspondance avec le texte d'origine pour retrouver la confiance des mots cités.
 */
export function normalizeWithMap(input: string): Normalized {
  const source = input.replace(/<br\s*\/?>/gi, (m) => " ".repeat(m.length));
  let text = "";
  const map: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (/[\s|*]/.test(char)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text += " ";
      map.push(i);
      pendingSpace = false;
    }
    const folded = foldText(char).replace(/[’‘`]/g, "'").replace(/[‐‑‒–—−]/g, "-");
    for (const c of folded) {
      text += c;
      map.push(i);
    }
  }
  return { text, map };
}

export interface QuoteLocation {
  page: OcrPage;
  start: number;
  end: number;
}

/** Retrouve la citation dans les pages OCR ; null si elle n'y figure pas. */
export function locateQuote(ocr: OcrResult, quote: string): QuoteLocation | null {
  const needle = normalizeWithMap(quote).text;
  if (!needle) return null;
  for (const page of ocr.pages) {
    const haystack = normalizeWithMap(page.markdown);
    const at = haystack.text.indexOf(needle);
    if (at >= 0) {
      return { page, start: haystack.map[at]!, end: haystack.map[at + needle.length - 1]! + 1 };
    }
  }
  return null;
}

/** Confiance OCR d'un passage : celle du mot le moins sûr qu'il contient ; null si inconnue. */
export function confidenceOf({ page, start, end }: QuoteLocation): number | null {
  const words = page.words.filter((w) => w.start < end && w.start + w.text.length > start);
  return words.length ? Math.min(...words.map((w) => w.confidence)) : null;
}

const tokens = (text: string) => normalizeWithMap(text).text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** La valeur renvoyée par le LLM se lit-elle dans sa citation ? */
export function valueReadableIn(kind: FieldKind, value: string | number, quote: string): boolean {
  switch (kind) {
    case "amount":
      return amountAppearsIn(toCents(Number(value)), quote);
    case "number":
      return numberAppearsIn(Number(value), quote);
    case "date":
      return datesIn(quote).has(String(value));
    case "text":
      return normalizeWithMap(quote).text.includes(normalizeWithMap(String(value)).text);
    case "designation": {
      // Une désignation peut être reformulée (titre + sous-ligne réunis) : 80 % des mots suffisent.
      const quoteTokens = new Set(tokens(quote));
      const valueTokens = tokens(String(value));
      if (!valueTokens.length) return false;
      const found = valueTokens.filter((t) => quoteTokens.has(t)).length;
      return found / valueTokens.length >= 0.8;
    }
  }
}

export interface CertifyContext {
  ocr: OcrResult;
  /** En dessous de ce seuil de confiance OCR, une valeur ancrée passe « à vérifier ». */
  threshold: number;
  warnings: Warning[];
}

/**
 * Certifie un champ : lui attribue un statut (ok / a_verifier / absent) et ajoute les
 * avertissements au contexte. Les montants sont convertis en centimes.
 */
export function certifyField<T extends string | number>(
  kind: FieldKind,
  llm: LlmField<T>,
  path: string,
  label: string,
  ctx: CertifyContext,
): Field<T> {
  const absent = (code: Warning["code"], message: string): Field<T> => {
    ctx.warnings.push({ code, severity: "attention", field: path, message });
    return { value: null, status: "absent", quote: llm.quote, ocrConfidence: null };
  };

  if (llm.value === null) {
    return absent("CHAMP_ABSENT", `${label} : non lisible sur la facture, à saisir manuellement.`);
  }
  const location = llm.quote ? locateQuote(ctx.ocr, llm.quote) : null;
  if (!location || !llm.quote) {
    return absent(
      "NON_ANCRE",
      `${label} : la valeur proposée (« ${llm.value} ») ne figure pas sur la facture, elle a été écartée.`,
    );
  }
  if (!valueReadableIn(kind, llm.value, llm.quote)) {
    return absent(
      "VALEUR_INCOHERENTE_AVEC_SOURCE",
      `${label} : la valeur proposée (« ${llm.value} ») ne correspond pas au texte lu (« ${llm.quote} »), elle a été écartée.`,
    );
  }

  const value = (kind === "amount" ? toCents(Number(llm.value)) : llm.value) as T;
  const ocrConfidence = confidenceOf(location);
  if (ocrConfidence !== null && ocrConfidence < ctx.threshold) {
    ctx.warnings.push({
      code: "CONFIANCE_FAIBLE",
      severity: "attention",
      field: path,
      message: `${label} : lecture incertaine (confiance ${Math.round(ocrConfidence * 100)} %), à vérifier sur le PDF.`,
    });
    return { value, status: "a_verifier", quote: llm.quote, ocrConfidence };
  }
  return { value, status: "ok", quote: llm.quote, ocrConfidence };
}

/** Certifie toute la facture renvoyée par le LLM. */
export function certifyInvoice(
  llm: LlmInvoice,
  ocr: OcrResult,
  threshold: number,
): { invoice: Invoice; warnings: Warning[] } {
  const ctx: CertifyContext = { ocr, threshold, warnings: [] };

  const lignes: LineItem[] = llm.lignes.map((line, i) => {
    const n = `ligne ${i + 1}`;
    const p = `lignes[${i}]`;
    return {
      designation: certifyField("designation", line.designation, `${p}.designation`, `Désignation (${n})`, ctx),
      quantite: certifyField("number", line.quantite, `${p}.quantite`, `Quantité (${n})`, ctx),
      prixUnitaire: certifyField("amount", line.prixUnitaire, `${p}.prixUnitaire`, `Prix unitaire (${n})`, ctx),
      totalLigne: certifyField("amount", line.totalLigne, `${p}.totalLigne`, `Total (${n})`, ctx),
    };
  });

  const invoice: Invoice = {
    fournisseur: certifyField("text", llm.fournisseur, "fournisseur", "Fournisseur", ctx),
    numero: certifyField("text", llm.numero, "numero", "Numéro de facture", ctx),
    date: certifyField("date", llm.date, "date", "Date", ctx),
    lignes,
    totalHT: certifyField("amount", llm.totalHT, "totalHT", "Total HT", ctx),
    tauxTVA: certifyField("number", llm.tauxTVA, "tauxTVA", "Taux de TVA", ctx),
    montantTVA: certifyField("amount", llm.montantTVA, "montantTVA", "Montant de TVA", ctx),
    totalTTC: certifyField("amount", llm.totalTTC, "totalTTC", "Total TTC", ctx),
  };
  return { invoice, warnings: ctx.warnings };
}
