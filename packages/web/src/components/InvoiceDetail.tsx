import type { InvoiceResult } from "@juwa/schema";
import { formatCents, formatDate, formatNumber, formatText, pdfUrl } from "../lib/format.ts";
import { statusOf } from "../lib/invoiceStatus.ts";
import { FieldValue } from "./FieldValue.tsx";
import { LineItemsTable } from "./LineItemsTable.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { WarningList } from "./WarningList.tsx";

type Extracted = Extract<InvoiceResult, { status: "extracted" }>;

export function InvoiceDetail({ result }: { result: Extracted }) {
  const { invoice, warnings, source } = result;
  const flagged = new Set(warnings.filter((w) => w.severity === "bloquant" && w.field).map((w) => w.field!));

  return (
    <article className="detail">
      <header className="detail__header">
        <h2>
          <FieldValue field={invoice.fournisseur} format={formatText} />
        </h2>
        <StatusBadge status={statusOf(result)} />
      </header>

      <dl className="detail__meta">
        <div>
          <dt>N° de facture</dt>
          <dd><FieldValue field={invoice.numero} format={formatText} /></dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd><FieldValue field={invoice.date} format={formatDate} /></dd>
        </div>
        <div>
          <dt>Fichier source</dt>
          <dd>
            <a href={pdfUrl(source.fichier)} target="_blank" rel="noreferrer">{source.fichier}</a>
          </dd>
        </div>
      </dl>

      <WarningList warnings={warnings} />

      <LineItemsTable lines={invoice.lignes} flagged={flagged} />

      <dl className="totals">
        <div>
          <dt>Total HT</dt>
          <dd><FieldValue field={invoice.totalHT} format={formatCents} flagged={flagged.has("totalHT")} /></dd>
        </div>
        <div>
          <dt>
            TVA <FieldValue field={invoice.tauxTVA} format={(t) => `${formatNumber(t)} %`} />
          </dt>
          <dd><FieldValue field={invoice.montantTVA} format={formatCents} flagged={flagged.has("montantTVA")} /></dd>
        </div>
        <div className="totals__ttc">
          <dt>Total TTC</dt>
          <dd><FieldValue field={invoice.totalTTC} format={formatCents} flagged={flagged.has("totalTTC")} /></dd>
        </div>
      </dl>

      <p className="hint">Survolez une valeur pour voir le texte exact lu sur la facture.</p>
    </article>
  );
}
