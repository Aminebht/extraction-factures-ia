import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { noOcrCache } from "./cache.ts";
import { HttpError } from "./errors.ts";
import type { OcrResult } from "./ocr.ts";
import { processBatch, processInvoice, type PipelineDeps } from "./pipeline.ts";
import type { LlmProvider, OcrProvider } from "./providers/index.ts";

type FakeProvider = OcrProvider & LlmProvider;

const OCR_TEXT = "FACTURE N° A-1 du 12/06/2026\nACME SAS\n| Vis | 2 | 5,00 € | 10,00 € |\nTotal HT 10,00 €\nTVA 20 % 2,00 €\nTotal TTC 12,00 €";

const LLM_ANSWER = JSON.stringify({
  fournisseur: { value: "ACME SAS", quote: "ACME SAS" },
  numero: { value: "A-1", quote: "FACTURE N° A-1" },
  date: { value: "2026-06-12", quote: "du 12/06/2026" },
  lignes: [
    {
      designation: { value: "Vis", quote: "Vis" },
      quantite: { value: 2, quote: "| Vis | 2 |" },
      prixUnitaire: { value: 5, quote: "5,00 €" },
      totalLigne: { value: 10, quote: "10,00 €" },
    },
  ],
  totalHT: { value: 10, quote: "Total HT 10,00 €" },
  tauxTVA: { value: 20, quote: "TVA 20 %" },
  montantTVA: { value: 2, quote: "TVA 20 % 2,00 €" },
  totalTTC: { value: 12, quote: "Total TTC 12,00 €" },
});

const ocrResult = (markdown: string): OcrResult => ({
  model: "fake",
  pages: [{ index: 0, markdown, words: [], averageConfidence: null, minimumConfidence: null }],
});

/** Fournisseur factice : le comportement du LLM dépend du fichier, repéré par son contenu OCR. */
function fakeProvider(complete: (markdown: string) => Promise<string>): FakeProvider {
  return {
    name: "fake",
    ocr: async (pdf) => ocrResult(`${OCR_TEXT}\n${pdf.toString("latin1")}`),
    complete: async (messages) => complete(messages[1]?.content ?? ""),
  };
}

const deps = (provider: FakeProvider): PipelineDeps => ({
  ocr: provider,
  llm: provider,
  cache: noOcrCache,
  ocrConfidenceThreshold: 0.8,
  retry: { attempts: 3, baseDelayMs: 0, sleep: async () => {} },
});

function writePdfs(names: string[]): string[] {
  const dir = mkdtempSync(path.join(tmpdir(), "factures-"));
  return names.map((name) => {
    const file = path.join(dir, name);
    writeFileSync(file, `%PDF-1.4 ${name}`);
    return file;
  });
}

describe("processBatch", () => {
  it("une facture en échec ne fait pas tomber les autres", async () => {
    const files = writePdfs(["a.pdf", "b.pdf", "c.pdf"]);
    const provider = fakeProvider(async (doc) => {
      if (doc.includes("b.pdf")) throw new Error("panne inattendue du LLM");
      return LLM_ANSWER;
    });

    const batch = await processBatch(files, deps(provider), 2);

    expect(batch.results.map((r) => r.status)).toEqual(["extracted", "failed", "extracted"]);
    const b = batch.results[1];
    expect(b?.status === "failed" && b.error.kind).toBe("LLM_INVALIDE");
  });

  it("produit une facture certifiée sans avertissement quand tout est cohérent", async () => {
    const [file] = writePdfs(["a.pdf"]);
    const result = await processInvoice(file!, deps(fakeProvider(async () => LLM_ANSWER)));
    expect(result.status).toBe("extracted");
    if (result.status === "extracted") {
      expect(result.invoice.totalTTC).toMatchObject({ value: 1200, status: "ok" });
      expect(result.warnings).toEqual([]);
    }
  });
});

describe("processInvoice : gestion des erreurs", () => {
  it("rejette un fichier qui n'est pas un PDF", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "factures-"));
    const file = path.join(dir, "faux.pdf");
    writeFileSync(file, "ceci n'est pas un pdf");
    const result = await processInvoice(file, deps(fakeProvider(async () => LLM_ANSWER)));
    expect(result.status === "failed" && result.error.kind).toBe("FICHIER_ILLISIBLE");
  });

  it("relance après un 429 puis réussit", async () => {
    const [file] = writePdfs(["a.pdf"]);
    let calls = 0;
    const provider = fakeProvider(async () => {
      calls++;
      if (calls <= 2) throw new HttpError(429, new Headers({ "retry-after": "0" }), "rate limit");
      return LLM_ANSWER;
    });
    const result = await processInvoice(file!, deps(provider));
    expect(result.status).toBe("extracted");
    expect(calls).toBe(3);
  });

  it("traite un délai dépassé (408) comme passager, puis l'explique au comptable", async () => {
    const [file] = writePdfs(["a.pdf"]);
    let calls = 0;
    const provider = fakeProvider(async () => {
      calls++;
      throw new HttpError(408, new Headers(), "Request timeout");
    });
    const result = await processInvoice(file!, deps(provider));
    expect(calls).toBe(3);
    expect(result.status === "failed" && result.error.message).toContain("trop de temps");
  });

  it("abandonne après 3 tentatives sur 429 : LIMITE_DEBIT", async () => {
    const [file] = writePdfs(["a.pdf"]);
    const provider = fakeProvider(async () => {
      throw new HttpError(429, new Headers(), "rate limit");
    });
    const result = await processInvoice(file!, deps(provider));
    expect(result.status === "failed" && result.error.kind).toBe("LIMITE_DEBIT");
  });

  it("relance une fois avec les erreurs Zod, puis accepte la réponse corrigée", async () => {
    const [file] = writePdfs(["a.pdf"]);
    const answers = ['{"fournisseur": "pas le bon format"}', LLM_ANSWER];
    const prompts: string[] = [];
    const provider: FakeProvider = {
      name: "fake",
      ocr: async () => ocrResult(OCR_TEXT),
      complete: async (messages) => {
        prompts.push(messages.at(-1)?.content ?? "");
        return answers.shift() ?? "";
      },
    };
    const result = await processInvoice(file!, deps(provider));
    expect(result.status).toBe("extracted");
    expect(prompts[1]).toContain("ne respecte pas le schéma");
  });

  it("échoue en LLM_INVALIDE si la réponse reste invalide après relance", async () => {
    const [file] = writePdfs(["a.pdf"]);
    const result = await processInvoice(file!, deps(fakeProvider(async () => "pas du json")));
    expect(result.status === "failed" && result.error.kind).toBe("LLM_INVALIDE");
  });
});
