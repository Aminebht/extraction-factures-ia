/**
 * Rapport visuel des factures synthétiques : pour chaque facture, le PDF, le piège testé, le verdict
 * et la comparaison attendu / obtenu. Fichier HTML autonome (PDF intégrés), à ouvrir dans un navigateur.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BatchResult } from "@juwa/schema";
import type { EvalCase } from "../cases.ts";
import { caseProblems } from "../report.ts";
import type { CaseScore, FieldScore, Metrics, Outcome } from "../scoring.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

const LABELS: Record<string, string> = {
  fournisseur: "Fournisseur",
  numero: "N° de facture",
  date: "Date",
  totalHT: "Total HT",
  tauxTVA: "Taux de TVA",
  montantTVA: "Montant TVA",
  totalTTC: "Total TTC",
};

const OUTCOME: Record<Outcome, { label: string; tone: "ok" | "warn" | "bad" }> = {
  juste: { label: "✓ Juste", tone: "ok" },
  abstention_correcte: { label: "✓ Laissé vide (rien à lire)", tone: "ok" },
  abstention: { label: "Non lu (valeur pourtant lisible)", tone: "warn" },
  fausse_signalee: { label: "Faux, mais signalé « à vérifier »", tone: "warn" },
  fausse_silencieuse: { label: "✗ FAUX affiché comme sûr", tone: "bad" },
};

/** Valeur lisible : montants attendus en euros, obtenus en centimes. */
function show(f: FieldScore, which: "expected" | "got"): string {
  const v = which === "expected" ? f.expected : f.got;
  if (v === null) return which === "expected" ? "— <em>(rien à lire)</em>" : "— <em>(vide)</em>";
  if (Array.isArray(v)) return esc(v.join(" ou "));
  if (f.kind === "amount") return euros.format(which === "expected" ? Number(v) : Number(v) / 100);
  if (f.kind === "date") return esc(String(v).split("-").reverse().join("/"));
  if (f.kind === "number" && f.path === "tauxTVA") return `${String(v).replace(".", ",")} %`;
  return esc(String(v));
}

function formatForbidden(field: string, value: string | number): string {
  if (typeof value !== "number") return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : value;
  if (field === "tauxTVA") return `${String(value).replace(".", ",")} %`;
  return ["totalHT", "totalTTC", "montantTVA"].includes(field) ? euros.format(value) : String(value);
}

function fieldRow(f: FieldScore): string {
  const o = OUTCOME[f.outcome];
  const label = LABELS[f.path] ?? f.path.replace(/^lignes\[(\d+)\]\./, (_, i) => `Ligne ${Number(i) + 1} · `);
  return `<tr><td>${esc(label)}</td><td>${show(f, "expected")}</td><td>${show(f, "got")}</td><td><span class="tag ${o.tone}">${o.label}${f.interdit ? " · faux ami" : ""}</span></td></tr>`;
}

