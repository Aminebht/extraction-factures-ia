import type { Field } from "@juwa/schema";
import { cleanQuote } from "../lib/format.ts";

interface Props<T> {
  field: Field<T>;
  format: (value: T) => string;
  /** Le champ porte un écart bloquant (ex. total HT ≠ somme des lignes). */
  flagged?: boolean;
}

/**
 * Affiche une valeur extraite selon sa fiabilité. Une valeur absente n'est jamais une case vide :
 * elle porte un badge « Non lu ». Au survol, la citation exacte lue sur la facture (traçabilité).
 */
export function FieldValue<T>({ field, format, flagged = false }: Props<T>) {
  const classes = ["field", `field--${field.status}`, flagged ? "field--flagged" : ""].join(" ");

  if (field.status === "absent" || field.value === null) {
    return (
      <span className={classes} title="Valeur non lue ou non prouvée par le document : à saisir à partir du PDF.">
        Non lu
      </span>
    );
  }

  const source = field.quote ? `Lu sur la facture : « ${cleanQuote(field.quote)} »` : "";
  const confidence =
    field.ocrConfidence !== null ? `Confiance de lecture : ${Math.round(field.ocrConfidence * 100)} %` : "";
  const title = [field.status === "a_verifier" ? "Lecture incertaine, à vérifier sur le PDF." : "", source, confidence]
    .filter(Boolean)
    .join("\n");

  return (
    <span className={classes} title={title}>
      {field.status === "a_verifier" && <span aria-hidden="true">⚠ </span>}
      {format(field.value)}
    </span>
  );
}
