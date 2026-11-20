import type { Field } from "@juwa/schema";
import { describe, expect, it } from "vitest";
import { classify, isForbidden, matches, presentInOcr } from "./scoring.ts";

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