function card(c: EvalCase, s: CaseScore, result: BatchResult["results"][number] | undefined, pdf: string): string {
  const problems = caseProblems(s);
  const ok = problems.length === 0;
  const piege = (c.description ?? "").replace(/^Synthétique : /, "");
  const header = s.fields.filter((f) => !f.path.startsWith("lignes["));
  const lines = s.fields.filter((f) => f.path.startsWith("lignes["));
  const lineOk = lines.filter((f) => f.outcome === "juste").length;
  const lineIssues = lines.filter((f) => f.outcome !== "juste" && f.outcome !== "abstention_correcte");
  const raised = result?.status === "extracted" ? [...new Set(result.warnings.filter((w) => w.severity === "bloquant").map((w) => w.code))] : [];
  const forbidden = Object.entries(c.interdits).filter(([k]) => k !== "fournisseur" || c.interdits[k]!.some((v) => v !== "GARNIER Industrie"));

  return `
<section class="card ${ok ? "pass" : "fail"}">
  <header>
    <div><h2>${esc(c.fichier.replace(".pdf", ""))}</h2><p class="trap">${esc(piege)}</p></div>
    <span class="verdict ${ok ? "pass" : "fail"}">${ok ? "✓ Piège déjoué" : "✗ Échec"}</span>
  </header>
  <div class="body">
    <iframe class="pdf" data-pdf="${pdf}" title="${esc(c.fichier)}"></iframe>
    <div class="details">
      ${result?.status === "failed" ? `<p class="alert">Facture non traitée : ${esc(result.error.message)}</p>` : ""}
      <table>
        <thead><tr><th>Champ</th><th>Attendu</th><th>Obtenu</th><th>Résultat</th></tr></thead>
        <tbody>
          ${header.map(fieldRow).join("")}
          <tr class="sum"><td>Lignes de produits</td><td colspan="2">${lineOk} champs justes sur ${lines.length}</td><td><span class="tag ${lineIssues.length ? "warn" : "ok"}">${lineIssues.length ? `${lineIssues.length} à revoir` : "✓ Toutes justes"}</span></td></tr>
          ${lineIssues.slice(0, 6).map(fieldRow).join("")}
        </tbody>
      </table>
      <p class="meta"><strong>Écarts attendus :</strong> ${c.avertissements_attendus.length ? c.avertissements_attendus.join(", ") : "aucun"} · <strong>Écarts levés :</strong> ${raised.length ? raised.join(", ") : "aucun"}</p>
      ${forbidden.length ? `<p class="meta"><strong>Faux amis à ne pas renvoyer :</strong> ${forbidden.map(([k, v]) => `${esc(LABELS[k] ?? k)} ≠ ${esc(v.map((x) => formatForbidden(k, x)).join(", "))}`).join(" · ")}</p>` : ""}
      ${ok ? "" : `<p class="meta problems"><strong>Pourquoi l'échec :</strong> ${esc(problems.slice(0, 3).join(" ; "))}${problems.length > 3 ? ` (+${problems.length - 3})` : ""}</p>`}
    </div>
  </div>
</section>`;
}

export async function htmlReport(
  cases: EvalCase[],
  scores: CaseScore[],
  batch: BatchResult,
  metrics: Metrics,
  pdfDir: string,
): Promise<string> {
  const passed = scores.filter((s) => caseProblems(s).length === 0).length;
  const cards: string[] = [];
  for (const c of cases) {
    const s = scores.find((x) => x.fichier === c.fichier);
    if (!s) continue;
    const pdf = (await readFile(path.join(pdfDir, c.fichier))).toString("base64");
    cards.push(card(c, s, batch.results.find((r) => r.source.fichier === c.fichier), pdf));
  }
  const kpi = (value: string, label: string, tone: string) => `<div class="kpi ${tone}"><strong>${value}</strong><span>${label}</span></div>`;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Factures synthétiques · rapport</title>
<style>
  :root { --text:#1c2430; --muted:#5b6676; --line:#dfe3e8; --bg:#f5f6f8; --ok:#1f7a4d; --ok-bg:#e6f4ec; --warn:#8a5a00; --warn-bg:#fff3d6; --bad:#b42318; --bad-bg:#fdecea; }
  * { box-sizing:border-box } body { margin:0; padding:24px; font:14px/1.5 system-ui,"Segoe UI",sans-serif; color:var(--text); background:var(--bg) }
  h1 { margin:0 0 4px; font-size:1.5rem } .sub { margin:0 0 18px; color:var(--muted) }
  .kpis { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px }
  .kpi { background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px 16px; min-width:170px }
  .kpi strong { display:block; font-size:1.5rem } .kpi span { color:var(--muted); font-size:.85rem }
  .kpi.ok strong { color:var(--ok) } .kpi.bad strong { color:var(--bad) } .kpi.warn strong { color:var(--warn) }
  .legend { color:var(--muted); font-size:.85rem; margin:0 0 20px }
  .card { background:#fff; border:1px solid var(--line); border-left:5px solid var(--ok); border-radius:0 10px 10px 0; margin-bottom:18px; overflow:hidden }
  .card.fail { border-left-color:var(--bad) }
  .card header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:14px 18px; border-bottom:1px solid var(--line) }
  h2 { margin:0; font-size:1.05rem } .trap { margin:2px 0 0; color:var(--muted) }
  .verdict { padding:4px 12px; border-radius:999px; font-weight:700; white-space:nowrap }
  .verdict.pass { background:var(--ok-bg); color:var(--ok) } .verdict.fail { background:var(--bad-bg); color:var(--bad) }
  .body { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.15fr) }
  .pdf { width:100%; height:520px; border:0; border-right:1px solid var(--line); background:#eceef1 }
  .details { padding:14px 18px; overflow-x:auto }
  table { width:100%; border-collapse:collapse; font-size:.9rem }
  th { text-align:left; color:var(--muted); font-size:.8rem; border-bottom:2px solid var(--line); padding:4px 6px }
  td { padding:5px 6px; border-bottom:1px solid var(--line); vertical-align:top }
  tr.sum td { background:#fafbfc; font-weight:600 }
  .tag { display:inline-block; padding:1px 8px; border-radius:999px; font-size:.8rem; font-weight:600; white-space:nowrap }
  .tag.ok { background:var(--ok-bg); color:var(--ok) } .tag.warn { background:var(--warn-bg); color:var(--warn) } .tag.bad { background:var(--bad-bg); color:var(--bad) }
  .meta { margin:10px 0 0; font-size:.85rem } .problems { color:var(--bad) }
  .alert { margin:0 0 10px; padding:8px 12px; background:var(--bad-bg); color:var(--bad); border-radius:6px }
  em { color:var(--muted) }
  @media (max-width:900px) { .body { grid-template-columns:1fr } .pdf { height:380px; border-right:0; border-bottom:1px solid var(--line) } }
</style></head><body>
<h1>Factures synthétiques à pièges</h1>
<p class="sub">${cases.length} fausses factures générées, chacune isolant un piège, passées dans la chaîne complète (OCR → LLM → ancrage → contrôles). Passage du ${esc(new Date(batch.generatedAt).toLocaleString("fr-FR"))}.</p>
<div class="kpis">
  ${kpi(`${passed} / ${scores.length}`, "pièges déjoués", passed === scores.length ? "ok" : "warn")}
  ${kpi(String(metrics.fausseSilencieuse), "valeurs fausses affichées comme sûres", metrics.fausseSilencieuse ? "bad" : "ok")}
  ${kpi(String(metrics.interdits), "faux amis renvoyés", metrics.interdits ? "bad" : "ok")}
  ${kpi(`${metrics.avertissementsAttendus - metrics.avertissementsManques} / ${metrics.avertissementsAttendus}`, "écarts réels détectés", metrics.avertissementsManques ? "bad" : "ok")}
  ${kpi(String(metrics.facturesEnEchec), "facture(s) non traitée(s)", metrics.facturesEnEchec ? "warn" : "ok")}
</div>
<p class="legend">Une facture « déjoue son piège » si tous ses champs sont justes (ou laissés vides quand rien n'est lisible), si les écarts attendus sont signalés et s'il n'y a aucune fausse alerte. L'erreur grave est une valeur <strong>fausse affichée comme sûre</strong> ; une valeur laissée vide coûte seulement une saisie au comptable.</p>
${cards.join("\n")}
<script>
  for (const frame of document.querySelectorAll("iframe[data-pdf]")) {
    const bytes = Uint8Array.from(atob(frame.dataset.pdf), (c) => c.charCodeAt(0));
    frame.src = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })) + "#navpanes=0&view=FitH";
  }
</script>
</body></html>
`;
}
