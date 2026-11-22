/**
 * Dégradation d'une facture synthétique en « scan » : chaque page est rendue en image (pdfjs),
 * abîmée (rotation, flou, bruit, compression, noir et blanc, ombre, tampon), puis remise dans un PDF
 * sans couche texte. L'OCR doit alors vraiment lire l'image. Aléa à graine fixe : reproductible.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import PDFDocument from "pdfkit";

export interface Degradation {
  /** Résolution du scan (points par pouce). */
  dpi: number;
  /** Rotation de la page, en degrés. */
  rotation: number;
  /** Flou gaussien, en pixels. */
  flou: number;
  /** Bruit ajouté à chaque pixel (0 à 1). */
  bruit: number;
  /** Qualité JPEG (0 à 100). */
  qualiteJpeg: number;
  /** Couleur du papier. */
  papier: string;
  /** Fax : image binarisée en noir et blanc, avec parasites. */
  fax?: boolean;
  /** Photo : ombre dégradée sur la page. */
  ombre?: boolean;
  /** Tampon posé sur la page (position et angle relatifs à la page). */
  tampon?: { texte: string; x: number; y: number; angle: number };
}

/** Générateur pseudo-aléatoire à graine (mulberry32) : même graine, même dégradation. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (text: string) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

const pdfjsDir = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

function addNoise(ctx: SKRSContext2D, width: number, height: number, d: Degradation, rand: () => number) {
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const delta = (rand() - 0.5) * d.bruit * 255;
    if (d.fax) {
      const lum = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]! + delta;
      const v = rand() < 0.0015 ? 0 : lum > 150 ? 255 : 0; // seuil + parasites noirs
      px[i] = px[i + 1] = px[i + 2] = v;
    } else {
      px[i] = Math.max(0, Math.min(255, px[i]! + delta));
      px[i + 1] = Math.max(0, Math.min(255, px[i + 1]! + delta));
      px[i + 2] = Math.max(0, Math.min(255, px[i + 2]! + delta));
    }
  }
  ctx.putImageData(image, 0, 0);
}

async function degradePage(page: Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>["promise"]>["getPage"]>>, d: Degradation, rand: () => number): Promise<Buffer> {
  const viewport = page.getViewport({ scale: d.dpi / 72 });
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height);

  // 1. Rendu net de la page.
  const clean = createCanvas(width, height);
  const cleanCtx = clean.getContext("2d");
  cleanCtx.fillStyle = "#ffffff";
  cleanCtx.fillRect(0, 0, width, height);
  await page.render({ canvas: clean as never, canvasContext: cleanCtx as never, viewport }).promise;

  // 2. Papier, rotation et flou.
  const out = createCanvas(width, height);
  const ctx = out.getContext("2d");
  ctx.fillStyle = d.papier;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((d.rotation * Math.PI) / 180);
  ctx.translate(-width / 2, -height / 2);
  if (d.flou > 0) ctx.filter = `blur(${d.flou}px)`;
  ctx.globalCompositeOperation = "multiply"; // le blanc de la page laisse voir le papier
  ctx.drawImage(clean, 0, 0);
  ctx.restore();

  // 3. Tampon encreur, en partie transparent.
  if (d.tampon) {
    const size = Math.round(width * 0.045);
    ctx.save();
    ctx.translate(width * d.tampon.x, height * d.tampon.y);
    ctx.rotate((d.tampon.angle * Math.PI) / 180);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = ctx.fillStyle = "#c0262d";
    ctx.lineWidth = Math.max(3, size / 8);
    ctx.font = `bold ${size}px sans-serif`;
    const w = ctx.measureText(d.tampon.texte).width;
    ctx.strokeRect(-w / 2 - size * 0.4, -size * 0.95, w + size * 0.8, size * 1.5);
    ctx.textAlign = "center";
    ctx.fillText(d.tampon.texte, 0, size * 0.25);
    ctx.restore();
  }

  // 4. Ombre de photo (dégradé assombrissant un côté de la page).
  if (d.ombre) {
    const shade = ctx.createLinearGradient(0, 0, width, height);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(60,50,40,0.45)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);
  }

  // 5. Bruit (ou binarisation fax), puis compression JPEG.
  addNoise(ctx, width, height, d, rand);
  return out.encode("jpeg", d.qualiteJpeg);
}

/** Écrit dans `outFile` une version « scannée » et abîmée de `srcFile` (PDF image, sans texte). */
export async function degradePdf(srcFile: string, outFile: string, d: Degradation, seedKey: string): Promise<void> {
  const rand = prng(seedOf(seedKey));
  const loading = getDocument({
    data: new Uint8Array(await readFile(srcFile)),
    // pdfjs exige un chemin terminé par « / », y compris sous Windows.
    standardFontDataUrl: `${path.join(pdfjsDir, "standard_fonts").replaceAll("\\", "/")}/`,
    verbosity: 0,
  });
  const pdf = await loading.promise;

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false, info: { Title: `Scan ${path.basename(outFile)}`, CreationDate: new Date("2026-11-22T00:00:00Z") } });
  const done = new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(outFile);
    stream.on("finish", resolve).on("error", reject);
    doc.pipe(stream);
  });
  for (let n = 1; n <= pdf.numPages; n++) {
    const jpeg = await degradePage(await pdf.getPage(n), d, rand);
    doc.addPage({ size: "A4", margin: 0 });
    doc.image(jpeg, 0, 0, { width: 595.28, height: 841.89 });
  }
  doc.end();
  await done;
  await loading.destroy();
}
