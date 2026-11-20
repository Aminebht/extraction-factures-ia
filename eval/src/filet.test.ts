import { describe, expect, it } from "vitest";
import { loadCases } from "./cases.ts";
import { certify, runFilet, syntheticDoc } from "./filet.ts";

const cases = await loadCases();

describe("filet de sécurité", () => {
  it("l'extraction correcte reconstituée passe l'ancrage sans aucun champ écarté", () => {
    for (const c of cases) {
      const doc = syntheticDoc(c);
      if (!doc) continue;
      const { invoice } = certify(doc);
      const statuses = [invoice.fournisseur, invoice.numero, invoice.date, invoice.totalHT, invoice.tauxTVA, invoice.montantTVA, invoice.totalTTC, ...invoice.lignes.flatMap((l) => [l.designation, l.quantite, l.prixUnitaire, l.totalLigne])].map((f) => f.status);
      expect(statuses.every((s) => s === "ok"), c.fichier).toBe(true);
    }
  });

  it("aucune fausse alerte sur les extractions correctes", () => {
    expect(runFilet(cases).faussesAlertes).toEqual([]);
  });

  it("détecte toutes les erreurs injectées, hors limites connues", () => {
    for (const m of runFilet(cases).mutations) {
      if (m.limiteConnue) continue;
      expect(m.detectees, m.nom).toBe(m.essais);
    }
  });
});
