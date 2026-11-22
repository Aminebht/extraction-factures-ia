/**
 * Rendu PDF d'une facture synthétique (pdfkit, sans navigateur). Trois mises en page pour éviter
 * que toutes les factures se ressemblent.
 */
import { createWriteStream } from "node:fs";
import PDFDocument from "pdfkit";
import type { Computed } from "./compute.ts";
import type { Spec } from "./specs.ts";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const CLIENT = ["GARNIER Industrie - Service Achats", "14 rue de l'Artisanat, 38300 Bourgoin-Jallieu"];

function money(c: number, sep: "espace" | "point", withEuro = true): string {
  const sign = c < 0 ? "-" : "";
  const [int, dec] = (Math.abs(c) / 100).toFixed(2).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, sep === "point" ? "." : " ");
  return `${sign}${grouped},${dec}${withEuro ? " €" : ""}`;
}

const qty = (q: number) => String(q).replace(".", ",");
const [Y, M, D] = [0, 1, 2];
function date(iso: string, style: "slash" | "lettres" | "points"): string {
  const p = iso.split("-");
  if (style === "lettres") return `${Number(p[D])} ${MOIS[Number(p[M]) - 1]} ${p[Y]}`;
  if (style === "points") return `${p[D]}.${p[M]}.${p[Y]!.slice(2)}`;
  return `${p[D]}/${p[M]}/${p[Y]}`;
}

type Doc = PDFKit.PDFDocument;
const PAGE_BOTTOM = 760;

interface Column {
  title: string;
  x: number;
  width: number;
  align: "left" | "right";
  cell: (l: Computed["lignes"][number]) => string;
}

/** Tableau des lignes, avec saut de page et en-tête répété. */
function table(doc: Doc, startY: number, columns: Column[], c: Computed, font: string, boldFont: string): number {
  const header = (y: number) => {
    doc.font(boldFont).fontSize(9);
    for (const col of columns) doc.text(col.title, col.x, y, { width: col.width, align: col.align });
    doc.moveTo(50, y + 13).lineTo(545, y + 13).lineWidth(0.8).stroke();
    return y + 20;
  };
  let y = header(startY);
  doc.font(font).fontSize(9);
  for (const line of c.lignes) {
    if (y > PAGE_BOTTOM - 20) {
      doc.addPage();
      y = header(50);
      doc.font(font).fontSize(9);
    }
    for (const col of columns) doc.text(col.cell(line), col.x, y, { width: col.width, align: col.align });
    y += 18;
  }
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke();
  return y + 12;
}

function totals(doc: Doc, y: number, rows: [string, string][], font: string, boldFont: string, labelX = 330): number {
  if (y + rows.length * 18 > PAGE_BOTTOM) {
    doc.addPage();
    y = 50;
  }
  rows.forEach(([label, value], i) => {
    const last = i === rows.length - 1;
    doc.font(last ? boldFont : font).fontSize(last ? 11 : 10);
    doc.text(label, labelX, y, { width: 120 });
    doc.text(value, 450, y, { width: 95, align: "right" });
    y += 18;
  });
  return y;
}

function tvaRows(spec: Spec, c: Computed, sep: "espace" | "point", euro = true): [string, string][] {
  return c.tvaParTaux.map((t) => [`TVA ${qty(t.taux)} %${c.tvaParTaux.length > 1 ? ` sur ${money(t.base, sep, euro)}` : ""}`, money(t.montant, sep, euro)]);
}

