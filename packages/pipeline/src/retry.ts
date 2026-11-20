import { isTransient, retryAfterMs } from "./errors.ts";

export interface RetryOptions {
  /** Nombre total de tentatives (la première comprise). */
  attempts: number;
  /** Délai de base de l'attente exponentielle : 1 s, 2 s, 4 s… */
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export const DEFAULT_RETRY: RetryOptions = { attempts: 3, baseDelayMs: 1000 };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Rejoue `fn` sur les erreurs passagères (429, 5xx, réseau). Attente exponentielle avec aléa,
 * ou délai imposé par l'en-tête Retry-After. Les autres erreurs remontent immédiatement.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = DEFAULT_RETRY): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= options.attempts || !isTransient(error)) throw error;
      const backoff = options.baseDelayMs * 2 ** (attempt - 1);
      const delay = retryAfterMs(error) ?? backoff + Math.random() * options.baseDelayMs * 0.5;
      options.onRetry?.(attempt, delay, error);
      await sleep(delay);
    }
  }
}
