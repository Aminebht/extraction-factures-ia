import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiLlm, toGeminiContents } from "./gemini.ts";

afterEach(() => vi.unstubAllGlobals());

const reply = (text: string) => Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
const messages = [
  { role: "system" as const, content: "règles" },
  { role: "user" as const, content: "<document>…</document>" },
  { role: "assistant" as const, content: "{}" },
  { role: "user" as const, content: "corrige" },
];

describe("toGeminiContents", () => {
  it("met le message système à part et renomme « assistant » en « model »", () => {
    const { systemInstruction, contents } = toGeminiContents(messages);
    expect(systemInstruction).toEqual({ parts: [{ text: "règles" }] });
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });
});

describe("geminiLlm", () => {
  it("demande une sortie JSON contrainte par le schéma", async () => {
    const fetchMock = vi.fn(async () => reply('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    expect(await geminiLlm("cle", "gemini-3.8-flash", 32768).complete(messages, { type: "object" })).toBe('{"ok":true}');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("models/gemini-3.8-flash:generateContent");
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: { type: "object" }, maxOutputTokens: 32768 });
  });

  it("se rabat sur le schéma dans le prompt si responseJsonSchema est refusé (400)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unknown name responseJsonSchema", { status: 400 }))
      .mockResolvedValueOnce(reply('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    expect(await geminiLlm("cle", "m", 8192).complete(messages, { type: "object" })).toBe('{"ok":true}');
    const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(second.generationConfig.responseJsonSchema).toBeUndefined();
    expect(second.contents.at(-1).parts[0].text).toContain("conforme à ce schéma");
  });

  it("laisse remonter un 429 pour que le pipeline le relance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    await expect(geminiLlm("cle", "m", 8192).complete(messages, {})).rejects.toMatchObject({ statusCode: 429 });
  });
});
