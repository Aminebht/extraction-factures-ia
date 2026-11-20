import { pdfUrl } from "../lib/format.ts";

/** Masque le panneau des miniatures et ajuste la page à la largeur (paramètres du lecteur PDF du navigateur). */
const VIEWER_OPTIONS = "#navpanes=0&view=FitH";

/** Le PDF original à côté des données extraites, pour vérifier d'un coup d'œil. */
export function PdfViewer({ fichier }: { fichier: string }) {
  return (
    <aside className="viewer" aria-label="Facture originale">
      <iframe
        key={fichier}
        className="viewer__frame"
        src={`${pdfUrl(fichier)}${VIEWER_OPTIONS}`}
        title={`Facture originale : ${fichier}`}
      />
    </aside>
  );
}
