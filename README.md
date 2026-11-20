# Extraction de factures fournisseurs — GARNIER Industrie

Pipeline TypeScript qui lit des factures PDF hétérogènes (Mistral OCR → LLM → Zod → ancrage → contrôles métier) et interface web qui présente les résultats à un comptable, avec l'incertitude visible.

> Principe : **le LLM structure, le code vérifie.** Une valeur qui n'est pas prouvée par le document est rendue `null` avec un avertissement, jamais inventée.

## Setup (< 5 minutes)

_À compléter._

```bash
cp .env.example .env   # renseigner MISTRAL_API_KEY
npm install
npm start              # pipeline + interface
```

## Architecture

_À compléter._

## Choix techniques et limites

_À compléter._

## Passer de 4 à 4 000 factures par mois

_À compléter._

## Temps passé

_À compléter._