function renderClassique(doc: Doc, spec: Spec, c: Computed) {
  const sep = spec.separateurMilliers ?? "espace";
  const f = spec.fournisseur;
  let y = 50;
  if (spec.clientEnTete) {
    doc.font("Helvetica-Bold").fontSize(22).text("GARNIER INDUSTRIE", 50, y);
    doc.font("Helvetica").fontSize(9).text("Service Achats - 14 rue de l'Artisanat, 38300 Bourgoin-Jallieu", 50, y + 28);
    y += 60;
  } else {
    // Un nom long passe sur deux lignes : on mesure sa hauteur pour placer l'adresse dessous.
    doc.font("Helvetica-Bold").fontSize(16).text(f.nom, 50, y, { width: 300 });
    const nameHeight = doc.heightOfString(f.nom, { width: 300 });
    doc.font("Helvetica").fontSize(9).text(`${f.adresse}\nSIRET ${f.siret}`, 50, y + nameHeight + 4, { width: 300 });
    doc.font("Helvetica").fontSize(9).text(`Facturé à :\n${CLIENT.join("\n")}`, 50, y + nameHeight + 40);
    y += nameHeight + 88;
  }
  doc.font("Helvetica-Bold").fontSize(20).text("FACTURE", 380, 50, { width: 165, align: "right" });
  const meta = [spec.numero ? `N° ${spec.numero}` : "", `Date : ${date(spec.date, "slash")}`];
  if (spec.fauxAmis?.numeroCommande) meta.push(`Votre commande : ${spec.fauxAmis.numeroCommande}`);
  if (spec.fauxAmis?.dateEcheance) meta.push(`Échéance : ${date(spec.fauxAmis.dateEcheance, "slash")}`);
  doc.font("Helvetica").fontSize(10).text(meta.filter(Boolean).join("\n"), 330, 78, { width: 215, align: "right" });

  const multi = c.tvaParTaux.length > 1;
  const columns: Column[] = [
    { title: "Désignation", x: 50, width: multi ? 230 : 270, align: "left", cell: (l) => l.designation },
    { title: "Qté", x: multi ? 285 : 325, width: 40, align: "right", cell: (l) => qty(l.quantite) },
    ...(multi ? [{ title: "TVA", x: 330, width: 40, align: "right" as const, cell: (l: Computed["lignes"][number]) => `${qty(l.tauxTVA)} %` }] : []),
    { title: "P.U. HT", x: 375, width: 80, align: "right", cell: (l) => money(l.prixUnitaire, sep) },
    { title: "Total HT", x: 460, width: 85, align: "right", cell: (l) => money(l.total, sep) },
  ];
  y = table(doc, y, columns, c, "Helvetica", "Helvetica-Bold");
  y = totals(doc, y, [["Total HT", money(c.totalHT, sep)], ...tvaRows(spec, c, sep), ["Total TTC", money(c.totalTTC, sep)]], "Helvetica", "Helvetica-Bold");

  const footer = spec.clientEnTete
    ? `Facture émise par ${f.nom} - ${f.adresse} - SIRET ${f.siret}`
    : `${f.nom} - SIRET ${f.siret} - Paiement à 30 jours par virement`;
  doc.font("Helvetica").fontSize(7).text(footer, 50, Math.max(y + 30, 740), { width: 495, align: "center" });
}

