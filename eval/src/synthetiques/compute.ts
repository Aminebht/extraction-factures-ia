/**
 * Montants imprimés et vérité terrain d'une facture synthétique, calculés en centimes entiers.
 */
import type { EvalCase } from "../cases.ts";
import type { DegradedSpec, Spec } from "./specs.ts";

export interface ComputedLine {
  designation: string;
  quantite: number;
  prixUnitaire: number; // centimes
  total: number; // centimes
  tauxTVA: number;
}

export interface Computed {
  lignes: ComputedLine[];
  /** Somme réelle des lignes (centimes). */
  sommeLignes: number;
  /** Montants tels qu'imprimés sur la facture (centimes), erreurs volontaires comprises. */
  totalHT: number;
  tvaParTaux: { taux: number; base: number; montant: number }[];
  montantTVA: number;
  totalTTC: number;
  /** TTC juste, pour lister le TTC faux comme valeur interdite. */
  totalTTCJuste: number;
}

const cents = (euros: number) => Math.round(euros * 100);

export function compute(spec: Spec): Computed {
  const lignes = spec.lignes.map((l) => ({
    designation: l.designation,
    quantite: l.quantite,
    prixUnitaire: cents(l.prixUnitaire),
    total: Math.round(l.quantite * cents(l.prixUnitaire)),
    tauxTVA: l.tauxTVA ?? spec.tauxTVA,
  }));
  const sommeLignes = lignes.reduce((s, l) => s + l.total, 0);

  // Erreur sur le HT : la TVA et le TTC sont calculés sur le HT imprimé, pour n'isoler qu'un seul écart.
  const totalHT = sommeLignes + cents(spec.erreur?.totalHT ?? 0);
  const taux = [...new Set(lignes.map((l) => l.tauxTVA))];
  const tvaParTaux = taux.map((t) => {
    const base = taux.length === 1 ? totalHT : lignes.filter((l) => l.tauxTVA === t).reduce((s, l) => s + l.total, 0);
    return { taux: t, base, montant: Math.round((base * t) / 100) };
  });
  const montantTVA = tvaParTaux.reduce((s, t) => s + t.montant, 0);
  const totalTTCJuste = totalHT + montantTVA;
  return {
    lignes,
    sommeLignes,
    totalHT,
    tvaParTaux,
    montantTVA,
    totalTTC: totalTTCJuste + cents(spec.erreur?.totalTTC ?? 0),
    totalTTCJuste,
  };
}

const euros = (c: number) => c / 100;

/** Vérité terrain d'une variante scannée : celle de la facture d'origine, plus les faux amis du scan. */
export function degradedGroundTruth(d: DegradedSpec, source: Spec): EvalCase {
  const base = groundTruth(source, compute(source));
  const interdits = { ...base.interdits };
  for (const [field, values] of Object.entries(d.interditsEnPlus ?? {})) interdits[field] = [...(interdits[field] ?? []), ...values];
  return { ...base, fichier: `${d.id}.pdf`, description: `Synthétique : ${d.piege}`, interdits };
}

/** Vérité terrain au format des cas de l'eval (montants en euros). */
export function groundTruth(spec: Spec, c: Computed): EvalCase {
  const interdits: Record<string, (string | number)[]> = { fournisseur: ["GARNIER Industrie"] };
  const add = (field: string, ...values: (string | number)[]) => {
    interdits[field] = [...(interdits[field] ?? []), ...values];
  };

  if (spec.erreur?.totalHT) add("totalHT", euros(c.sommeLignes));
  if (spec.erreur?.totalTTC) add("totalTTC", euros(c.totalTTCJuste));
  if (spec.fauxAmis?.numeroCommande) add("numero", spec.fauxAmis.numeroCommande);
  if (spec.fauxAmis?.numeroClient) add("numero", spec.fauxAmis.numeroClient);
  if (spec.fauxAmis?.dateLivraison) add("date", spec.fauxAmis.dateLivraison);
  if (spec.fauxAmis?.dateEcheance) add("date", spec.fauxAmis.dateEcheance);
  if (c.tvaParTaux.length > 1) add("tauxTVA", ...c.tvaParTaux.map((t) => t.taux));
  else if (spec.tauxTVA !== 20) add("tauxTVA", 20);

  const avertissements: EvalCase["avertissements_attendus"] = [];
  if (spec.erreur?.totalHT) avertissements.push("ECART_SOMME_LIGNES");
  if (spec.erreur?.totalTTC) avertissements.push("ECART_TTC");

  return {
    fichier: `${spec.id}.pdf`,
    description: `Synthétique : ${spec.piege}`,
    attendu: {
      fournisseur: spec.fournisseur.nom,
      numero: spec.numero,
      date: spec.date,
      lignes: c.lignes.map((l) => ({
        designation: l.designation,
        quantite: l.quantite,
        prixUnitaire: euros(l.prixUnitaire),
        totalLigne: euros(l.total),
      })),
      totalHT: euros(c.totalHT),
      // Plusieurs taux : la facture imprime un montant par taux mais pas leur somme, qu'on ne peut
      // donc pas exiger (le pipeline ne doit pas l'inventer).
      tauxTVA: c.tvaParTaux.length === 1 ? c.tvaParTaux[0]!.taux : null,
      montantTVA: c.tvaParTaux.length === 1 ? euros(c.montantTVA) : null,
      totalTTC: euros(c.totalTTC),
    },
    interdits,
    avertissements_attendus: avertissements,
  };
}
