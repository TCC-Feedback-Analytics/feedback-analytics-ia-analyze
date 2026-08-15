import { buildIaPromptByScope } from '../lib/iaAnalyzePromptBuilders.js';
import { extractJsonFromText } from '../utils/extractJsonFromText.js';
import type {
  AnalyzeBatchWithIaParams,
  IaApiClient,
  ParsedIaResponse,
} from '../../types/iaApiClient.types.js';
import {
  IaApiClientError,
  RETRYABLE_STATUS,
  describeError,
  getErrorStatus,
  runWithRetry,
} from './shared/retry.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_OUTPUT_TOKENS = 16_384;
/** Modelo padrão quando `LLM_MODEL` não é informado — roteamento automático do OpenRouter. */
const DEFAULT_OPENROUTER_MODEL = 'openrouter/auto';

/** Erro HTTP do OpenRouter, carregando status e o Retry-After sugerido. */
class OpenRouterHttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs: number | null,
  ) {
    super(message);
  }
}

/**
 * Retentável = mesmos status transitórios do padrão HTTP. **402 (sem créditos) e
 * 401 (chave inválida) NÃO são retentáveis** — retentar não resolve e só atrasa o
 * erro claro para o usuário (equivalente à "cota diária" do Gemini).
 */
function isRetryableOpenRouter(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 401 || status === 402) return false;
  if (status !== null) return RETRYABLE_STATUS.has(status);
  return false;
}

function suggestedDelayFromRetryAfter(error: unknown): number | null {
  return error instanceof OpenRouterHttpError ? error.retryAfterMs : null;
}

/** Converte o header `Retry-After` (segundos) em ms; ignora o formato de data HTTP. */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1_000) : null;
}

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
};

/**
 * Adaptador do OpenRouter (API compatível com OpenAI: `/chat/completions`).
 * Implementa o MESMO contrato `IaApiClient` do Gemini, reusando o builder de
 * prompt e o parser de JSON — o motor de análise não sabe qual provedor está atrás.
 */
export function createOpenRouterClient(params: { apiKey: string; model?: string }): IaApiClient {
  const model = params.model?.trim() || DEFAULT_OPENROUTER_MODEL;

  return {
    async analyzeBatch(batchParams: AnalyzeBatchWithIaParams): Promise<ParsedIaResponse> {
      const prompt = buildIaPromptByScope({
        scopeType: batchParams.scopeType,
        enterpriseContext: batchParams.enterpriseContext,
        feedbacks: batchParams.feedbacks,
      });

      let content: string;
      let finishReason: string | undefined;

      try {
        const result = await runWithRetry<OpenRouterResponse>(
          async () => {
            const response = await fetch(OPENROUTER_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${params.apiKey}`,
              },
              body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: MAX_OUTPUT_TOKENS,
                // Reforça saída em JSON nos modelos que suportam; o parser tolera o resto.
                response_format: { type: 'json_object' },
              }),
            });

            if (!response.ok) {
              const bodyText = await response.text().catch(() => '');
              throw new OpenRouterHttpError(
                response.status,
                `OpenRouter ${response.status}: ${bodyText.slice(0, 200)}`,
                parseRetryAfterMs(response.headers.get('retry-after')),
              );
            }

            return (await response.json()) as OpenRouterResponse;
          },
          {
            label: 'OpenRouter',
            isRetryable: isRetryableOpenRouter,
            suggestedDelayMs: suggestedDelayFromRetryAfter,
          },
        );

        const choice = result.choices?.[0];
        content = choice?.message?.content ?? '';
        finishReason = choice?.finish_reason;
      } catch (error) {
        console.error(`[ia-analyze] OpenRouter falhou — motivo: ${describeError(error)}`);
        throw new IaApiClientError(
          `Failed to call model API (${describeError(error)})`,
          'failed_ia_request',
        );
      }

      // finish_reason 'length' = saída truncada (equivalente ao MAX_TOKENS do Gemini).
      if (finishReason === 'length') {
        throw new IaApiClientError('AI response truncated (length)', 'invalid_ai_response');
      }

      try {
        return JSON.parse(extractJsonFromText(content)) as ParsedIaResponse;
      } catch {
        throw new IaApiClientError('Invalid AI response JSON', 'invalid_ai_response');
      }
    },
  };
}
