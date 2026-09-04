import { buildIaPromptByScope } from '../lib/iaAnalyzePromptBuilders.js';
import { buildInsightsSynthesisPrompt } from '../lib/insightsSynthesisPromptBuilder.js';
import { PT_BR_SYSTEM_INSTRUCTION } from '../lib/prompts/ptBrSystemInstruction.js';
import { extractJsonFromText } from '../utils/extractJsonFromText.js';
import { validateIaBatchResponse } from '../validations/iaBatchResponse.validation.js';
import { validateInsightsSynthesisResponse } from '../validations/insightsSynthesis.validation.js';
import type { AnalyzeBatchWithIaParams, IaApiClient, IaApiClientErrorCode, ParsedIaResponse, SynthesizeInsightsParams } from '../../types/iaApiClient.types.js';
import { IaApiClientError, RETRYABLE_STATUS, runWithRetry } from './shared/retry.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_OUTPUT_TOKENS = 16_384;
const DEFAULT_OPENROUTER_MODEL = 'openrouter/auto';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function providerCode(status: number): IaApiClientErrorCode {
  if (status === 401) return 'ia_provider_auth_error';
  if (status === 402) return 'ia_provider_credits_exhausted';
  if (status === 429) return 'ia_provider_rate_limited';
  if ([404, 502, 503, 504].includes(status)) return 'ia_provider_unavailable';
  return 'ia_provider_error';
}

/** Nunca inclui mensagem/raw/metadata do provedor: podem ecoar chave ou prompt. */
class OpenRouterHttpError extends IaApiClientError {
  constructor(public status: number, public retryAfterMs: number | null) {
    super(`OpenRouter provider error (status=${status})`, providerCode(status));
  }
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : null;
}

function errorStatus(error: unknown): number {
  const code = isObject(error) ? error.code : undefined;
  const status = typeof code === 'number' || (typeof code === 'string' && /^\d{3}$/.test(code)) ? Number(code) : NaN;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

/** Metadados permitidos nos logs; nunca inclui resposta, raciocínio ou credenciais. */
function safeLabel(value: unknown): string {
  return typeof value === 'string' && /^[a-zA-Z0-9._:/-]{1,120}$/.test(value) && !value.startsWith('sk-') ? value : 'unknown';
}

export function createOpenRouterClient(params: { apiKey: string; model?: string }): IaApiClient {
  const model = params.model?.trim() || DEFAULT_OPENROUTER_MODEL;
  async function requestJson(prompt: string, task: 'analysis' | 'synthesis', itemCount: number): Promise<unknown> {
    let httpStatus: number | undefined;
    let finishReason: string | undefined;
    let contentLength = 0;
    try {
      const result = await runWithRetry<Record<string, unknown>>(async () => {
        let response: Response;
        try {
          response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.apiKey}` },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: PT_BR_SYSTEM_INSTRUCTION },
                { role: 'user', content: prompt },
              ],
              temperature: 0.2,
              max_tokens: MAX_OUTPUT_TOKENS,
              response_format: { type: 'json_object' },
              provider: { require_parameters: true },
            }),
          });
        } catch {
          throw new IaApiClientError('Unable to contact OpenRouter', 'failed_ia_request');
        }
        httpStatus = response.status;
        const payload: unknown = await response.json().catch(() => null);
        const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
        if (!response.ok) throw new OpenRouterHttpError(response.status, retryAfter);
        if (isObject(payload) && payload.error != null) throw new OpenRouterHttpError(errorStatus(payload.error), retryAfter);
        if (!isObject(payload)) throw new IaApiClientError('Invalid OpenRouter response envelope', 'invalid_provider_response');
        return payload;
      }, {
        label: 'OpenRouter',
        isRetryable: error => error instanceof OpenRouterHttpError && RETRYABLE_STATUS.has(error.status),
        suggestedDelayMs: error => error instanceof OpenRouterHttpError ? error.retryAfterMs : null,
      });

      const choice: unknown = Array.isArray(result.choices) ? result.choices[0] : undefined;
      if (!isObject(choice)) throw new IaApiClientError('OpenRouter response has no completion choice', 'invalid_provider_response');
      const knownFinishReasons = ['stop', 'length', 'content_filter', 'error', 'tool_calls', 'function_call'];
      finishReason = typeof choice.finish_reason === 'string' && knownFinishReasons.includes(choice.finish_reason) ? choice.finish_reason : 'unknown';
      const message = choice.message;
      contentLength = isObject(message) && typeof message.content === 'string' ? message.content.length : 0;
      if (choice.error != null) throw new OpenRouterHttpError(errorStatus(choice.error), null);
      if (finishReason === 'error') throw new IaApiClientError('OpenRouter generation failed', 'ia_provider_error');
      if (finishReason === 'length') throw new IaApiClientError('AI response truncated (length)', 'truncated_ai_response');
      if (finishReason === 'content_filter' || (isObject(message) && message.refusal)) throw new IaApiClientError('AI refused to produce an analysis', 'ai_response_refused');
      if (!isObject(message)) throw new IaApiClientError('OpenRouter response has no message', 'invalid_provider_response');
      const content = message.content;
      if (content == null || (typeof content === 'string' && !content.trim())) throw new IaApiClientError('AI returned no content', 'empty_ai_response');
      if (typeof content !== 'string') throw new IaApiClientError('Unexpected AI content type', 'invalid_provider_response');
      try {
        try {
          return JSON.parse(content);
        } catch {
          return JSON.parse(extractJsonFromText(content));
        }
      } catch {
        throw new IaApiClientError('Invalid AI response JSON', 'invalid_ai_response');
      }
    } catch (error) {
      const failure = error instanceof IaApiClientError ? error : new IaApiClientError('Unable to process OpenRouter response', 'invalid_provider_response');
      console.error('[ia-analyze] OpenRouter failure', {
        code: failure.code, model: model.includes(params.apiKey) ? 'unknown' : safeLabel(model),
        task, itemCount, httpStatus,
        providerStatus: failure instanceof OpenRouterHttpError ? failure.status : undefined,
        finishReason, contentLength,
      });
      throw failure;
    }
  }

  return {
    async analyzeBatch(batchParams: AnalyzeBatchWithIaParams): Promise<ParsedIaResponse> {
      const parsed = await requestJson(buildIaPromptByScope({
        scopeType: batchParams.scopeType,
        enterpriseContext: batchParams.enterpriseContext,
        feedbacks: batchParams.feedbacks,
        languageRepair: batchParams.languageRepair,
      }), 'analysis', batchParams.feedbacks.length);
      validateIaBatchResponse(parsed, batchParams.feedbacks);
      return parsed;
    },
    async synthesizeInsights(synthesisParams: SynthesizeInsightsParams) {
      const parsed = await requestJson(
        buildInsightsSynthesisPrompt(synthesisParams),
        'synthesis',
        synthesisParams.partialInsights.length,
      );
      validateInsightsSynthesisResponse(parsed);
      return parsed;
    },
  };
}
