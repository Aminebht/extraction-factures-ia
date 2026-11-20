import type { InvoiceResult } from "@juwa/schema";

/** État global d'une facture, du plus urgent au plus sûr. */
export type InvoiceStatus = "echec" | "ecart" | "a_verifier" | "ok";

const PRIORITY: Record<InvoiceStatus, number> = { echec: 0, ecart: 1, a_verifier: 2, ok: 3 };

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  echec: "Non traitée",
  ecart: "Écart détecté",
  a_verifier: "À vérifier",
  ok: "Conforme",
};

export function statusOf(result: InvoiceResult): InvoiceStatus {
  if (result.status === "failed") return "echec";
  if (result.warnings.some((w) => w.severity === "bloquant")) return "ecart";
  if (result.warnings.length > 0) return "a_verifier";
  return "ok";
}

/** Les factures qui demandent une action d'abord, puis par nom de fichier. */
export function sortByUrgency(results: InvoiceResult[]): InvoiceResult[] {
  return [...results].sort(
    (a, b) =>
      PRIORITY[statusOf(a)] - PRIORITY[statusOf(b)] || a.source.fichier.localeCompare(b.source.fichier),
  );
}

/** Nom affiché dans la liste : le fournisseur s'il a été lu, sinon le fichier. */
export function displayName(result: InvoiceResult): string {
  return (result.status === "extracted" && result.invoice.fournisseur.value) || result.source.fichier;
}
