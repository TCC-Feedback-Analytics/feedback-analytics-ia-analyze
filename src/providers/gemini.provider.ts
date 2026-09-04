import { GoogleGenAI } from '@google/genai';
import { buildIaPromptByScope } from '../lib/iaAnalyzePromptBuilders.js';
import { buildInsightsSynthesisPrompt } from '../lib/insightsSynthesisPromptBuilder.js';
import { PT_BR_SYSTEM_INSTRUCTION } from '../lib/prompts/ptBrSystemInstruction.js';
import { extractJsonFromText } from '../utils/extractJsonFromText.js';
import { validateInsightsSynthesisResponse } from '../validations/insightsSynthesis.validation.js';
import type {
  AiResponseShape,
  AnalyzeBatchWithIaParams,
  IaApiClient,
  ParsedIaResponse,
  SynthesizeInsightsParams,
} from '../../types/iaApiClient.types.js';
import {
  IaApiClientError,
  RETRYABLE_STATUS,
  describeError,
  getErrorStatus,
  runWithRetry,
} from './shared/retry.js';

// Re-export por compatibilidade: o service e os testes importam IaApiClientError daqui.
export { IaApiClientError } from './shared/retry.js';

/**
 * Teto de tokens de SAÍDA por chamada. Com os lotes já fatiados por tamanho no
 * gateway (IA_MAX_FEEDBACKS_PER_BATCH), a saída esperada é pequena; este teto é
 * folgado e serve de trava. Bem abaixo do máximo do modelo (65.536).
 */
const MAX_OUTPUT_TOKENS = 16_384;

/** Modelo padrão do Gemini quando `LLM_MODEL` não é informado (mantém o valor histórico). */
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Distingue cota DIÁRIA esgotada (requests-per-day) de rate limit de curto prazo
 * (requests-per-minute). Um 429 por cota diária só reseta no dia seguinte:
 * retentar não adianta e cada tentativa consome MAIS cota, acelerando o
 * esgotamento. Detecta a janela diária pela mensagem de quota do Gemini
 * (ex.: "GenerateRequestsPerDayPerProjectPerModel", "per day", "daily").
 */
export function isDailyQuotaExceeded(error: unknown): boolean {
  const status = getErrorStatus(error);
  const message = String((error as { message?: unknown })?.message ?? '').toLowerCase();

  const isQuotaError =
    status === 429 || message.includes('resource_exhausted') || message.includes('429');
  if (!isQuotaError) {
    return false;
  }

  return (
    message.includes('perday') ||
    message.includes('per day') ||
    message.includes('per-day') ||
    message.includes('daily') ||
    message.includes('requests per day')
  );
}

/**
 * Decide se vale a pena retentar: rate limit de curto prazo (RPM) / overload /
 * 5xx são transitórios. Cota DIÁRIA esgotada NÃO é retentável (ver acima):
 * falhar rápido evita queimar o resto da cota em tentativas inúteis.
 */
export function isRetryableError(error: unknown): boolean {
  if (isDailyQuotaExceeded(error)) {
    return false;
  }

  const status = getErrorStatus(error);
  if (status !== null) {
    return RETRYABLE_STATUS.has(status);
  }

  const message = String((error as { message?: unknown })?.message ?? '').toLowerCase();
  return (
    message.includes('resource_exhausted') ||
    message.includes('unavailable') ||
    message.includes('overloaded') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('503')
  );
}

/** Honra o retryDelay sugerido pelo Gemini (google.rpc.RetryInfo), se presente na mensagem. */
function parseSuggestedDelayMs(error: unknown): number | null {
  const message = String((error as { message?: unknown })?.message ?? '');
  const match =
    message.match(/retrydelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s/i) ??
    message.match(/retry\s+(?:after|in)\s+(\d+(?:\.\d+)?)\s*s/i);

  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1_000);
  }
  return null;
}

/**
 * Cria um cliente de IA (Gemini) com API key fixa e modelo configurável para a
 * execução atual. O `model` default preserva o comportamento histórico.
 */
export function createIaApiClient(
  apiKey: string,
  model: string = DEFAULT_GEMINI_MODEL,
): IaApiClient {
  const ai = new GoogleGenAI({ apiKey });

  async function generateJson(prompt: string): Promise<unknown> {
    let aiResponse: AiResponseShape;
    try {
      aiResponse = await runWithRetry(
        () =>
          ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction: PT_BR_SYSTEM_INSTRUCTION,
              thinkingConfig: { thinkingBudget: 0 },
              temperature: 0.2,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
            },
          }) as Promise<AiResponseShape>,
        { label: 'Gemini', isRetryable: isRetryableError, suggestedDelayMs: parseSuggestedDelayMs },
      );
    } catch (error) {
      if (isDailyQuotaExceeded(error)) {
        console.error(
          `[ia-analyze] Gemini: cota DIÁRIA esgotada — falha rápida sem retry (retentar só queima mais cota). ${describeError(error)}`,
        );
      } else {
        console.error(`[ia-analyze] Gemini falhou — motivo: ${describeError(error)}`);
      }
      throw new IaApiClientError(
        `Failed to call model API (${describeError(error)})`,
        'failed_ia_request',
      );
    }

    const finishReason = aiResponse.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      throw new IaApiClientError('AI response truncated (MAX_TOKENS)', 'invalid_ai_response');
    }

    const maybeText = aiResponse.text;
    const rawText = (typeof maybeText === 'function' ? maybeText() : maybeText) ?? '';
    try {
      return JSON.parse(extractJsonFromText(rawText));
    } catch {
      throw new IaApiClientError('Invalid AI response JSON', 'invalid_ai_response');
    }
  }

  return {
    /**
     * Envia um batch ao modelo e devolve a resposta parseada em JSON. Retry/backoff
     * em falhas transitórias (via runWithRetry) e teto de saída. Saída truncada
     * (finishReason MAX_TOKENS) é tratada como resposta inválida, não parseada.
     */
    async analyzeBatch(params: AnalyzeBatchWithIaParams): Promise<ParsedIaResponse> {
      const prompt = buildIaPromptByScope({
        scopeType: params.scopeType,
        enterpriseContext: params.enterpriseContext,
        feedbacks: params.feedbacks,
        languageRepair: params.languageRepair,
      });
      return await generateJson(prompt) as ParsedIaResponse;
    },
    async synthesizeInsights(params: SynthesizeInsightsParams) {
      const parsed = await generateJson(buildInsightsSynthesisPrompt(params));
      validateInsightsSynthesisResponse(parsed);
      return parsed;
    },
  };
}
