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

Pour traiter une autre facture : la déposer dans `factures/` et relancer `npm run pipeline`, puis rafraîchir la page.

### Configuration (`.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `MISTRAL_API_KEY` | — | Clé API (jamais commitée : `.env` est ignoré par git) |
| `MISTRAL_LLM_MODEL` | `mistral-medium-latest` | Modèle de structuration |
| `CONCURRENCY` | `2` | Factures traitées en parallèle (le tier gratuit a une limite de débit basse) |
| `OCR_CONFIDENCE_THRESHOLD` | `0.8` | En dessous, une valeur prouvée passe « à vérifier » |
| `INVOICES_DIR`, `OUTPUT_PATH` | `factures`, `output/results.json` | Entrée et sortie |
| `OCR_PROVIDER`, `LLM_PROVIDER` | `mistral`, `mistral` | Fournisseurs choisis séparément ; `gemini` (OCR) et `cloudflare` (OCR, LLM) servent au développement, voir limites |

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
2. **Dernier passage du pipeline contre la vérité terrain** (`eval/cas/*.yaml`, relevée à la main). Métrique principale : la **fiabilité des valeurs affichées comme sûres** (une valeur fausse marquée « à vérifier » est rattrapée par le comptable, une valeur fausse affichée comme sûre ne l'est pas). Aussi : couverture, faux amis renvoyés (client, échéance, total recalculé…), écarts attendus détectés, fausses alertes, et pour chaque erreur sa cause probable (OCR ou LLM).

**Résultat mesuré** (20/11/2026, configuration de développement : OCR Gemini `gemini-3.8-flash` + LLM Mistral Small 3.1 via Cloudflare ; à refaire avec l'API Mistral) : **100/100 champs justes**, aucune valeur fausse, aucun faux ami, **2/2 écarts réels détectés** sur Studio Botanica, aucune fausse alerte, 0 facture en échec, en 2 min 16 s pour les 4 factures (concurrence 2). Sur HydroFluid, l'OCR n'a renvoyé aucun mojibake : la couche texte cachée a bien été ignorée.

## Limites connues

- **Seuils empiriques** (confiance 0,80, tolérance ±1 centime), calibrés sur 4 factures seulement.
- **L'ancrage prouve qu'une valeur n'est pas inventée, pas qu'elle est dans le bon champ** : si le LLM met le nom du client dans « fournisseur », la valeur figure bien sur la facture et passe. De même, une quantité et un prix unitaire échangés avec leurs citations laissent le produit inchangé et échappent aux contrôles.
- **Une mauvaise lecture OCR reproduite par le LLM** passe l'ancrage ; elle n'est repérée que si elle casse l'arithmétique.
- **TVA à plusieurs taux** non représentée : un seul `tauxTVA`, mis à `null` si plusieurs taux figurent.
- **Désignations** comparées avec une tolérance (80 % des mots) ; dates à année sur 2 chiffres interprétées en 20XX ; euros uniquement.
- **Fournisseurs de développement** (le sujet impose l'API Mistral ; l'OCR et le LLM se choisissent séparément) :
  - `OCR_PROVIDER=gemini` lit le PDF par vision (images des pages seules, `contentLayers: ["PAGE_IMAGE"]`), mais ne donne pas de confiance par mot : aucun champ ne passe « à vérifier ». Les données du tier gratuit peuvent servir à entraîner les modèles de Google.
  - `OCR_PROVIDER=cloudflare` (`toMarkdown`) lit la couche texte du PDF au lieu du rendu : mojibake sur HydroFluid, aucun texte sur le scan.
  - `LLM_PROVIDER=cloudflare` utilise Mistral Small 3.1 hébergé par Cloudflare.
- Pas de surlignage de la valeur dans le PDF (les coordonnées des blocs OCR le permettraient).

## Passer de 4 à 4 000 factures par mois

4 000 factures par mois, c'est environ 180 par jour ouvré, soit une toutes les 2 à 3 minutes : le pipeline actuel (4 factures en moins d'une minute) suffit en débit. Le vrai coût est le temps de relecture du comptable ; la priorité est donc la fiabilité et le suivi, pas l'infrastructure.

- **Robustesse du traitement** : une file de traitement (BullMQ ou SQS) plutôt qu'un lot en mémoire, pour reprendre après une panne sans retraiter ce qui est fait (l'empreinte sha256 du PDF l'assure déjà), avec un débit calé sur les quotas Mistral ; l'API batch de Mistral, moins chère, pour ce qui n'est pas urgent.
- **Stockage et traçabilité** : PDF en stockage objet, résultats en base (Postgres) avec la version du prompt et du modèle qui les a produits.
- **Ne pas dégrader le pipeline en le modifiant** : l'interface devient un écran de validation où le comptable corrige les champs, et chaque correction enrichit la vérité terrain de l'eval. L'eval est relancée automatiquement (intégration continue, par ex. GitHub Actions) à chaque changement de prompt ou de modèle : si une valeur fausse apparaît comme sûre, le changement est bloqué avant d'arriver en production.
- **Identifier le fournisseur avec certitude** : au lieu de se fier au nom lu sur la facture, rechercher le SIRET imprimé dans le fichier fournisseurs de GARNIER. Cela règle les noms ambigus (marque ou raison sociale) et la confusion avec le client. Comparer aussi l'IBAN à celui connu : un IBAN différent signale une possible fraude au changement de RIB.
- **Moins d'IA quand c'est possible** : avec la réforme de la facturation électronique, une part croissante des factures arrivera au format Factur-X ou UBL, dont le XML embarqué se lit directement, sans OCR ni LLM.
- **Suivi** : taux de champs laissés vides, « à vérifier » et d'écarts par fournisseur, pour repérer une dérive (nouveau gabarit, baisse de qualité de l'OCR).
