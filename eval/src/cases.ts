import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { WarningCode } from "@juwa/schema";
import { parse } from "yaml";
import { z } from "zod";

/** Une ou plusieurs réponses acceptées pour un texte (« STUDIO BOTANICA » ou « Lou Huet »). */
const Accepted = z.union([z.string(), z.array(z.string()).min(1)]);

// Objets stricts : une clé inattendue (faute de frappe, virgule mal placée en YAML) fait échouer le chargement.
const ExpectedLine = z.strictObject({
  designation: z.string(),
  quantite: z.number(),
  prixUnitaire: z.number(),
  totalLigne: z.number(),
});

export const EvalCase = z.strictObject({
  fichier: z.string(),
  description: z.string().optional(),
  attendu: z.strictObject({
    fournisseur: Accepted.nullable(),
    numero: z.string().nullable(),
    date: z.string().nullable(),
    lignes: z.array(ExpectedLine),
    totalHT: z.number().nullable(),
    tauxTVA: z.number().nullable(),
    montantTVA: z.number().nullable(),
    totalTTC: z.number().nullable(),
  }),
  /** Valeurs plausibles mais fausses, par champ (« lignes.designation » vaut pour toutes les lignes). */
  interdits: z.record(z.string(), z.array(z.union([z.string(), z.number()]))).default({}),
  avertissements_attendus: z.array(WarningCode).default([]),
});

export type EvalCase = z.infer<typeof EvalCase>;
export type ExpectedLine = z.infer<typeof ExpectedLine>;

export const CASES_DIR = path.resolve(import.meta.dirname, "../cas");

export async function loadCases(dir = CASES_DIR): Promise<EvalCase[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort();
  return Promise.all(
    files.map(async (file) => {
      const parsed = EvalCase.safeParse(parse(await readFile(path.join(dir, file), "utf8")));
      if (!parsed.success) throw new Error(`Cas invalide ${file} :\n${z.prettifyError(parsed.error)}`);
      return parsed.data;
    }),
  );
}
