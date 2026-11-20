/**
 * Notation d'un résultat du pipeline contre la vérité terrain. Fonctions pures, testées.
 *
 * La métrique centrale traduit la demande du client (« un champ vide plutôt qu'une valeur fausse ») :
 * une valeur fausse affichée comme sûre (statut ok) est l'erreur la plus grave ; une valeur fausse
 * marquée « à vérifier » est rattrapée par le comptable ; une abstention ne coûte qu'une saisie.
 */
import type { Field, InvoiceResult, WarningCode } from "@juwa/schema";
import { normalizeWithMap } from "@juwa/pipeline/grounding.ts";
import { amountAppearsIn, datesIn, numberAppearsIn, toCents } from "@juwa/pipeline/parsing.ts";
import type { EvalCase } from "./cases.ts";

export type Kind = "text" | "designation" | "date" | "amount" | "number";

export type Outcome =
  | "juste" // valeur correcte
  | "fausse_silencieuse" // valeur fausse affichée comme sûre : l'erreur à éviter
  | "fausse_signalee" // valeur fausse mais marquée « à vérifier »
  | "abstention" // pas de valeur alors qu'elle était lisible
  | "abstention_correcte"; // pas de valeur, et il n'y en avait pas à lire

type Expected = string | number | string[];

const norm = (text: string) => normalizeWithMap(text).text;
const tokens = (text: string) => norm(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** La valeur extraite correspond-elle à la valeur attendue ? (montants attendus en euros, extraits en centimes) */
export function matches(kind: Kind, expected: Expected, got: string | number): boolean {
  switch (kind) {
    case "amount":
      return toCents(Number(expected)) === got;
    case "number":
      return Math.abs(Number(expected) - Number(got)) < 1e-9;
    case "date":
      return expected === got;
    case "text":
      return (Array.isArray(expected) ? expected : [String(expected)]).some(
        (alt) => norm(String(got)) === norm(alt) || norm(String(got)).includes(norm(alt)),
      );
    case "designation": {
      const gotTokens = new Set(tokens(String(got)));
      const wanted = tokens(String(expected));
      return wanted.length > 0 && wanted.filter((t) => gotTokens.has(t)).length / wanted.length >= 0.8;
    }
  }
}

/** La valeur extraite est-elle l'un des faux amis listés (client, échéance, total recalculé…) ? */
export function isForbidden(kind: Kind, forbidden: (string | number)[], got: string | number): boolean {
  return forbidden.some((f) => {
    if (kind === "amount") return toCents(Number(f)) === got;
    if (kind === "number") return Number(f) === Number(got);
    if (kind === "date") return f === got;
    if (String(got).includes(String(f))) return true;
    // Comparaison sans casse ni accents seulement pour un vrai mot : « â » (mojibake) deviendrait « a »
    // et serait trouvé dans n'importe quelle valeur.
    const folded = norm(String(f));
    return folded.length >= 4 && norm(String(got)).includes(folded);
  });
}

/** `field` est null quand la facture entière a échoué. */
export function classify(kind: Kind, expected: Expected | null, field: Field<string | number> | null): Outcome {
  const got = field?.value ?? null;
  if (got === null) return expected === null ? "abstention_correcte" : "abstention";
  if (expected !== null && matches(kind, expected, got)) return "juste";
  return field?.status === "a_verifier" ? "fausse_signalee" : "fausse_silencieuse";
}

export interface FieldScore {
  fichier: string;
  path: string;
  kind: Kind;
  outcome: Outcome;
  expected: Expected | null;
  got: string | number | null;
  interdit: boolean;
}

export interface CaseScore {
  fichier: string;
  failed: boolean;
  fields: FieldScore[];
  expectedWarnings: WarningCode[];
  missingWarnings: WarningCode[];
  /** Écarts bloquants levés alors que le document n'en a pas : fausses alertes. */
  unexpectedBlocking: WarningCode[];
}

export function scoreCase(evalCase: EvalCase, result: InvoiceResult | undefined): CaseScore {
  const invoice = result?.status === "extracted" ? result.invoice : null;
  const { attendu, interdits } = evalCase;
  const fields: FieldScore[] = [];

  const add = (path: string, kind: Kind, expected: Expected | null, field: Field<string | number> | null, forbiddenKey = path) => {
    const got = field?.value ?? null;
    fields.push({
      fichier: evalCase.fichier,
      path,
      kind,
      expected,
      got,
      outcome: classify(kind, expected, field),
      interdit: got !== null && isForbidden(kind, interdits[forbiddenKey] ?? [], got),
    });
  };

  add("fournisseur", "text", attendu.fournisseur, invoice?.fournisseur ?? null);
  add("numero", "text", attendu.numero, invoice?.numero ?? null);
  add("date", "date", attendu.date, invoice?.date ?? null);
  add("totalHT", "amount", attendu.totalHT, invoice?.totalHT ?? null);
  add("tauxTVA", "number", attendu.tauxTVA, invoice?.tauxTVA ?? null);
  add("montantTVA", "amount", attendu.montantTVA, invoice?.montantTVA ?? null);
  add("totalTTC", "amount", attendu.totalTTC, invoice?.totalTTC ?? null);

  // Lignes alignées par position ; une ligne en trop compte comme valeurs fausses, une ligne manquante comme abstention.
  const gotLines = invoice?.lignes ?? [];
  for (let i = 0; i < Math.max(attendu.lignes.length, gotLines.length); i++) {
    const exp = attendu.lignes[i];
    const got = gotLines[i];
    add(`lignes[${i}].designation`, "designation", exp?.designation ?? null, got?.designation ?? null, "lignes.designation");
    add(`lignes[${i}].quantite`, "number", exp?.quantite ?? null, got?.quantite ?? null, "lignes.quantite");
    add(`lignes[${i}].prixUnitaire`, "amount", exp?.prixUnitaire ?? null, got?.prixUnitaire ?? null, "lignes.prixUnitaire");
    add(`lignes[${i}].totalLigne`, "amount", exp?.totalLigne ?? null, got?.totalLigne ?? null, "lignes.totalLigne");
  }

  const warnings = result?.status === "extracted" ? result.warnings : [];
  const codes = new Set(warnings.map((w) => w.code));
  return {
    fichier: evalCase.fichier,
    failed: result?.status !== "extracted",
    fields,
    expectedWarnings: evalCase.avertissements_attendus,
    // Une facture en échec n'a levé aucun avertissement : les attendus sont manqués.
    missingWarnings: evalCase.avertissements_attendus.filter((c) => !codes.has(c)),
    unexpectedBlocking: warnings
      .filter((w) => w.severity === "bloquant" && !evalCase.avertissements_attendus.includes(w.code))
      .map((w) => w.code),
  };
}

export interface Metrics {
  champs: number;
  juste: number;
  fausseSilencieuse: number;
  fausseSignalee: number;
  abstention: number;
  abstentionCorrecte: number;
  interdits: number;
  /** Parmi les valeurs affichées comme sûres, part de valeurs justes : la métrique du client (cible 100 %). */
  fiabiliteDesValeursSures: number | null;
  /** Part des valeurs attendues correctement extraites. */
  couverture: number | null;
  avertissementsAttendus: number;
  avertissementsManques: number;
  faussesAlertes: number;
  facturesEnEchec: number;
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

export function aggregate(scores: CaseScore[]): Metrics {
  const all = scores.flatMap((s) => s.fields);
  const count = (o: Outcome) => all.filter((f) => f.outcome === o).length;
  const juste = count("juste");
  const fausseSilencieuse = count("fausse_silencieuse");
  const attendues = all.filter((f) => f.expected !== null).length;
  const missing = scores.reduce((n, s) => n + s.missingWarnings.length, 0);
  const expectedWarnings = scores.reduce((n, s) => n + s.expectedWarnings.length, 0);

  return {
    champs: all.length,
    juste,
    fausseSilencieuse,
    fausseSignalee: count("fausse_signalee"),
    abstention: count("abstention"),
    abstentionCorrecte: count("abstention_correcte"),
    interdits: all.filter((f) => f.interdit).length,
    // Valeurs affichées comme sûres = justes + fausses silencieuses (les a_verifier sont signalées).
    fiabiliteDesValeursSures: ratio(juste, juste + fausseSilencieuse),
    couverture: ratio(juste, attendues),
    avertissementsAttendus: expectedWarnings,
    avertissementsManques: missing,
    faussesAlertes: scores.reduce((n, s) => n + s.unexpectedBlocking.length, 0),
    facturesEnEchec: scores.filter((s) => s.failed).length,
  };
}

/**
 * Diagnostic d'une erreur : la bonne valeur figure-t-elle dans le texte OCR ?
 * Oui → l'OCR l'a lue, c'est le LLM (ou l'ancrage) qui s'est trompé. Non → l'erreur vient de l'OCR.
 */
export function presentInOcr(kind: Kind, expected: Expected, markdown: string): boolean {
  switch (kind) {
    case "amount":
      return amountAppearsIn(toCents(Number(expected)), markdown);
    case "number":
      return numberAppearsIn(Number(expected), markdown);
    case "date":
      return datesIn(markdown).has(String(expected));
    case "text":
    case "designation":
      return (Array.isArray(expected) ? expected : [String(expected)]).some((alt) => norm(markdown).includes(norm(alt)));
  }
}
