import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { EvalCase, loadCases } from "../cases.ts";
import { compute, degradedGroundTruth, groundTruth } from "./compute.ts";
import { SYNTH_CASES_DIR } from "./generate.ts";
import { DEGRADED, SPECS } from "./specs.ts";

const truthOf = (id: string) => {
  const spec = SPECS.find((s) => s.id === id)!;
  return groundTruth(spec, compute(spec));
};

describe("vérité terrain synthétique", () => {
  it("chaque cas est un cas d'eval valide", () => {
    for (const spec of SPECS) expect(EvalCase.safeParse(groundTruth(spec, compute(spec))).success, spec.id).toBe(true);
  });

  it("une facture sans erreur volontaire est cohérente : Σ lignes = HT et HT + TVA = TTC", () => {
    for (const spec of SPECS.filter((s) => !s.erreur)) {
      const c = compute(spec);
      expect(c.sommeLignes, spec.id).toBe(c.totalHT);
      expect(c.totalHT + c.montantTVA, spec.id).toBe(c.totalTTC);
    }
  });

  it("le total HT faux est attendu tel qu'imprimé, la somme juste est interdite, l'écart est attendu", () => {
    const t = truthOf("s03_somme_fausse");
    expect(t.attendu.totalHT).toBe(1366);
    expect(t.interdits.totalHT).toEqual([1246]);
    expect(t.avertissements_attendus).toEqual(["ECART_SOMME_LIGNES"]);
  });

  it("deux taux de TVA : ni taux ni montant total attendus (le total n'est pas imprimé), les deux taux sont interdits", () => {
    const t = truthOf("s09_deux_taux");
    expect(t.attendu.tauxTVA).toBeNull();
    expect(t.attendu.montantTVA).toBeNull();
    expect(t.interdits.tauxTVA).toEqual([10, 20]);
  });

  it("numéro absent : abstention attendue", () => {
    expect(truthOf("s08_numero_absent").attendu.numero).toBeNull();
  });

  it("une variante scannée garde la vérité terrain de sa facture d'origine, plus les faux amis du scan", () => {
    const d = DEGRADED.find((x) => x.id === "d03_tampon_sur_totaux")!;
    const source = SPECS.find((s) => s.id === d.source)!;
    const t = degradedGroundTruth(d, source);
    expect(t.attendu).toEqual(groundTruth(source, compute(source)).attendu);
    expect(t.interdits.date).toContain("2026-07-25");
    expect(t.fichier).toBe("d03_tampon_sur_totaux.pdf");
  });

  it("les fichiers YAML du repo correspondent au générateur (pas de modification à la main)", async () => {
    const onDisk = await loadCases(SYNTH_CASES_DIR);
    const expected = [...DEGRADED.map((d) => `${d.id}.pdf`), ...SPECS.map((s) => `${s.id}.pdf`)].sort();
    expect(onDisk.map((c) => c.fichier).sort()).toEqual(expected);
    for (const spec of SPECS) {
      const file = await readFile(path.join(SYNTH_CASES_DIR, `${spec.id}.yaml`), "utf8");
      expect(file.endsWith(stringify(groundTruth(spec, compute(spec)))), spec.id).toBe(true);
    }
    for (const d of DEGRADED) {
      const file = await readFile(path.join(SYNTH_CASES_DIR, `${d.id}.yaml`), "utf8");
      expect(file.endsWith(stringify(degradedGroundTruth(d, SPECS.find((s) => s.id === d.source)!))), d.id).toBe(true);
    }
  });
});
