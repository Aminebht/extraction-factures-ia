import { describe, expect, it } from "vitest";
import { amountAppearsIn, datesIn, numberAppearsIn, parseAmount, toCents } from "./parsing.ts";

describe("parseAmount", () => {
  it.each([
    ["1 167,40 €", 116740],
    ["1 167,40 €", 116740], // espaces insécables
    ["1 167,40", 116740], // espace fine insécable
    ["1.167,40", 116740],
    ["1167.40", 116740],
    ["1 040€", 104000],
    ["320€", 32000],
    ["405,38 EUR", 40538],
    ["14,60", 1460],
    ["1.167", 116700], // point seul suivi de 3 chiffres : milliers
    ["-12,50 €", -1250],
  ])("%s → %i centimes", (text, cents) => {
    expect(parseAmount(text)).toBe(cents);
  });

  it.each(["", "TVA", "Total HT", "1,234,5"])("%s → null", (text) => {
    expect(parseAmount(text)).toBeNull();
  });
});

describe("toCents", () => {
  it("évite les erreurs de flottant", () => {
    expect(toCents(1167.4)).toBe(116740);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});

describe("amountAppearsIn", () => {
  it("retrouve un montant quel que soit son format", () => {
    expect(amountAppearsIn(116740, "Total H.T. 1 167,40 €")).toBe(true);
    expect(amountAppearsIn(116740, "| Total H.T. | 1.167,40 |")).toBe(true);
    expect(amountAppearsIn(104000, "TOTAL HT 1 040€")).toBe(true);
    expect(amountAppearsIn(104000, "TOTAL HT 1 040,00 €")).toBe(true);
    expect(amountAppearsIn(40538, "TOTAL TTC ...... 405,38 EUR")).toBe(true);
  });

  it("ne trouve pas un montant absent (F2 : le LLM qui recalcule)", () => {
    expect(amountAppearsIn(92500, "TOTAL HT 1 040€")).toBe(false);
  });

  it("ne reconnaît pas un nombre à l'intérieur d'un autre", () => {
    expect(amountAppearsIn(16740, "1 167,40 €")).toBe(false);
    expect(amountAppearsIn(4000, "1 040€")).toBe(false);
    expect(amountAppearsIn(116700, "1 167,40 €")).toBe(false);
  });
});

describe("numberAppearsIn", () => {
  it("retrouve quantités et taux", () => {
    expect(numberAppearsIn(19.6, "TVA 19,6% ......")).toBe(true);
    expect(numberAppearsIn(20, "TVA 20 %")).toBe(true);
    expect(numberAppearsIn(12, "| Kit joints | 12 | 38,50 € |")).toBe(true);
  });

  it("ne confond pas 2 et 20, ni 6 et 19,6", () => {
    expect(numberAppearsIn(2, "TVA 20 %")).toBe(false);
    expect(numberAppearsIn(6, "TVA 19,6%")).toBe(false);
  });
});

describe("datesIn", () => {
  it.each([
    ["Date : 17/09/2009", "2009-09-17"],
    ["Date : 03/06/26", "2026-06-03"],
    ["Émise le 12 juin 2026", "2026-06-12"],
    ["Date d'émission : 28 mai 2026", "2026-05-28"],
    ["1er février 2026", "2026-02-01"],
    ["2026-06-03", "2026-06-03"],
  ])("%s → %s", (text, date) => {
    expect(datesIn(text).has(date)).toBe(true);
  });

  it("ignore une date impossible", () => {
    expect(datesIn("45/13/2026").size).toBe(0);
  });
});
