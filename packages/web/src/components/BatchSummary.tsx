import type { BatchResult } from "@juwa/schema";
import { statusOf, type InvoiceStatus } from "../lib/invoiceStatus.ts";

const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

export function BatchSummary({ batch }: { batch: BatchResult }) {
  const count = (status: InvoiceStatus) => batch.results.filter((r) => statusOf(r) === status).length;
  const items: [InvoiceStatus, number, string][] = [
    ["ecart", count("ecart"), "avec écart"],
    ["a_verifier", count("a_verifier"), "à vérifier"],
    ["echec", count("echec"), "non traitée(s)"],
    ["ok", count("ok"), "conforme(s)"],
  ];

  return (
    <header className="summary">
      <h1>Factures fournisseurs</h1>
      <p className="summary__meta">
        {batch.results.length} facture(s) traitée(s) le {dateTime.format(new Date(batch.generatedAt))}
      </p>
      <ul className="summary__counts">
        {items
          .filter(([, n]) => n > 0)
          .map(([status, n, label]) => (
            <li key={status} className={`count count--${status}`}>
              <strong>{n}</strong> {label}
            </li>
          ))}
      </ul>
    </header>
  );
}
