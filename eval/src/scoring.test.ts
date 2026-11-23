import type { Field, InvoiceResult, Warning } from "@juwa/schema";
import { describe, expect, it } from "vitest";
import type { EvalCase } from "./cases.ts";
import { classify, fieldsInvolved, isForbidden, matches, presentInOcr, scoreCase } from "./scoring.ts";

const field = <T>(value: T | null, status: Field<T>["status"] = "ok"): Field<T> => ({
  value,
  status: value === null ? "absent" : status,
  quote: null,
  ocrConfidence: null,
});

describe("matches", () => {
  it("compare les montants attendus en euros aux centimes extraits", () => {
    expect(matches("amount", 1167.4, 116740)).toBe(true);
    expect(matches("amount", 1040, 92500)).toBe(false);
  });

  it("accepte plusieurs réponses pour un texte, sans tenir compte de la casse ni des accents", () => {
    expect(matches("text", ["STUDIO BOTANICA", "Lou Huet"], "Studio Botanica")).toBe(true);
    expect(matches("text", "ATELIER MÉCA-PRÉCISION", "Atelier Meca-Precision")).toBe(true);
    expect(matches("text", "ATELIER MÉCA-PRÉCISION", "GARNIER Industrie")).toBe(false);
  });

  it("tolère une désignation enrichie (titre + sous-ligne)", () => {
    expect(matches("designation", "Vérin hydraulique double effet VDE-80/45", "Vérin hydraulique double effet VDE-80/45 — Course 400 mm")).toBe(true);
    expect(matches("designation", "Vérin hydraulique double effet VDE-80/45", "Kit joints")).toBe(false);
  });
});

describe("classify", () => {
  it("distingue valeur juste, fausse silencieuse, fausse signalée et abstention", () => {
    expect(classify("amount", 1040, field(104000))).toBe("juste");
    expect(classify("amount", 1040, field(92500))).toBe("fausse_silencieuse");
    expect(classify("amount", 1040, field(92500, "a_verifier"))).toBe("fausse_signalee");
    expect(classify("amount", 1040, field<number>(null))).toBe("abstention");
  });

  it("récompense l'abstention quand rien n'est lisible", () => {
    expect(classify("text", null, field<string>(null))).toBe("abstention_correcte");
    expect(classify("text", null, field("0064"))).toBe("fausse_silencieuse");
  });

  it("compte une facture en échec comme une abstention, jamais comme une valeur fausse", () => {
    expect(classify("amount", 1040, null)).toBe("abstention");
  });

  it("ne compte pas comme silencieuse une valeur fausse prise dans un écart bloquant", () => {
    expect(classify("number", 3, field(1), true)).toBe("fausse_ecart");
    expect(classify("number", 3, field(3), true)).toBe("juste");
  });
});

describe("fieldsInvolved", () => {
  const warning = (code: Warning["code"], champ: string | null): Warning => ({ code, severity: "bloquant", field: champ, message: "" });

  it("met en cause tous les termes de l'égalité fausse", () => {
    expect(fieldsInvolved(warning("ECART_LIGNE", "lignes[2].totalLigne"), 4)).toEqual([
      "lignes[2].quantite",
      "lignes[2].prixUnitaire",
      "lignes[2].totalLigne",
    ]);
    expect(fieldsInvolved(warning("ECART_SOMME_LIGNES", "totalHT"), 2)).toEqual(["totalHT", "lignes[0].totalLigne", "lignes[1].totalLigne"]);
    expect(fieldsInvolved(warning("ECART_TTC", "totalTTC"), 2)).toEqual(["totalHT", "montantTVA", "totalTTC"]);
  });
});

describe("scoreCase", () => {
  const evalCase: EvalCase = {
    fichier: "f.pdf",
    attendu: {
      fournisseur: "ACME",
      numero: "F-1",
      date: "2026-01-02",
      totalHT: 30,
      tauxTVA: 20,
      montantTVA: 6,
      totalTTC: 36,
      lignes: [{ designation: "Vis", quantite: 3, prixUnitaire: 10, totalLigne: 30 }],
    },
    interdits: {},
    avertissements_attendus: [],
  };
  const result = (quantite: number, warnings: Warning[]): InvoiceResult =>
    ({
      status: "extracted",
      source: { fichier: "f.pdf", sha256: "x" },
      invoice: {
        fournisseur: field("ACME"),
        numero: field("F-1"),
        date: field("2026-01-02"),
        totalHT: field(3000),
        tauxTVA: field(20),
        montantTVA: field(600),
        totalTTC: field(3600),
        lignes: [{ designation: field("Vis"), quantite: field(quantite), prixUnitaire: field(1000), totalLigne: field(3000) }],
      },
      warnings,
    }) as unknown as InvoiceResult;
  const ecartLigne: Warning = { code: "ECART_LIGNE", severity: "bloquant", field: "lignes[0].totalLigne", message: "" };

  it("une quantité mal lue qui déclenche un écart : valeur repérée et alerte justifiée", () => {
    const s = scoreCase(evalCase, result(1, [ecartLigne]));
    expect(s.fields.find((f) => f.path === "lignes[0].quantite")?.outcome).toBe("fausse_ecart");
    expect(s.unexpectedBlocking).toEqual([]);
    expect(s.justifiedBlocking).toEqual(["ECART_LIGNE"]);
  });

  it("un écart sur des valeurs toutes justes reste une fausse alerte", () => {
    const s = scoreCase(evalCase, result(3, [ecartLigne]));
    expect(s.unexpectedBlocking).toEqual(["ECART_LIGNE"]);
    expect(s.justifiedBlocking).toEqual([]);
  });
});

describe("isForbidden", () => {
  it("repère les faux amis", () => {
    expect(isForbidden("amount", [925], 92500)).toBe(true);
    expect(isForbidden("date", ["2026-07-12"], "2026-07-12")).toBe(true);
    expect(isForbidden("text", ["Ã"], "Ã‰lectrovanne")).toBe(true);
    expect(isForbidden("number", [20], 19.6)).toBe(false);
    expect(isForbidden("text", ["GARNIER Industrie"], "Garnier industrie")).toBe(true);
  });

  it("ne confond pas un caractère de mojibake avec une lettre accentuée normale", () => {
    expect(isForbidden("text", ["Ã", "â"], "HYDROFLUID COMPOSANTS")).toBe(false);
    expect(isForbidden("text", ["Ã", "â"], "Manomètre glycérine")).toBe(false);
  });
});

describe("presentInOcr", () => {
  it("dit si l'erreur vient de l'OCR ou du LLM", () => {
    const ocr = "| TOTAL HT | 1 040€ |\nDate : 03/06/26";
    expect(presentInOcr("amount", 1040, ocr)).toBe(true);
    expect(presentInOcr("amount", 925, ocr)).toBe(false);
    expect(presentInOcr("date", "2026-06-03", ocr)).toBe(true);
  });
});
