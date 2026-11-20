import { afterEach, describe, expect, it, vi } from "vitest";
import { ocrCacheKey } from "../pipeline.ts";
import { geminiOcr } from "./gemini.ts";
import { createLlmProvider, createOcrProvider } from "./index.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("choix des fournisseurs", () => {
  it("choisit l'OCR et le LLM indépendamment", () => {
    vi.stubEnv("OCR_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test");
    vi.stubEnv("LLM_PROVIDER", "cloudflare");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acc");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "tok");
    expect(createOcrProvider().name).toMatch(/^gemini/);
    expect(createLlmProvider().name).toBe("cloudflare (@cf/mistralai/mistral-small-3.1-24b-instruct)");
  });

  it("utilise Mistral par défaut et signale la clé manquante", () => {
    vi.stubEnv("OCR_PROVIDER", "");
    vi.stubEnv("MISTRAL_API_KEY", "");
    expect(() => createOcrProvider()).toThrow("MISTRAL_API_KEY manquante");
  });

  it("refuse un fournisseur inconnu", () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    expect(() => createLlmProvider()).toThrow("LLM_PROVIDER inconnu");
  });
});

describe("cache OCR", () => {
  it("distingue les lectures de deux fournisseurs OCR pour le même PDF", () => {
    expect(ocrCacheKey("abc", "mistral-ocr")).not.toBe(ocrCacheKey("abc", "gemini (gemini-3.8-flash)"));
    expect(ocrCacheKey("abc", "gemini (gemini-3.8-flash)")).toBe("abc.gemini_gemini-3.8-flash_");
  });
});

describe("geminiOcr", () => {
  it("envoie le PDF en images de pages seules et renvoie la transcription", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ candidates: [{ content: { parts: [{ text: "Total HT " }, { text: "1 167,40 €" }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await geminiOcr("cle", "gemini-3.8-flash").ocr(Buffer.from("%PDF-1.4"), "f.pdf");

    expect(result.pages[0]?.markdown).toBe("Total HT 1 167,40 €");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("models/gemini-3.8-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("cle");
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[0].documentMetadata).toEqual({ contentLayers: ["PAGE_IMAGE"] });
  });

  it("transmet le code HTTP pour que le 429 soit relancé", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    await expect(geminiOcr("cle", "m").ocr(Buffer.from("%PDF"), "f.pdf")).rejects.toMatchObject({ statusCode: 429 });
  });
});
