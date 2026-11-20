import { Mistral } from "@mistralai/mistralai";
import { runOcr } from "../ocr.ts";
import type { LlmProvider, OcrProvider } from "./types.ts";

export function mistralOcr(apiKey: string): OcrProvider {
  const client = new Mistral({ apiKey });
  return { name: "mistral-ocr", ocr: (pdf) => runOcr(client, pdf) };
}

export function mistralLlm(apiKey: string, model: string): LlmProvider {
  const client = new Mistral({ apiKey });
  return {
    name: `mistral (${model})`,
    async complete(messages, schema) {
      const response = await client.chat.complete({
        model,
        temperature: 0,
        messages,
        responseFormat: {
          type: "json_schema",
          jsonSchema: { name: "facture", schemaDefinition: schema, strict: true },
        },
      });
      const content = response.choices[0]?.message?.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content.map((c) => ("text" in c && typeof c.text === "string" ? c.text : "")).join("");
      }
      return "";
    },
  };
}
