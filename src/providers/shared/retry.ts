import type { IaApiClientErrorCode } from '../../../types/iaApiClient.types.js';

/**
 * Helpers de retry/erro COMPARTILHADOS pelos provedores de IA (Gemini, OpenRouter).
 * O que é específico de cada provedor — o que conta como transitório e o delay
 * sugerido — entra por parâmetro em `runWithRetry`. Assim os dois adaptadores
 * dividem o backoff/jitter e o tratamento de erro sem duplicar.
 */

export const MAX_ATTEMPTS = 4;
export const BASE_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 20_000;
// Status HTTP transitórios (rate limit de curto prazo / overload / 5xx).
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Erro padronizado do cliente de IA, com código tipado consumido pelo engine.
 * Vive aqui (camada compartilhada) e é re-exportado por gemini.provider por
 * compatibilidade com quem já importava de lá.
 */
export class IaApiClientError extends Error {
  public code: IaApiClientErrorCode;

  constructor(message: string, code: IaApiClientErrorCode) {
    super(message);
    this.code = code;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Status HTTP do erro (varia entre `.status` numérico e `.code`). */
export function getErrorStatus(error: unknown): number | null {
  if (error && typeof error === 'object') {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return null;
}

/** Resumo conciso (status + mensagem, até 300 chars) para logs de diagnóstico. */
export function describeError(error: unknown): string {
  const status = getErrorStatus(error);
  const rawMessage = String(
    (error as { message?: unknown })?.message ?? error ?? 'erro desconhecido',
  );
  const message = rawMessage.replace(/\s+/g, ' ').trim().slice(0, 300);
  return status !== null ? `status=${status} ${message}` : message;
}

/** Backoff exponencial com jitter, limitado a MAX_BACKOFF_MS. */
export function backoffDelayMs(attempt: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * 500);
  return exponential + jitter;
}

export type RetryOptions = {
  /** Rótulo do provedor para os logs (ex.: 'Gemini', 'OpenRouter'). */
  label: string;
  /** Decide se o erro é transitório (vale retentar). */
  isRetryable: (error: unknown) => boolean;
  /** Delay sugerido pelo provedor (ex.: header Retry-After); null = usar backoff. */
  suggestedDelayMs?: (error: unknown) => number | null;
};

/**
 * Executa `fn` com retry/backoff para falhas transitórias. O provedor decide, via
 * `opts`, o que é transitório e o delay sugerido. Relança o erro ORIGINAL quando
 * esgota as tentativas ou o erro não é retentável — quem chama mapeia para
 * `IaApiClientError` com o código certo.
 */
export async function runWithRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < MAX_ATTEMPTS && opts.isRetryable(error)) {
        const delay = Math.min(
          opts.suggestedDelayMs?.(error) ?? backoffDelayMs(attempt),
          MAX_BACKOFF_MS,
        );
        console.warn(
          `[ia-analyze] ${opts.label} tentativa ${attempt}/${MAX_ATTEMPTS} falhou (${describeError(error)}); novo retry em ${delay}ms`,
        );
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  // Inalcançável: o loop sempre retorna ou relança. Presente só para o type-checker.
  throw new Error('runWithRetry: estado inesperado');
}
