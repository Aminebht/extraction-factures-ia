import { z } from "zod";

/**
 * - ok : la valeur est prouvée par le document et l'OCR était sûr ;
 * - a_verifier : prouvée, mais l'OCR était peu sûr à cet endroit ;
 * - absent : non lue ou non prouvée, la valeur est null.
 */
export const FieldStatus = z.enum(["ok", "a_verifier", "absent"]);

/** Un champ extrait, certifié par le pipeline. */
export const field = <T extends z.ZodType>(value: T) =>
  z.object({
    value: value.nullable(),
    status: FieldStatus,
    /** Provenance : texte exact lu sur la facture. */
    quote: z.string().nullable(),
    /** Confiance OCR du passage cité (0-1) ; null si indisponible. */
    ocrConfidence: z.number().min(0).max(1).nullable(),
  });

/** Montant en centimes entiers : 1 167,40 € = 116740. Jamais de flottant pour l'argent. */
export const Cents = z.number().int();

export const LineItem = z.object({
  designation: field(z.string()),
  quantite: field(z.number()),
  prixUnitaire: field(Cents),
  totalLigne: field(Cents),
});

export const Invoice = z.object({
  fournisseur: field(z.string()),
  numero: field(z.string()),
  date: field(z.string()),
  lignes: z.array(LineItem),
  totalHT: field(Cents),
  tauxTVA: field(z.number()),
  montantTVA: field(Cents),
  totalTTC: field(Cents),
});

export type FieldStatus = z.infer<typeof FieldStatus>;
export type Field<T> = {
  value: T | null;
  status: FieldStatus;
  quote: string | null;
  ocrConfidence: number | null;
};
export type LineItem = z.infer<typeof LineItem>;
export type Invoice = z.infer<typeof Invoice>;
