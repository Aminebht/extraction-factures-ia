import type { InvoiceResult } from "@juwa/schema";
import { pdfUrl } from "../lib/format.ts";
import { StatusBadge } from "./StatusBadge.tsx";

type Failed = Extract<InvoiceResult, { status: "failed" }>;

export function FailedInvoice({ result }: { result: Failed }) {
  return (
    <article className="detail">
      <header className="detail__header">
        <h2>{result.source.fichier}</h2>
        <StatusBadge status="echec" />
      </header>
      <p className="notice notice--error">
        <strong>Cette facture n'a pas pu être lue automatiquement.</strong>
        <br />
        {result.error.message}
      </p>
      <p>
        À saisir manuellement à partir du{" "}
        <a href={pdfUrl(result.source.fichier)} target="_blank" rel="noreferrer">PDF original</a>.
      </p>
    </article>
  );
}
