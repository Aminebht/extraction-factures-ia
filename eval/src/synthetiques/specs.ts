/**
 * Factures synthétiques à pièges contrôlés. Chaque facture isole un piège ; la vérité terrain est
 * calculée à partir des mêmes données que le PDF, elle est donc exacte par construction.
 *
 * Tous les fournisseurs sont fictifs ; le client est toujours GARNIER Industrie (cas du sujet).
 */

export type Layout = "classique" | "colonnes" | "compact";

export interface SpecLine {
  designation: string;
  quantite: number;
  /** En euros (négatif pour une remise). */
  prixUnitaire: number;
  /** Taux de TVA de la ligne ; par défaut celui de la facture. */
  tauxTVA?: number;
}

export interface Spec {
  id: string;
  /** Ce que la facture met à l'épreuve, en une phrase. */
  piege: string;
  layout: Layout;
  fournisseur: { nom: string; adresse: string; siret: string };
  /** null : le numéro n'est pas imprimé sur la facture. */
  numero: string | null;
  /** Date d'émission, ISO. */
  date: string;
  tauxTVA: number;
  lignes: SpecLine[];
  /** « point » : 1.234,56 € au lieu de 1 234,56 €. */
  separateurMilliers?: "espace" | "point";
  /** Mentions imprimées à côté des vraies valeurs (faux amis). */
  fauxAmis?: { numeroCommande?: string; numeroClient?: string; dateLivraison?: string; dateEcheance?: string };
  /** Le client occupe l'en-tête, le fournisseur n'apparaît qu'en petit. */
  clientEnTete?: boolean;
  /** Erreurs volontaires dans les totaux imprimés (en euros ajoutés au total juste). */
  erreur?: { totalHT?: number; totalTTC?: number };
}

const fournisseur = (nom: string, adresse: string, siret: string) => ({ nom, adresse, siret });

