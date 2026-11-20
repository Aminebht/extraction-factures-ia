import type { Warning } from "@juwa/schema";

/** Les écarts bloquants d'abord, puis les points à vérifier. */
export function WarningList({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) {
    return <p className="notice notice--ok">Toutes les valeurs sont lues sur la facture et les montants sont cohérents.</p>;
  }
  const sorted = [...warnings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "bloquant" ? -1 : 1));

  return (
    <ul className="warnings" aria-label="Points d'attention">
      {sorted.map((w, i) => (
        <li key={`${w.code}-${w.field}-${i}`} className={`warning warning--${w.severity}`}>
          <span className="warning__label">{w.severity === "bloquant" ? "Écart" : "À vérifier"}</span>
          {w.message}
        </li>
      ))}
    </ul>
  );
}
