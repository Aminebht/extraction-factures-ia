import type { InvoiceResult } from "@juwa/schema";
import { displayName, statusOf } from "../lib/invoiceStatus.ts";
import { StatusBadge } from "./StatusBadge.tsx";

interface Props {
  results: InvoiceResult[];
  selected: string | null;
  onSelect: (fichier: string) => void;
}

export function InvoiceList({ results, selected, onSelect }: Props) {
  return (
    <nav aria-label="Factures">
      <ul className="invoice-list">
        {results.map((result) => {
          const { fichier } = result.source;
          const name = displayName(result);
          return (
            <li key={fichier}>
              <button
                type="button"
                className="invoice-list__item"
                aria-current={fichier === selected}
                onClick={() => onSelect(fichier)}
              >
                <span className="invoice-list__name">{name}</span>
                {name !== fichier && <span className="invoice-list__file">{fichier}</span>}
                <StatusBadge status={statusOf(result)} />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
