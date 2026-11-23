# Extraction de factures fournisseurs — GARNIER Industrie

Pipeline TypeScript qui lit des factures PDF hétérogènes et une interface web qui présente le résultat à un comptable, avec l'incertitude visible.

> **Principe : le LLM structure, le code vérifie.** Chaque valeur extraite doit être retrouvée dans le texte lu sur la facture. Une valeur non prouvée est rendue `null` avec un avertissement, jamais inventée. C'est la demande du client : *« un champ vide plutôt qu'une valeur fausse »*.

## Setup (< 5 minutes)

Prérequis : Node.js 22.12 ou plus (24 LTS recommandé, voir `.nvmrc` ; exigé par Vite 8 et Vitest 5), une clé API Mistral (compte gratuit sur [console.mistral.ai](https://console.mistral.ai), tier « Experiment », rubrique *API Keys*).

```bash
npm install
cp .env.example .env      # puis renseigner MISTRAL_API_KEY dans .env
npm start                 # traite factures/ puis ouvre l'interface sur http://localhost:5173
```

`npm start` enchaîne les deux étapes ; on peut aussi les lancer séparément :

| Commande | Rôle |
|---|---|
| `npm run pipeline` | Traite tous les PDF de `factures/` et écrit `output/results.json` |
| `npm run pipeline -- --no-cache` | Idem en relisant les PDF (ignore le cache OCR) |
| `npm run dev` | Lance l'interface seule |
| `npm test` | Tests automatisés (sans réseau) |
| `npm run typecheck` | Vérification des types de tous les paquets |
| `npm run eval` | Rapport d'évaluation (voir plus bas) |
| `npm run eval:synthetiques` | Chaîne complète sur 18 factures synthétiques à pièges, dont 6 scans dégradés (`-- --rescorer` : renoter sans rappeler les API ; `-- --seulement d05` : une seule facture) |

Pour traiter une autre facture : la déposer dans `factures/` et relancer `npm run pipeline`, puis rafraîchir la page.

### Avec Docker (sans installer Node)

```bash
cp .env.example .env      # renseigner les clés ; toutes les variables doivent être dans .env
docker compose up --build # traite factures/ puis sert l'interface sur http://localhost:5173
```

Un seul conteneur : au démarrage il lance le pipeline, puis le serveur de l'interface. Attendre la ligne `VITE … ready` dans les logs (1 à 2 minutes) avant d'ouvrir la page : pendant le traitement, le port est déjà ouvert mais rien n'y répond (`ERR_EMPTY_RESPONSE`). La clé API n'est jamais copiée dans l'image : elle arrive au lancement par `env_file`. `factures/`, `output/` et `.cache/` sont montés depuis l'hôte : pour traiter une nouvelle facture, la déposer dans `factures/` et relancer `docker compose up`.

### Configuration (`.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `MISTRAL_API_KEY` | — | Clé API (jamais commitée : `.env` est ignoré par git) |
| `MISTRAL_LLM_MODEL` | `mistral-medium-latest` | Modèle de structuration |
| `CONCURRENCY` | `2` | Factures traitées en parallèle (le tier gratuit a une limite de débit basse) |
| `OCR_CONFIDENCE_THRESHOLD` | `0.8` | En dessous, une valeur prouvée passe « à vérifier » |
| `INVOICES_DIR`, `OUTPUT_PATH` | `factures`, `output/results.json` | Entrée et sortie |
| `OCR_PROVIDER`, `LLM_PROVIDER` | `mistral`, `mistral` | Fournisseurs choisis séparément ; `gemini` et `cloudflare` (OCR comme LLM) servent au développement, voir limites |

## Architecture

```
PDF ─► 1. Mistral OCR ............ texte markdown + confiance par mot (lit le rendu visuel)
    ─► 2. LLM Mistral ............ { value, quote } par champ, sortie JSON contrainte par le schéma
    ─► 3. Validation Zod ......... forme et types ; une relance avec les erreurs Zod si invalide
    ─► 4. Ancrage (code) ......... la citation existe-t-elle dans l'OCR ? la valeur s'y lit-elle ?
    ─► 5. Contrôles métier (code)  qté × PU = total ligne, Σ lignes = HT, HT × taux = TVA, HT + TVA = TTC
    ─► JSON ─► interface
```

Chaque champ reçoit un statut :

| Statut | Condition | Affichage |
|---|---|---|
| `ok` | Valeur retrouvée dans sa citation, OCR sûr | Valeur normale |
| `a_verifier` | Valeur retrouvée, mais un mot cité a une confiance OCR < 0,80 | Fond ambre, ⚠ |
| `absent` | LLM `null`, citation introuvable, ou valeur absente de la citation | Badge rouge « Non lu » |

Les écarts arithmétiques sont **signalés, jamais corrigés**.

```
packages/
  schema/     Schémas Zod partagés : le front consomme exactement le type produit par le pipeline
  pipeline/   ocr · llm · grounding (ancrage) · checks (contrôles) · parsing (montants, dates)
              · retry · cache · pipeline (orchestration) · run (CLI) · providers/
  web/        Vite + React : une page, liste triée par urgence, détail, PDF original à côté
eval/         Vérité terrain des 4 factures, notation, test du filet de sécurité
factures/     Les 4 factures du sujet
```

## Principaux choix techniques

- **Le LLM ne lit que l'OCR du rendu visuel, jamais la couche texte du PDF.** La facture HydroFluid contient une couche texte cachée en mojibake (UTF-8 lu comme Latin-1) : la lire aurait produit des valeurs corrompues, et un texte caché peut aussi servir à injecter des instructions.
- **Citations validées plutôt que confiance déclarée par le LLM.** Le LLM renvoie, pour chaque champ, le passage exact d'où il tire la valeur ; le code vérifie que ce passage existe et contient la valeur (pattern des « validated citations », cf. Instructor, LangExtract). Exemple : sur Studio Botanica, un LLM qui « corrige » le total HT en 925 € avec la citation `TOTAL HT 1 040€` est rejeté. Le LLM n'a pas le droit d'écrire le statut d'un champ : deux schémas distincts (`LlmInvoice` brut, `Invoice` certifié).
- **Confiance OCR par mot** (`confidenceScoresGranularity: "word"`) : la confiance d'une valeur est celle du mot le moins sûr de sa citation, retrouvée par position dans le markdown.
- **Montants en centimes entiers** pour éviter les erreurs de flottant ; taux de TVA lu sur la facture (19,6 % en 2009), jamais codé en dur.
- **Erreurs** : relances avec attente exponentielle sur 429 / 5xx / réseau (en-tête `Retry-After` respecté), une seule relance avec les erreurs Zod sur réponse invalide. On ne relance **jamais** pour un champ `null` : ce serait pousser le LLM à inventer. Une facture en échec devient un résultat `failed` typé et n'interrompt pas le lot.
- **Prompt à règles, sans exemples** pour ne pas surapprendre les 4 factures ; document placé entre balises `<document>` et déclaré comme donnée, pas comme instruction.
- **Cache OCR** sur disque, indexé par le sha256 du PDF (un fichier renommé n'est pas relu). Jamais de cache LLM, pour que chaque changement de prompt soit réellement testé.
- **Interface sobre** : les factures à traiter en premier, avertissements en tête, citation exacte au survol de chaque valeur, PDF original côte à côte (lecteur natif du navigateur). Le résultat est chargé par `fetch` et revalidé avec le schéma Zod partagé : vrais états de chargement et d'erreur.

## Évaluation

`npm run eval` produit `eval/report.md` en deux parties.

1. **Filet de sécurité (hors ligne, sans API).** On reconstitue une extraction correcte de chaque facture, on y glisse une erreur réaliste, et on mesure si l'ancrage et les contrôles la repèrent : **26/26 erreurs repérées, aucune fausse alerte**. Deux erreurs passent le filet et sont documentées comme limites (ci-dessous).
2. **Dernier passage du pipeline contre la vérité terrain** (`eval/cas/*.yaml`, relevée à la main). Métrique principale : la **fiabilité des valeurs affichées comme sûres** (une valeur fausse marquée « à vérifier », ou prise dans un écart bloquant qui la cite, est rattrapée par le comptable ; une valeur fausse affichée comme sûre ne l'est pas). Aussi : couverture, faux amis renvoyés (client, échéance, total recalculé…), écarts attendus détectés, fausses alertes, et pour chaque erreur sa cause probable (OCR ou LLM).

**Résultats mesurés** sur les 4 factures du sujet :

| Configuration | Champs justes | Valeurs fausses affichées comme sûres | Écarts réels détectés | Fausses alertes |
|---|---|---|---|---|
| **API Mistral** : `mistral-ocr-latest` + `mistral-medium-latest` (23/11/2026, configuration livrée) | 99 / 100 | **1** | 2 / 2 | 0 |
| OCR Gemini `gemini-3.8-flash` + Mistral Small 3.1 via Cloudflare (20/11/2026) | **100 / 100** | 0 | 2 / 2 | 0 |

Aucune facture en échec, aucun faux ami. Sur HydroFluid, aucun des deux OCR n'a renvoyé de mojibake : la couche texte cachée a bien été ignorée. **Les résultats obtenus avec Gemini sont meilleurs** : avec l'API Mistral, l'OCR lit « Électrovanne 4/3 *contre formé* » au lieu de « *centre fermé* » sur HydroFluid, avec une confiance de 93 à 99 % ; le LLM recopie fidèlement, l'ancrage valide, et aucun calcul ne porte sur une désignation. La valeur fausse est donc affichée comme sûre (voir limites). En revanche, seul Mistral OCR donne une confiance par mot : la date du scan de 2009, juste mais lue avec 54 % de confiance, passe « à vérifier ».

3. **Factures synthétiques à pièges** (`npm run eval:synthetiques`). Quatre factures ne suffisent pas à tester l'OCR et le LLM sur des documents inconnus, et il n'existe pas de jeu public de factures françaises annotées. `eval/src/synthetiques/` génère donc 12 PDF (3 mises en page) dont chacun isole un piège, avec une vérité terrain produite à partir des mêmes données : TVA à 5,5 %, total HT ou TTC faux sur le document, numéro de commande et code client près du numéro de facture, dates de livraison et d'échéance près de la date d'émission, client en en-tête, numéro absent, deux taux de TVA, remise négative, quantités décimales et séparateur « 1.234,56 », facture de 40 lignes sur deux pages. Ces factures passent dans la chaîne complète mais n'alimentent pas l'interface ; `npm run eval:generer` les régénère.

   **Résultats mesurés** :

   | OCR + LLM | Pièges déjoués | Champs justes | Valeurs fausses affichées comme sûres | Écarts détectés |
   |---|---|---|---|---|
   | Gemini + Gemini `gemini-3.8-flash` (22/11/2026) | **12 / 12** | **357 / 357** | 0 | 2 / 2 |
   | API Mistral : OCR + `mistral-medium-latest` (23/11/2026) | 11 / 12 | 356 / 357 | 0 | 2 / 2 |
   | OCR Gemini + Mistral Small 3.1 via Cloudflare (22/11/2026) | 11 / 12 | 190 / 357 | 0 | 2 / 2 |

   Avec l'API Mistral, seule la date de la facture de deux pages manque : l'OCR ne l'a pas transcrite, le pipeline la laisse donc vide (« Non lu ») plutôt que de l'inventer. Avec Cloudflare, seule la facture de 40 lignes échoue, proprement (« le service d'IA a mis trop de temps ») : sa réponse, une citation par champ, dépasse le délai du fournisseur. Dans les deux cas, aucune valeur fausse n'est affichée comme sûre. Le premier passage a aussi révélé deux problèmes, corrigés : le LLM cite parfois des cellules d'une même ligne en sautant une colonne (« Manuel… | 64,00 »), ce que l'ancrage accepte désormais à condition que toutes les cellules soient, dans l'ordre, sur la même ligne du document ; et une erreur dans la vérité terrain elle-même (un total de TVA attendu alors qu'il n'est pas imprimé), que le pipeline avait eu raison de ne pas inventer.

   **Variantes scannées.** Ces 12 PDF sont propres : l'OCR n'a presque rien à faire. Six d'entre eux sont donc aussi déclinés en « scans » (`degrade.ts` : rendu en image puis rotation, flou, bruit, compression JPEG, basse résolution), **sans couche texte** : mauvais scan à 110 dpi, fax noir et blanc à 100 dpi, photo de téléphone inclinée de 4° avec ombre, tampon rouge « PAYÉ LE 25/07/2026 » posé sur les totaux (une date de plus à ne pas confondre), scan de la facture de deux pages. Même vérité terrain que la facture d'origine. Résultats :

   | OCR + LLM | Scans déjoués | Champs justes | Valeurs fausses affichées comme sûres | Valeurs fausses prises dans un écart bloquant |
   |---|---|---|---|---|
   | Gemini + Gemini (22/11/2026) | **6 / 6** | **262 / 262** | 0 | 0 |
   | API Mistral (23/11/2026) | 4 / 6 | 259 / 262 | 0 | 3 |

   Là encore, **Gemini fait mieux**. Avec l'API Mistral, l'OCR lit mal le mauvais scan et le fax : une quantité 1 au lieu de 3 (deux fois), un total HT de 525,50 € au lieu de 526,50 €. Aucune de ces valeurs n'est silencieuse : chacune casse l'arithmétique, et la facture affiche un écart bloquant qui la cite (« Ligne 3 : 1 × 68,00 € = 68,00 €, mais la facture indique 204,00 € »). C'est le rôle des contrôles métier : rattraper une erreur de lecture que l'ancrage ne peut pas voir. Dans les deux cas, la date du tampon n'est jamais prise pour la date de la facture.

## Limites connues

- **Seuils empiriques** (confiance 0,80, tolérance ±1 centime), calibrés sur 4 factures seulement.
- **L'ancrage prouve qu'une valeur n'est pas inventée, pas qu'elle est dans le bon champ** : si le LLM met le nom du client dans « fournisseur », la valeur figure bien sur la facture et passe. De même, une quantité et un prix unitaire échangés avec leurs citations laissent le produit inchangé et échappent aux contrôles.
- **Une mauvaise lecture OCR reproduite par le LLM** passe l'ancrage ; elle n'est repérée que si elle casse l'arithmétique, ou si l'OCR en était peu sûr. Sur un texte libre (désignation, nom du fournisseur), aucun calcul ne la rattrape : c'est la seule valeur fausse affichée comme sûre de toute l'évaluation (« contre formé » pour « centre fermé », lu par Mistral OCR avec plus de 90 % de confiance).
- **Factures longues** : une citation par champ rend la réponse du LLM volumineuse (environ 160 citations pour 40 lignes). Le LLM Cloudflare (Mistral Small 3.1) dépasse alors son délai de réponse (erreur 408, facture marquée « non traitée ») ; Gemini et l'API Mistral (`mistral-medium-latest`) traitent la même facture sans erreur. La limite dépend donc du fournisseur.
- **Portée des tests** : 22 documents, dont 18 conçus par nous ; les pièges testés sont ceux que nous avons imaginés, ce qui laisse les angles morts de la conception hors du test. Les dégradations sont simulées (bruit uniforme, rotation simple), pas les défauts d'un vrai terrain (pliures, perspective, écriture manuscrite sur un montant, ticket thermique). Absents : avoirs, acomptes, factures en TTC, plusieurs taux de TVA par ligne, plusieurs factures dans un PDF. Un seul passage par configuration (stabilité d'un passage à l'autre non mesurée). La vraie mesure viendra des corrections du comptable en production.
- **TVA à plusieurs taux** non représentée : un seul `tauxTVA`, mis à `null` si plusieurs taux figurent.
- **Désignations** comparées avec une tolérance (80 % des mots) ; dates à année sur 2 chiffres interprétées en 20XX ; euros uniquement.
- **Fournisseurs de développement** (le sujet impose l'API Mistral ; l'OCR et le LLM se choisissent séparément) :
  - `OCR_PROVIDER=gemini` lit le PDF par vision (images des pages seules, `contentLayers: ["PAGE_IMAGE"]`), mais ne donne pas de confiance par mot : aucun champ ne passe « à vérifier ». Les données du tier gratuit peuvent servir à entraîner les modèles de Google.
  - `OCR_PROVIDER=cloudflare` (`toMarkdown`) lit la couche texte du PDF au lieu du rendu : mojibake sur HydroFluid, aucun texte sur le scan.
  - `LLM_PROVIDER=gemini` utilise Gemini avec une sortie JSON contrainte par le schéma (`responseJsonSchema`).
  - `LLM_PROVIDER=cloudflare` utilise Mistral Small 3.1 hébergé par Cloudflare ; il échoue sur les factures longues (voir ci-dessus).
- Pas de surlignage de la valeur dans le PDF (les coordonnées des blocs OCR le permettraient).

## Passer de 4 à 4 000 factures par mois

4 000 factures par mois, c'est environ 180 par jour ouvré, soit une toutes les 2 à 3 minutes : le pipeline actuel (4 factures en moins d'une minute) suffit en débit. Le vrai coût est le temps de relecture du comptable ; la priorité est donc la fiabilité et le suivi, pas l'infrastructure.

- **Robustesse du traitement** : une file de traitement (BullMQ ou SQS) plutôt qu'un lot en mémoire, pour reprendre après une panne sans retraiter ce qui est fait (l'empreinte sha256 du PDF l'assure déjà), avec un débit calé sur les quotas Mistral ; l'API batch de Mistral, moins chère, pour ce qui n'est pas urgent.
- **Stockage et traçabilité** : PDF en stockage objet, résultats en base (Postgres) avec la version du prompt et du modèle qui les a produits.
- **Ne pas dégrader le pipeline en le modifiant** : l'interface devient un écran de validation où le comptable corrige les champs, et chaque correction enrichit la vérité terrain de l'eval. L'eval est relancée automatiquement (intégration continue, par ex. GitHub Actions) à chaque changement de prompt ou de modèle : si une valeur fausse apparaît comme sûre, le changement est bloqué avant d'arriver en production.
- **Identifier le fournisseur avec certitude** : au lieu de se fier au nom lu sur la facture, rechercher le SIRET imprimé dans le fichier fournisseurs de GARNIER. Cela règle les noms ambigus (marque ou raison sociale) et la confusion avec le client. Comparer aussi l'IBAN à celui connu : un IBAN différent signale une possible fraude au changement de RIB.
- **Moins d'IA quand c'est possible** : avec la réforme de la facturation électronique, une part croissante des factures arrivera au format Factur-X ou UBL, dont le XML embarqué se lit directement, sans OCR ni LLM.
- **Suivi** : taux de champs laissés vides, « à vérifier » et d'écarts par fournisseur, pour repérer une dérive (nouveau gabarit, baisse de qualité de l'OCR).
