import { describe, expect, it } from "vitest";
import type { Field, Invoice, LineItem } from "@juwa/schema";
import { runBusinessChecks } from "./checks.ts";

const ok = <T>(value: T | null): Field<T> => ({
  value,
  status: value === null ? "absent" : "ok",
  quote: null,
  ocrConfidence: null,
});

const line = (quantite: number, prixUnitaire: number, totalLigne: number | null): LineItem => ({
  designation: ok("article"),
  quantite: ok(quantite),
  prixUnitaire: ok(prixUnitaire),
  totalLigne: ok(totalLigne),
});

function invoice(lines: LineItem[], ht: number | null, taux: number | null, tva: number | null, ttc: number | null): Invoice {
  return {
    fournisseur: ok("Fournisseur"),
    numero: ok("1"),
    date: ok("2026-01-01"),
    lignes: lines,
    totalHT: ok(ht),
    tauxTVA: ok(taux),
    montantTVA: ok(tva),
    totalTTC: ok(ttc),
  };
}

const codes = (inv: Invoice) => runBusinessChecks(inv).map((w) => w.code);

describe("runBusinessChecks", () => {
  it("F1 Méca-Précision : facture cohérente, aucun avertissement", () => {
    const f1 = invoice(
      [line(4, 48600, 194400), line(12, 3850, 46200), line(6, 15200, 91200), line(1, 29000, 29000), line(1, 14500, 14500)],
      375300, 20, 75060, 450360,
    );
    expect(codes(f1)).toEqual([]);
  });

  it("F2 Studio Botanica : ligne 2 fausse (4 × 95 € ≠ 285 €) et somme des lignes (925 €) ≠ total HT (1 040 €)", () => {
    const f2 = invoice(
      [line(1, 32000, 32000), line(4, 9500, 28500), line(1, 14000, 14000), line(3, 6000, 18000)],
      104000, 20, 20800, 124800,
    );
    const warnings = runBusinessChecks(f2);
    expect(warnings.map((w) => w.code)).toEqual(["ECART_LIGNE", "ECART_SOMME_LIGNES"]);
    expect(warnings[0]?.field).toBe("lignes[1].totalLigne");
    expect(warnings[1]?.message).toContain("925,00");
  });

  it("F3 scan 2009 : TVA à 19,6 % lue sur la facture, aucun écart", () => {
    const f3 = invoice(
      [line(8, 1460, 11680), line(6, 985, 5910), line(24, 420, 10080), line(15, 295, 4425), line(1, 1800, 1800)],
      33895, 19.6, 6643, 40538,
    );
    expect(codes(f3)).toEqual([]);
  });

  it("signale une ligne dont quantité × prix unitaire ne fait pas le total", () => {
    expect(codes(invoice([line(3, 18740, 56000)], 56000, 20, 11200, 67200))).toEqual(["ECART_LIGNE"]);
  });

  it("signale un TTC incohérent", () => {
    expect(codes(invoice([line(1, 10000, 10000)], 10000, 20, 2000, 12500))).toEqual(["ECART_TTC"]);
  });

  it("tolère 1 centime d'arrondi", () => {
    expect(codes(invoice([line(1, 10000, 10000)], 10000, 19.6, 1961, 11961))).toEqual([]);
  });

  it("ne conclut pas quand une valeur manque : contrôle impossible, pas de faux écart", () => {
    expect(codes(invoice([line(1, 10000, null)], 10000, 20, 2000, 12000))).toEqual(["CONTROLE_IMPOSSIBLE"]);
  });
});
