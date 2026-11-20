/**
 * Lecture des nombres et des dates tels qu'ils sont écrits sur une facture française.
 * Fonctions pures : elles ne dépendent ni de l'OCR ni du LLM.
 */

/** Espace, espace insécable, espace fine insécable, point : séparateurs de milliers admis. */
const THOUSANDS_SEP = "[ \\u00A0\\u202F.]";

/** Euros (tels que renvoyés par le LLM) → centimes entiers. */
export function toCents(euros: number): number {
  return Math.round(euros * 100);
}

/**
 * Lit un montant écrit à la française et le renvoie en centimes, ou null s'il n'y en a pas un seul.
 * « 1 167,40 € » → 116740 ; « 1.167,40 » → 116740 ; « 1 040€ » → 104000 ; « 405,38 EUR » → 40538.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/€|eur(os?)?/gi, "").trim();
  if (!/^-?[\d   .,]+$/.test(cleaned) || !/\d/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const digits = cleaned.replace(/^-/, "").replace(/[   ]/g, "");
  const lastComma = digits.lastIndexOf(",");
  const lastDot = digits.lastIndexOf(".");

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Les deux séparateurs : le dernier est le séparateur décimal.
    normalized =
      lastComma > lastDot
        ? digits.replace(/\./g, "").replace(",", ".")
        : digits.replace(/,/g, "");
  } else if (lastComma >= 0) {
    if (digits.indexOf(",") !== lastComma) return null; // « 1,234,5 » : ambigu
    normalized = digits.replace(",", ".");
  } else if (lastDot >= 0) {
    // Point seul : décimal s'il est suivi d'1 ou 2 chiffres (« 1167.40 »), milliers sinon (« 1.167 »).
    normalized = /\.\d{1,2}$/.test(digits) && digits.indexOf(".") === lastDot
      ? digits
      : digits.replace(/\./g, "");
  } else {
    normalized = digits;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return toCents(negative ? -value : value);
}

/**
 * Le montant (en centimes) est-il écrit dans le texte ? Insensible au format : « 1 167,40 »,
 * « 1.167,40 », « 1167.40 » ; « 1 040 », « 1 040,00 » et « 1040€ » pour 104000.
 * Un nombre n'est pas reconnu à l'intérieur d'un autre : 167,40 n'est pas dans « 1 167,40 ».
 */
export function amountAppearsIn(cents: number, text: string): boolean {
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100).toString();
  const decimals = (abs % 100).toString().padStart(2, "0");

  // Partie entière, avec séparateurs de milliers facultatifs : 1167 → 1[ .]?167
  const groups = euros.replace(/\B(?=(\d{3})+(?!\d))/g, "|").split("|");
  const integerPart = groups.join(`${THOUSANDS_SEP}?`);

  let decimalPart: string;
  if (decimals === "00") decimalPart = "(?:[,.]00?)?";
  else if (decimals.endsWith("0")) decimalPart = `[,.]${decimals[0]}0?`;
  else decimalPart = `[,.]${decimals}`;

  const pattern = new RegExp(
    `(?<!\\d)(?<!\\d${THOUSANDS_SEP})${integerPart}${decimalPart}(?![\\d])(?![,.]\\d)`,
  );
  return pattern.test(text);
}

/** Le nombre (quantité, taux de TVA) est-il écrit dans le texte ? « 19,6 » ou « 19.6 » pour 19.6. */
export function numberAppearsIn(value: number, text: string): boolean {
  const [integer, fraction] = String(value).split(".");
  const decimalPart = fraction ? `[,.]${fraction}0*` : "(?:[,.]0+)?";
  const pattern = new RegExp(`(?<![\\d,.])${integer}${decimalPart}(?![\\d])(?![,.]\\d)`);
  return pattern.test(text);
}

const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

/** Minuscules et sans accents : « Février » → « fevrier ». */
export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Toutes les dates écrites dans le texte, au format ISO. Formats lus : 17/09/2009, 03/06/26
 * (année sur 2 chiffres → 20XX), 03.06.2026, 2026-06-03, 12 juin 2026, 1er mai 2026.
 */
export function datesIn(text: string): Set<string> {
  const dates = new Set<string>();
  const folded = foldText(text);
  const add = (date: string | null) => date && dates.add(date);

  for (const m of folded.matchAll(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g)) {
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    add(iso(year, Number(m[2]), Number(m[1])));
  }
  for (const m of folded.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
    add(iso(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  const monthNames = Object.keys(MONTHS).join("|");
  for (const m of folded.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})(?:er)?\\s+(${monthNames})\\s+(\\d{4})`, "g"))) {
    add(iso(Number(m[3]), MONTHS[m[2]!]!, Number(m[1])));
  }
  return dates;
}
