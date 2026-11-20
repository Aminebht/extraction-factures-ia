import { z } from "zod";

export const WarningCode = z.enum([
  // Ancrage d'un champ dans le texte OCR
  "CHAMP_ABSENT", // le LLM n'a pas pu lire la valeur (illisible, masquée, absente)
  "NON_ANCRE", // la citation du LLM est introuvable dans l'OCR : valeur probablement inventée
  "VALEUR_INCOHERENTE_AVEC_SOURCE", // la citation existe mais ne contient pas la valeur renvoyée
  "CONFIANCE_FAIBLE", // valeur ancrée, mais l'OCR était peu sûr à cet endroit
  // Contrôles métier au niveau de la facture
  "ECART_LIGNE", // quantité × prix unitaire ≠ total de la ligne
  "ECART_SOMME_LIGNES", // Σ lignes ≠ total HT
  "ECART_TVA", // total HT × taux ≠ montant TVA
  "ECART_TTC", // total HT + TVA ≠ total TTC
  "CONTROLE_IMPOSSIBLE", // un contrôle n'a pas pu être fait faute de valeurs
]);

export const Severity = z.enum(["bloquant", "attention"]);

export const Warning = z.object({
  code: WarningCode,
  severity: Severity,
  /** Chemin du champ concerné (« totalHT », « lignes[2].quantite ») ; null = la facture entière. */
  field: z.string().nullable(),
  /** Message en français, affiché tel quel au comptable. */
  message: z.string(),
});

export type WarningCode = z.infer<typeof WarningCode>;
export type Severity = z.infer<typeof Severity>;
export type Warning = z.infer<typeof Warning>;
