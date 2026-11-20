import type { FailureKind } from "@juwa/schema";
import { HTTPClientError, MistralError } from "@mistralai/mistralai/models/errors";

/** Échec d'une facture, avec un message compréhensible par le comptable. */
export class PipelineError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PipelineError";
  }
}

/** Erreur HTTP d'un fournisseur appelé en fetch direct (Cloudflare). */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly headers: Headers,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Code HTTP et en-têtes d'une erreur de fournisseur, quel qu'il soit. */
function httpInfo(error: unknown): { status: number; headers: Headers } | null {
  if (error instanceof MistralError || error instanceof HttpError) {
    return { status: error.statusCode, headers: error.headers };
  }
  return null;
}

/** Erreur passagère qui mérite une nouvelle tentative : débit, serveur, réseau. */
export function isTransient(error: unknown): boolean {
  const http = httpInfo(error);
  if (http) return http.status === 429 || http.status >= 500;
  if (error instanceof HTTPClientError) return true; // connexion, timeout (SDK Mistral)
  return error instanceof TypeError && /fetch/i.test(error.message);
}

/** Délai demandé par l'API (en-tête Retry-After, en secondes), en millisecondes. */
export function retryAfterMs(error: unknown): number | null {
  const header = httpInfo(error)?.headers.get("retry-after");
  const seconds = header == null ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** Traduit n'importe quelle erreur d'appel au fournisseur d'IA en échec de facture. */
export function toPipelineError(error: unknown, step: "OCR" | "LLM"): PipelineError {
  if (error instanceof PipelineError) return error;
  const http = httpInfo(error);
  if (http?.status === 429) {
    return new PipelineError("LIMITE_DEBIT", "Le service d'IA est saturé (limite de débit atteinte). Relancer le traitement plus tard.", { cause: error });
  }
  if (http?.status === 401 || http?.status === 403) {
    return new PipelineError("RESEAU", "La clé d'accès au service d'IA est refusée. Vérifier la configuration .env.", { cause: error });
  }
  if (isTransient(error)) {
    return new PipelineError("RESEAU", "Le service d'IA n'a pas répondu, même après plusieurs tentatives.", { cause: error });
  }
  if (step === "OCR") {
    return new PipelineError("OCR", "Le fichier n'a pas pu être lu (PDF invalide, protégé ou sans texte lisible).", { cause: error });
  }
  return new PipelineError("LLM_INVALIDE", "Erreur inattendue pendant la structuration par le LLM.", { cause: error });
}