function renderColonnes(doc: Doc, spec: Spec, c: Computed) {
  const sep = spec.separateurMilliers ?? "espace";
  const f = spec.fournisseur;
  doc.font("Helvetica-Bold").fontSize(18).text(f.nom, 50, 50, { width: 495, align: "center" });
  doc.font("Helvetica-Oblique").fontSize(9).text(f.adresse, 50, 74, { width: 495, align: "center" });
  doc.font("Helvetica-Bold").fontSize(26).text("Facture", 50, 110);

  const info: [string, string][] = [];
  if (spec.numero) info.push(["Numéro :", `n° ${spec.numero}`]);
  info.push(["Date :", date(spec.date, "lettres")]);
  if (spec.fauxAmis?.dateLivraison) info.push(["Livraison :", date(spec.fauxAmis.dateLivraison, "lettres")]);
  if (spec.fauxAmis?.dateEcheance) info.push(["Échéance :", date(spec.fauxAmis.dateEcheance, "lettres")]);
  info.forEach(([k, v], i) => {
    doc.font("Helvetica-Bold").fontSize(10).text(k, 50, 148 + i * 15);
    doc.font("Helvetica").fontSize(10).text(v, 130, 148 + i * 15);
  });
  doc.font("Helvetica").fontSize(9).text(`Client :\n${CLIENT.join("\n")}\n\nSIREN ${f.siret.slice(0, 11)}`, 330, 148, { width: 215, align: "right" });

  const columns: Column[] = [
    { title: "DESCRIPTION", x: 50, width: 245, align: "left", cell: (l) => l.designation },
    { title: "PRIX HT", x: 300, width: 75, align: "right", cell: (l) => money(l.prixUnitaire, sep) },
    { title: "QUANTITÉ", x: 380, width: 70, align: "right", cell: (l) => qty(l.quantite) },
    { title: "TOTAL", x: 455, width: 90, align: "right", cell: (l) => money(l.total, sep) },
  ];
  const y = table(doc, 240, columns, c, "Helvetica", "Helvetica-Bold");
  totals(doc, y, [["TOTAL HT", money(c.totalHT, sep)], ...tvaRows(spec, c, sep), ["TOTAL", money(c.totalTTC, sep)]], "Helvetica", "Helvetica-Bold");
}

function renderCompact(doc: Doc, spec: Spec, c: Computed) {
  const sep = spec.separateurMilliers ?? "espace";
  const f = spec.fournisseur;
  doc.font("Courier-Bold").fontSize(13).text(f.nom, 50, 50);
  doc.font("Courier").fontSize(9).text(`${f.adresse}\nSIRET ${f.siret}`, 50, 68);
  doc.font("Courier").fontSize(9).text(`Client :\n${CLIENT.join("\n")}`, 330, 68, { width: 215 });

  const lines = [spec.numero ? `FACTURE No ${spec.numero}` : "FACTURE", `Date : ${date(spec.date, "points")}`];
  if (spec.fauxAmis?.numeroCommande) lines.push(`Commande : ${spec.fauxAmis.numeroCommande}`);
  if (spec.fauxAmis?.numeroClient) lines.push(`Code client : ${spec.fauxAmis.numeroClient}`);
  doc.font("Courier-Bold").fontSize(11).text(lines[0]!, 50, 125);
  doc.font("Courier").fontSize(10).text(lines.slice(1).join("\n"), 50, 141);

  const columns: Column[] = [
    { title: "DESIGNATION", x: 50, width: 260, align: "left", cell: (l) => l.designation },
    { title: "QTE", x: 315, width: 45, align: "right", cell: (l) => qty(l.quantite) },
    { title: "P.U. HT", x: 365, width: 80, align: "right", cell: (l) => money(l.prixUnitaire, sep, false) },
    { title: "TOTAL HT", x: 450, width: 95, align: "right", cell: (l) => money(l.total, sep, false) },
  ];
  const y = table(doc, 200, columns, c, "Courier", "Courier-Bold");
  totals(
    doc,
    y,
    [["TOTAL HT ......", money(c.totalHT, sep, false)], ...tvaRows(spec, c, sep, false).map(([k, v]) => [`${k} ...`, v] as [string, string]), ["TOTAL TTC ....", `${money(c.totalTTC, sep, false)} EUR`]],
    "Courier",
    "Courier-Bold",
    300,
  );
}

export function renderPdf(spec: Spec, c: Computed, file: string): Promise<void> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: { Title: `Facture synthétique ${spec.id}`, Producer: "eval/synthetiques", CreationDate: new Date("2026-11-22T00:00:00Z") },
  });
  const done = new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(file);
    stream.on("finish", resolve).on("error", reject);
    doc.pipe(stream);
  });
  ({ classique: renderClassique, colonnes: renderColonnes, compact: renderCompact })[spec.layout](doc, spec, c);
  doc.end();
  return done;
}
