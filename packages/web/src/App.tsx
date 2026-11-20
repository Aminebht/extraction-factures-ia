import { useState } from "react";
import { BatchSummary } from "./components/BatchSummary.tsx";
import { FailedInvoice } from "./components/FailedInvoice.tsx";
import { InvoiceDetail } from "./components/InvoiceDetail.tsx";
import { InvoiceList } from "./components/InvoiceList.tsx";
import { PdfViewer } from "./components/PdfViewer.tsx";
import { sortByUrgency } from "./lib/invoiceStatus.ts";
import { useBatchResult } from "./lib/useBatchResult.ts";

export function App() {
  const state = useBatchResult();
  const [selected, setSelected] = useState<string | null>(null);

  if (state.status === "loading") {
    return <p className="page-state" role="status">Chargement des factures…</p>;
  }
  if (state.status === "error") {
    return <p className="page-state page-state--error" role="alert">{state.message}</p>;
  }

  const results = sortByUrgency(state.batch.results);
  if (!results.length) {
    return <p className="page-state">Aucune facture dans le dernier traitement.</p>;
  }
  // Par défaut, la facture la plus urgente.
  const current = results.find((r) => r.source.fichier === selected) ?? results[0]!;

  return (
    <div className="layout">
      <main className="layout__main">
        <BatchSummary batch={state.batch} />
        <InvoiceList results={results} selected={current.source.fichier} onSelect={setSelected} />
        {current.status === "extracted" ? <InvoiceDetail result={current} /> : <FailedInvoice result={current} />}
      </main>
      <PdfViewer fichier={current.source.fichier} />
    </div>
  );
}
