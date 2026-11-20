import { Mistral } from "@mistralai/mistralai";
import { runOcr } from "../ocr.ts";
import type { AiProvider } from "./types.ts";

export function mistralProvider(apiKey: string, llmModel: string): AiProvider {
  const client = new Mistral({ apiKey });
  return {
    name: `mistral (${llmModel})`,
    ocr: (pdf) => runOcr(client, pdf),
    async complete(messages, schema) {
      const response = await client.chat.complete({
        model: llmModel,
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
