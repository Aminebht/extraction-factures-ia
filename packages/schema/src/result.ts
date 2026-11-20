import { z } from "zod";
import { Invoice } from "./invoice.ts";
import { Warning } from "./warning.ts";

/** Traçabilité : de quel fichier vient la facture. */
export const Source = z.object({
  /** Nom du fichier PDF, relatif au dossier traité. */
  fichier: z.string(),
  /** Empreinte du contenu : un PDF renommé reste identifiable. */
  sha256: z.string(),
});

export const FailureKind = z.enum([
  "FICHIER_ILLISIBLE", // PDF absent, vide ou corrompu
  "OCR", // Mistral OCR a échoué ou n'a rien lu
  "LLM_INVALIDE", // réponse non conforme au schéma, même après relance
  "RESEAU", // erreur réseau ou serveur, même après relances
  "LIMITE_DEBIT", // 429 persistant
]);

export const InvoiceResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("extracted"),
    source: Source,
    invoice: Invoice,
    warnings: z.array(Warning),
  }),
  z.object({
    status: z.literal("failed"),
    source: Source,
    error: z.object({
      kind: FailureKind,
      /** Message en français, compréhensible par le comptable. */
      message: z.string(),
    }),
  }),
]);

/** Le fichier lu par l'interface. */
export const BatchResult = z.object({
  generatedAt: z.iso.datetime(),
  results: z.array(InvoiceResult),
});

export type Source = z.infer<typeof Source>;
export type FailureKind = z.infer<typeof FailureKind>;
export type InvoiceResult = z.infer<typeof InvoiceResult>;
export type BatchResult = z.infer<typeof BatchResult>;
