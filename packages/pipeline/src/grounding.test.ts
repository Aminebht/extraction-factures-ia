import { describe, expect, it } from "vitest";
import type { Warning } from "@juwa/schema";
import { certifyField, locateQuote, normalizeWithMap, type CertifyContext } from "./grounding.ts";
import type { OcrResult, OcrWord } from "./ocr.ts";

/** Page OCR factice : chaque mot reçoit la confiance donnée (0,99 par défaut). */
function fakeOcr(markdown: string, lowConfidence: Record<string, number> = {}): OcrResult {
  const words: OcrWord[] = [];
  for (const m of markdown.matchAll(/\S+/g)) {
    words.push({ text: m[0], start: m.index, confidence: lowConfidence[m[0]] ?? 0.99 });
  }
  return {
    model: "test",
    pages: [{ index: 0, markdown, words, averageConfidence: 0.99, minimumConfidence: 0.5 }],
  };
}

const F2 = `| TOTAL HT | | 1 040€ |
| TVA 20% | | 208€ |
| **TOTAL** | | **1 248€** |
Numéro : n° 2026-087
Date : 03/06/26`;

function ctx(ocr: OcrResult): CertifyContext {
  return { ocr, threshold: 0.8, warnings: [] as Warning[] };
}

describe("normalizeWithMap", () => {
  it("ignore casse, accents, séparateurs de tableau et gras markdown", () => {
    expect(normalizeWithMap("| **TOTAL  Général** |").text).toBe("total general");
  });
});

describe("locateQuote", () => {
  it("retrouve une citation malgré la mise en forme markdown", () => {
    expect(locateQuote(fakeOcr(F2), "TOTAL 1 248€")).not.toBeNull();
  });

  it("renvoie null pour une citation inventée", () => {
    expect(locateQuote(fakeOcr(F2), "TOTAL HT 925€")).toBeNull();
  });
});

describe("certifyField", () => {
  it("ok : citation ancrée, valeur lisible, OCR sûr ; montant converti en centimes", () => {
    const c = ctx(fakeOcr(F2));
    const field = certifyField("amount", { value: 1040, quote: "TOTAL HT | | 1 040€" }, "totalHT", "Total HT", c);
    expect(field).toMatchObject({ value: 104000, status: "ok" });
    expect(c.warnings).toEqual([]);
  });

  it("absent : le LLM n'a pas pu lire la valeur (n° masqué de F3)", () => {
    const c = ctx(fakeOcr(F2));
    const field = certifyField("text", { value: null, quote: null }, "numero", "Numéro", c);
    expect(field).toMatchObject({ value: null, status: "absent" });
    expect(c.warnings[0]?.code).toBe("CHAMP_ABSENT");
  });

  it("absent : citation introuvable dans l'OCR (valeur inventée)", () => {
    const c = ctx(fakeOcr(F2));
    const field = certifyField("text", { value: "2026-088", quote: "n° 2026-088" }, "numero", "Numéro", c);
    expect(field).toMatchObject({ value: null, status: "absent" });
    expect(c.warnings[0]?.code).toBe("NON_ANCRE");
  });

  it("absent : la citation existe mais ne contient pas la valeur (F2 : LLM qui recalcule 925)", () => {
    const c = ctx(fakeOcr(F2));
    const field = certifyField("amount", { value: 925, quote: "TOTAL HT | | 1 040€" }, "totalHT", "Total HT", c);
    expect(field).toMatchObject({ value: null, status: "absent" });
    expect(c.warnings[0]?.code).toBe("VALEUR_INCOHERENTE_AVEC_SOURCE");
  });

  it("a_verifier : valeur ancrée mais un mot cité est peu sûr", () => {
    const c = ctx(fakeOcr(F2, { "208€": 0.42 }));
    const field = certifyField("amount", { value: 208, quote: "TVA 20% | | 208€" }, "montantTVA", "Montant de TVA", c);
    expect(field).toMatchObject({ value: 20800, status: "a_verifier", ocrConfidence: 0.42 });
    expect(c.warnings[0]?.code).toBe("CONFIANCE_FAIBLE");
  });

  it("lit une date à année sur 2 chiffres", () => {
    const c = ctx(fakeOcr(F2));
    const field = certifyField("date", { value: "2026-06-03", quote: "Date : 03/06/26" }, "date", "Date", c);
    expect(field.status).toBe("ok");
  });

  it("refuse une date qui ne correspond pas à la citation (inversion jour/mois)", () => {
    const c = ctx(fakeOcr(F2));
    const field = certifyField("date", { value: "2026-03-06", quote: "Date : 03/06/26" }, "date", "Date", c);
    expect(field.status).toBe("absent");
  });
});
