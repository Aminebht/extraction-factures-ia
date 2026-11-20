import { describe, expect, it } from "vitest";
import { jsonConstraint } from "./cloudflare.ts";

describe("jsonConstraint", () => {
  const schema = { type: "object" };

  it("passe le schéma par guided_json pour Mistral Small 3.1", () => {
    expect(jsonConstraint("@cf/mistralai/mistral-small-3.1-24b-instruct", schema)).toEqual({ guided_json: schema });
  });

  it("utilise response_format pour les autres modèles", () => {
    expect(jsonConstraint("@cf/meta/llama-3.3-70b-instruct-fp8-fast", schema)).toEqual({
      response_format: { type: "json_schema", json_schema: schema },
    });
  });
});
