import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BatchResult, LlmInvoice } from "./index.ts";

const llmField = <T>(value: T | null, quote: string | null = value === null ? null : String(value)) => ({
  value,
  quote,
});

const validLlmInvoice = {
  fournisseur: llmField("ATELIER MÉCA-PRÉCISION"),
  numero: llmField("FAC-2026-0342"),
  date: llmField("2026-06-12", "12 juin 2026"),
  lignes: [
    {
      designation: llmField("Kit joints d'étanchéité réf. KJ-2214"),
      quantite: llmField(12),
      prixUnitaire: llmField(38.5, "38,50 €"),
      totalLigne: llmField(462, "462,00 €"),
    },
  ],
  totalHT: llmField(3753, "3 753,00 €"),
  tauxTVA: llmField(20, "TVA 20 %"),
  montantTVA: llmField(750.6, "750,60 €"),
  totalTTC: llmField(4503.6, "4 503,60 €"),
};

describe("LlmInvoice", () => {
  it("accepte une réponse conforme", () => {
    expect(LlmInvoice.safeParse(validLlmInvoice).success).toBe(true);
  });

  it("accepte un champ null (valeur illisible)", () => {
    const invoice = { ...validLlmInvoice, numero: llmField(null) };
    expect(LlmInvoice.safeParse(invoice).success).toBe(true);
  });

  it("rejette une quantité renvoyée en texte", () => {
    const invoice = {
      ...validLlmInvoice,
      lignes: [{ ...validLlmInvoice.lignes[0], quantite: llmField("12") }],
    };
    expect(LlmInvoice.safeParse(invoice).success).toBe(false);
  });

  it("rejette une date qui n'est pas au format ISO", () => {
    const invoice = { ...validLlmInvoice, date: llmField("03/06/26") };
    expect(LlmInvoice.safeParse(invoice).success).toBe(false);
  });

  it("se convertit en JSON Schema pour le structured output de Mistral", () => {
    const schema = z.toJSONSchema(LlmInvoice) as { required?: string[] };
    expect(schema.required).toContain("totalHT");
  });
});

describe("BatchResult", () => {
  it("accepte une facture en échec sans données extraites", () => {
    const batch = {
      generatedAt: "2026-11-20T10:00:00.000Z",
      results: [
        {
          status: "failed",
          source: { fichier: "facture.pdf", sha256: "abc" },
          error: { kind: "LIMITE_DEBIT", message: "Le service d'IA est saturé." },
        },
      ],
    };
    expect(BatchResult.safeParse(batch).success).toBe(true);
  });

  it("rejette un résultat « extracted » sans facture", () => {
    const batch = {
      generatedAt: "2026-11-20T10:00:00.000Z",
      results: [{ status: "extracted", source: { fichier: "f.pdf", sha256: "abc" }, warnings: [] }],
    };
    expect(BatchResult.safeParse(batch).success).toBe(false);
  });
});
