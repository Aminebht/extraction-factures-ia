import type { LineItem } from "@juwa/schema";
import { formatCents, formatNumber, formatText } from "../lib/format.ts";
import { FieldValue } from "./FieldValue.tsx";

interface Props {
  lines: LineItem[];
  /** Chemins des champs qui portent un écart bloquant (« lignes[1].totalLigne »). */
  flagged: Set<string>;
}

export function LineItemsTable({ lines, flagged }: Props) {
  if (!lines.length) return <p className="notice notice--warning">Aucune ligne de produit n'a été lue.</p>;

  return (
    <div className="table-scroll">
    <table className="lines">
      <thead>
        <tr>
          <th scope="col">Désignation</th>
          <th scope="col" className="num">Qté</th>
          <th scope="col" className="num">Prix unitaire HT</th>
          <th scope="col" className="num">Total HT</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => (
          <tr key={i}>
            <td><FieldValue field={line.designation} format={formatText} /></td>
            <td className="num"><FieldValue field={line.quantite} format={formatNumber} /></td>
            <td className="num"><FieldValue field={line.prixUnitaire} format={formatCents} /></td>
            <td className="num">
              <FieldValue field={line.totalLigne} format={formatCents} flagged={flagged.has(`lignes[${i}].totalLigne`)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