export const SPECS: Spec[] = [
  {
    id: "s01_reference",
    piege: "Facture propre de référence : aucune anomalie, tout doit être « ok ».",
    layout: "classique",
    fournisseur: fournisseur("FOURNITURES INDUSTRIELLES DU RHÔNE", "12 rue des Forges, 69007 Lyon", "418 552 903 00027"),
    numero: "FI-2026-0815",
    date: "2026-09-14",
    tauxTVA: 20,
    lignes: [
      { designation: "Gants de manutention nitrile (boîte de 50)", quantite: 6, prixUnitaire: 18.4 },
      { designation: "Lunettes de protection EN166", quantite: 12, prixUnitaire: 7.95 },
      { designation: "Ruban de signalisation 100 m", quantite: 4, prixUnitaire: 11.2 },
      { designation: "Chiffons industriels (sac de 10 kg)", quantite: 3, prixUnitaire: 26.5 },
    ],
  },
  {
    id: "s02_tva_reduite",
    piege: "TVA à 5,5 % (livres techniques) : le taux lu ne doit pas être remplacé par 20 %.",
    layout: "compact",
    fournisseur: fournisseur("LIBRAIRIE TECHNIQUE LYONNAISE", "3 quai Saint-Antoine, 69002 Lyon", "502 117 846 00015"),
    numero: "LT-26-3342",
    date: "2026-10-02",
    tauxTVA: 5.5,
    lignes: [
      { designation: "Manuel d'hydraulique industrielle, 4e édition", quantite: 3, prixUnitaire: 64.0 },
      { designation: "Normes ISO 4413 - recueil commenté", quantite: 1, prixUnitaire: 142.0 },
      { designation: "Guide de maintenance des vérins", quantite: 5, prixUnitaire: 38.5 },
    ],
  },
  {
    id: "s03_somme_fausse",
    piege: "Le total HT imprimé ne correspond pas à la somme des lignes : transcrire, puis signaler l'écart.",
    layout: "colonnes",
    fournisseur: fournisseur("NETTOYAGE PRO ALPES", "45 avenue de la Gare, 38100 Grenoble", "811 204 377 00012"),
    numero: "NPA-2026-218",
    date: "2026-08-29",
    tauxTVA: 20,
    lignes: [
      { designation: "Nettoyage atelier (forfait mensuel)", quantite: 1, prixUnitaire: 680.0 },
      { designation: "Vitrerie bureaux", quantite: 2, prixUnitaire: 145.0 },
      { designation: "Évacuation déchets industriels", quantite: 3, prixUnitaire: 92.0 },
    ],
    erreur: { totalHT: 120 },
  },
  {
    id: "s04_ttc_faux",
    piege: "Le total TTC imprimé ne vaut pas HT + TVA : transcrire, puis signaler l'écart.",
    layout: "classique",
    fournisseur: fournisseur("TRANSPORTS VERCORS LOGISTIQUE", "ZA des Prés, 38250 Villard-de-Lans", "390 671 228 00034"),
    numero: "TVL-104477",
    date: "2026-07-21",
    tauxTVA: 20,
    lignes: [
      { designation: "Transport palettes Bourgoin - Lyon", quantite: 4, prixUnitaire: 185.0 },
      { designation: "Hayon élévateur", quantite: 1, prixUnitaire: 45.0 },
    ],
    erreur: { totalTTC: 30 },
  },
  {
    id: "s05_faux_amis_numeros",
    piege: "Numéro de commande, numéro client et SIRET imprimés près du numéro de facture.",
    layout: "compact",
    fournisseur: fournisseur("ÉLECTRO-SERVICES ISÈRE", "8 rue Ampère, 38300 Bourgoin-Jallieu", "447 905 612 00041"),
    numero: "FA-26-1189",
    date: "2026-06-30",
    tauxTVA: 20,
    lignes: [
      { designation: "Contacteur tripolaire 25 A", quantite: 6, prixUnitaire: 48.9 },
      { designation: "Relais thermique 9-13 A", quantite: 6, prixUnitaire: 36.4 },
      { designation: "Intervention technicien (heure)", quantite: 3, prixUnitaire: 68.0 },
    ],
    fauxAmis: { numeroCommande: "BC-2026-0457", numeroClient: "CLI-08812" },
  },
  {
    id: "s06_faux_amis_dates",
    piege: "Date de livraison et date d'échéance imprimées à côté de la date d'émission.",
    layout: "colonnes",
    fournisseur: fournisseur("LUBRIFIANTS SAVOIE INDUSTRIE", "112 route de Chambéry, 73000 Barberaz", "534 880 191 00028"),
    numero: "LSI-2026-0661",
    date: "2026-06-05",
    tauxTVA: 20,
    lignes: [
      { designation: "Huile hydraulique HV 46 (fût 208 L)", quantite: 2, prixUnitaire: 512.0 },
      { designation: "Graisse multi-usages (seau 18 kg)", quantite: 3, prixUnitaire: 96.0 },
    ],
    fauxAmis: { dateLivraison: "2026-06-02", dateEcheance: "2026-07-31" },
  },
  {
    id: "s07_client_en_tete",
    piege: "Le nom du client domine l'en-tête ; le fournisseur n'apparaît qu'en petit.",
    layout: "classique",
    fournisseur: fournisseur("ATELIER SOUDURE DU BUGEY", "5 chemin des Carrières, 01500 Ambérieu-en-Bugey", "751 336 904 00019"),
    numero: "ASB-0392",
    date: "2026-05-18",
    tauxTVA: 20,
    lignes: [
      { designation: "Soudure TIG châssis inox", quantite: 2, prixUnitaire: 340.0 },
      { designation: "Contrôle ressuage", quantite: 2, prixUnitaire: 75.0 },
    ],
    clientEnTete: true,
  },
  {
    id: "s08_numero_absent",
    piege: "Aucun numéro de facture n'est imprimé : le pipeline doit s'abstenir, pas inventer.",
    layout: "compact",
    fournisseur: fournisseur("IMPRIMERIE DU NORD-ISÈRE", "27 rue de la République, 38300 Bourgoin-Jallieu", "319 448 750 00063"),
    numero: null,
    date: "2026-04-09",
    tauxTVA: 20,
    lignes: [
      { designation: "Étiquettes produit 50 x 30 mm (rouleau de 1 000)", quantite: 10, prixUnitaire: 21.0 },
      { designation: "Notices techniques A4 recto-verso", quantite: 500, prixUnitaire: 0.18 },
    ],
  },
  {
    id: "s09_deux_taux",
    piege: "Deux taux de TVA (10 % et 20 %) : un seul taux ne peut pas être renvoyé (limite connue).",
    layout: "classique",
    fournisseur: fournisseur("RESTAURATION COLLECTIVE DAUPHINÉ", "9 allée des Tilleuls, 38090 Villefontaine", "488 213 059 00037"),
    numero: "RCD-2026-1207",
    date: "2026-10-31",
    tauxTVA: 10,
    lignes: [
      { designation: "Repas salariés (octobre)", quantite: 412, prixUnitaire: 9.6, tauxTVA: 10 },
      { designation: "Boissons fournies", quantite: 120, prixUnitaire: 2.5, tauxTVA: 20 },
    ],
  },
  {
    id: "s10_remise",
    piege: "Ligne de remise à montant négatif.",
    layout: "colonnes",
    fournisseur: fournisseur("MAINTENANCE HYDRAULIQUE ISÈRE", "61 rue Lavoisier, 38200 Vienne", "823 650 114 00020"),
    numero: "MHI-26-0590",
    date: "2026-09-03",
    tauxTVA: 20,
    lignes: [
      { designation: "Révision groupe hydraulique 15 kW", quantite: 1, prixUnitaire: 890.0 },
      { designation: "Remplacement flexibles", quantite: 6, prixUnitaire: 54.0 },
      { designation: "Remise fidélité", quantite: 1, prixUnitaire: -61.4 },
    ],
  },
  {
    id: "s11_decimales_point",
    piege: "Quantités décimales (heures) et séparateur de milliers « . » (1.234,56 €).",
    layout: "classique",
    fournisseur: fournisseur("LOCATION ENGINS CHAMBÉRY", "ZI de Bissy, 73000 Chambéry", "402 987 655 00052"),
    numero: "LEC-2026-2231",
    date: "2026-08-11",
    tauxTVA: 20,
    lignes: [
      { designation: "Location chariot élévateur 3 t (jours)", quantite: 12, prixUnitaire: 145.0 },
      { designation: "Main d'oeuvre cariste (heures)", quantite: 7.5, prixUnitaire: 42.0 },
      { designation: "Livraison et reprise", quantite: 1, prixUnitaire: 260.0 },
    ],
    separateurMilliers: "point",
  },
  {
    id: "s12_multipage",
    piege: "Facture sur deux pages : lignes réparties, totaux sur la seconde page.",
    layout: "classique",
    fournisseur: fournisseur("QUINCAILLERIE PROFESSIONNELLE CENTRE-EST", "140 boulevard de l'Industrie, 69800 Saint-Priest", "355 120 487 00011"),
    numero: "QPCE-2026-7712",
    date: "2026-11-04",
    tauxTVA: 20,
    lignes: Array.from({ length: 40 }, (_, i) => ({
      designation: `Visserie inox A4 réf. VX-${String(100 + i * 7)} (lot de 100)`,
      quantite: (i % 5) + 1,
      prixUnitaire: Math.round((4.2 + i * 1.35) * 100) / 100,
    })),
  },
];
