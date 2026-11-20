import { z } from "zod";

/**
 * Ce que le LLM a le droit de renvoyer : une valeur et la citation exacte d'où il l'a lue.
 * Il ne renvoie ni statut ni confiance : c'est le code qui certifie, jamais le LLM lui-même.
 */
export const llmField = <T extends z.ZodType>(value: T) =>
  z.object({
    value: value.nullable(),
    /** Passage copié caractère pour caractère depuis le texte OCR ; null si la valeur est null. */
    quote: z.string().nullable(),
  });

export const LlmLineItem = z.object({
  designation: llmField(z.string()),
  quantite: llmField(z.number()),
  /** En euros, tel qu'écrit sur la facture (converti en centimes par le pipeline). */
  prixUnitaire: llmField(z.number()),
  totalLigne: llmField(z.number()),
});

export const LlmInvoice = z.object({
  fournisseur: llmField(z.string()),
  numero: llmField(z.string()),
  /** Date d'émission au format YYYY-MM-DD. */
  date: llmField(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date attendue au format YYYY-MM-DD")),
  lignes: z.array(LlmLineItem),
  totalHT: llmField(z.number()),
  /** En pourcentage (20, 19.6…) ; null si plusieurs taux figurent sur la facture. */
  tauxTVA: llmField(z.number()),
  montantTVA: llmField(z.number()),
  totalTTC: llmField(z.number()),
});

export type LlmField<T> = { value: T | null; quote: string | null };
export type LlmLineItem = z.infer<typeof LlmLineItem>;
export type LlmInvoice = z.infer<typeof LlmInvoice>;
