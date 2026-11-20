const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const numbers = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

/** 116740 → « 1 167,40 € » */
export const formatCents = (cents: number) => euros.format(cents / 100);

/** 19.6 → « 19,6 » */
export const formatNumber = (value: number) => numbers.format(value);

/** « 2026-06-12 » → « 12/06/2026 » */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

export const formatText = (value: string) => value;

/** Citation lisible pour le comptable : sans gras ni séparateurs de tableau markdown. */
export const cleanQuote = (quote: string) =>
  quote
    .replace(/\*\*|__|^#+\s*/g, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** URL du PDF original, copié par le pipeline dans le dossier public. */
export const pdfUrl = (fichier: string) => `/factures/${encodeURIComponent(fichier)}`;
