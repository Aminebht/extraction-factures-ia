/**
 * Contrôles métier : une facture est redondante par construction (lignes, HT, TVA, TTC).
 * Un écart est signalé, jamais corrigé : c'est au comptable de trancher.
 */
import type { Invoice, Warning } from "@juwa/schema";

/** Écart toléré, en centimes (arrondis d'affichage). */
export const TOLERANCE_CENTS = 1;

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
export const formatCents = (cents: number) => euros.format(cents / 100);

const differs = (a: number, b: number) => Math.abs(a - b) > TOLERANCE_CENTS;

function blocking(code: Warning["code"], field: string | null, message: string): Warning {
  return { code, severity: "bloquant", field, message };
}

function impossible(message: string): Warning {
  return { code: "CONTROLE_IMPOSSIBLE", severity: "attention", field: null, message };
}

export function runBusinessChecks(invoice: Invoice): Warning[] {
  const warnings: Warning[] = [];
  const ht = invoice.totalHT.value;
  const taux = invoice.tauxTVA.value;
  const tva = invoice.montantTVA.value;
  const ttc = invoice.totalTTC.value;

  // 1. Chaque ligne : quantité × prix unitaire = total de la ligne.
  invoice.lignes.forEach((line, i) => {
    const q = line.quantite.value;
    const pu = line.prixUnitaire.value;
    const total = line.totalLigne.value;
    if (q === null || pu === null || total === null) return;
    const expected = Math.round(q * pu);
    if (differs(expected, total)) {
      warnings.push(
        blocking(
          "ECART_LIGNE",
          `lignes[${i}].totalLigne`,
          `Ligne ${i + 1} : ${q} × ${formatCents(pu)} = ${formatCents(expected)}, mais la facture indique ${formatCents(total)}.`,
        ),
      );
    }
  });

  // 2. Somme des lignes = total HT.
  const lineTotals = invoice.lignes.map((l) => l.totalLigne.value);
  if (ht === null || lineTotals.length === 0 || lineTotals.some((t) => t === null)) {
    warnings.push(impossible("Somme des lignes non vérifiée : total HT ou total d'une ligne manquant."));
  } else {
    const sum = lineTotals.reduce<number>((acc, t) => acc + (t ?? 0), 0);
    if (differs(sum, ht)) {
      warnings.push(
        blocking(
          "ECART_SOMME_LIGNES",
          "totalHT",
          `La somme des lignes (${formatCents(sum)}) ne correspond pas au total HT (${formatCents(ht)}).`,
        ),
      );
    }
  }

  // 3. Total HT × taux = montant de TVA (taux lu sur la facture : 19,6 % en 2009, pas 20 % en dur).
  if (ht === null || taux === null || tva === null) {
    warnings.push(impossible("Montant de TVA non vérifié : total HT, taux ou montant de TVA manquant."));
  } else {
    const expected = Math.round((ht * taux) / 100);
    if (differs(expected, tva)) {
      warnings.push(
        blocking(
          "ECART_TVA",
          "montantTVA",
          `TVA à ${taux} % sur ${formatCents(ht)} = ${formatCents(expected)}, mais la facture indique ${formatCents(tva)}.`,
        ),
      );
    }
  }

  // 4. Total HT + TVA = total TTC.
  if (ht === null || tva === null || ttc === null) {
    warnings.push(impossible("Total TTC non vérifié : total HT, TVA ou TTC manquant."));
  } else if (differs(ht + tva, ttc)) {
    warnings.push(
      blocking(
        "ECART_TTC",
        "totalTTC",
        `${formatCents(ht)} HT + ${formatCents(tva)} de TVA = ${formatCents(ht + tva)}, mais la facture indique ${formatCents(ttc)} TTC.`,
      ),
    );
  }

  return warnings;
}
