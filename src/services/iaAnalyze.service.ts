import { IaApiClientError } from '../providers/shared/retry.js';
import { validateIaBatchResponse } from '../validations/iaBatchResponse.validation.js';
import { assertInsightsInPtBr } from '../validations/ptBrLanguage.validation.js';
import { createProvider, type LlmProvider } from '../providers/createProvider.js';
import { canProcessAnalyzedItem } from './sentimentAnalysis.service.js';
import { extractKeywords } from './keywordExtraction.service.js';
import { extractCategories } from './categorization.service.js';
import {
  extractAspects,
  clampScore,
  normalizeConfidence,
  scoreFromSentiment,
} from './aspectExtraction.service.js';
import { buildBatchContext } from './globalInsights.service.js';
import type {
  IaAnalyzeRemoteFeedbackAnalysis,
  IaAnalyzeRemoteRunRequest,
  IaAnalyzeRemoteRunResponse,
} from '@feedback/lib-shared/interfaces/contracts/ia-analyze/remote.contract';
import type {
  IaAnalyzeFeedbackInput,
  IaAnalyzeRemoteBatchInput,
} from '@feedback/lib-shared/interfaces/contracts/ia-analyze/input.contract';
import type { IaAnalyzeContext } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/analysis.contract';
import type { AnalyzeBatchWithIaParams, IaApiClient, ParsedIaResponse, SynthesizeInsightsParams } from '../../types/iaApiClient.types.js';
import type { IaInsightsSynthesisRequest, IaInsightsSynthesisResponse } from '../../types/insightsSynthesis.types.js';

/**
 * Classe de erro customizada para o serviço de análise IA.
 *
 * Permite lançar erros com status HTTP e código específico,
 * facilitando o tratamento e depuração de falhas no serviço.
 */
export class IaAnalyzeServiceError extends Error {
  public statusCode: number;

  public code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const DEFAULT_LLM_CONCURRENCY = 3;

/**
 * Quantas chamadas ao LLM podem estar em voo ao mesmo tempo (configurável via
 * IA_LLM_CONCURRENCY; aceita IA_GEMINI_CONCURRENCY por compatibilidade). Limitar
 * a concorrência evita estourar o rate limit do provedor (→ 429).
 */
function readLlmConcurrency(): number {
  const raw = process.env.IA_LLM_CONCURRENCY ?? process.env.IA_GEMINI_CONCURRENCY ?? '';
  const parsed = Number(String(raw).trim());
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return DEFAULT_LLM_CONCURRENCY;
}

/** Credenciais/modelo do provedor, vindas por requisição (Camada 2 / BYO-key) ou do env. */
export type LlmCreds = { provider?: string; apiKey?: string; model?: string };

/**
 * Resolve provedor/chave/modelo. Prioriza o `override` (headers, na Camada 2) e
 * cai no env: `LLM_PROVIDER` (default `gemini`, para uma transição sem regressão),
 * `LLM_MODEL`, e a chave do provedor escolhido (`OPENROUTER_API_KEY`/`GEMINI_API_KEY`).
 */
function resolveProviderConfig(override?: LlmCreds): {
  provider: LlmProvider;
  apiKey: string;
  model?: string;
} {
  const providerRaw = (override?.provider ?? process.env.LLM_PROVIDER ?? 'gemini')
    .trim()
    .toLowerCase();
  const provider: LlmProvider = providerRaw === 'openrouter' ? 'openrouter' : 'gemini';
  const model = (override?.model ?? process.env.LLM_MODEL ?? '').trim() || undefined;
  const apiKey = (
    override?.apiKey ??
    (provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.GEMINI_API_KEY) ??
    ''
  ).trim();

  if (!apiKey) {
    throw new IaAnalyzeServiceError(
      `Missing API key for provider "${provider}"`,
      500,
      provider === 'openrouter' ? 'missing_openrouter_api_key' : 'missing_gemini_api_key',
    );
  }

  return { provider, apiKey, model };
}

/**
 * Executa `task` sobre cada item com no máximo `limit` chamadas em paralelo
 * (semáforo simples), preservando a ordem dos resultados. Substitui o
 * `Promise.all` sem limite, que disparava todas as chamadas ao Gemini de uma vez.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

/** Resultado de processar um lote: concluído, vazio (ignorado) ou falho. */
type BatchOutcome =
  | { status: 'done'; batch: IaAnalyzeRemoteBatchInput; parsed: ParsedIaResponse }
  | { status: 'empty' }
  | { status: 'skipped' }
  | { status: 'failed'; error: unknown };

async function analyzeBatchWithLanguageRepair(
  client: IaApiClient,
  params: AnalyzeBatchWithIaParams,
): Promise<ParsedIaResponse> {
  const execute = async (languageRepair: boolean) => {
    const parsed = await client.analyzeBatch({ ...params, languageRepair });
    validateIaBatchResponse(parsed, params.feedbacks);
    if (!parsed.global_insights) {
      throw new IaApiClientError('AI response has no insights', 'invalid_ai_response_schema');
    }
    assertInsightsInPtBr(parsed.global_insights);
    return parsed;
  };

  try {
    return await execute(false);
  } catch (error) {
    if (!(error instanceof IaApiClientError) || error.code !== 'invalid_ai_response_language') throw error;
    console.warn('[ia-analyze] idioma inválido no lote; executando uma correção pt-BR');
    return execute(true);
  }
}

async function synthesizeWithLanguageRepair(
  client: IaApiClient,
  params: SynthesizeInsightsParams,
) {
  const execute = async (languageRepair: boolean) => {
    const insights = await client.synthesizeInsights({ ...params, languageRepair });
    assertInsightsInPtBr(insights);
    return insights;
  };
  try {
    return await execute(false);
  } catch (error) {
    if (!(error instanceof IaApiClientError) || error.code !== 'invalid_ai_response_language') throw error;
    console.warn('[ia-analyze] idioma inválido na síntese; executando uma correção pt-BR');
    return execute(true);
  }
}

/** Reduce final do relatório, separado da classificação dos feedbacks. */
export async function runIaInsightsSynthesisService(
  request: IaInsightsSynthesisRequest,
  creds?: LlmCreds,
): Promise<IaInsightsSynthesisResponse> {
  const client = createProvider(resolveProviderConfig(creds));
  try {
    const globalInsights = await synthesizeWithLanguageRepair(client, {
      scopeType: request.scope_type,
      catalogItemId: request.catalog_item_id,
      catalogItemName: request.catalog_item_name,
      analyzedCount: request.analyzed_count,
      enterpriseContext: request.enterprise_context,
      partialInsights: request.partial_insights,
    });
    return { global_insights: globalInsights };
  } catch (error) {
    const code = error instanceof IaApiClientError ? error.code : 'failed_ia_request';
    throw new IaAnalyzeServiceError('AI insights synthesis did not complete successfully', 502, code);
  }
}

/**
 * Função principal que executa o fluxo de análise de feedbacks por IA.
 *
 * - Recebe uma requisição com lotes de feedbacks.
 * - Para cada lote, chama o modelo de IA com CONCORRÊNCIA LIMITADA (não dispara
 *   todas de uma vez), evitando rate limit.
 * - Extrai e organiza sentimentos, categorias e palavras-chave de cada feedback.
 * - Monta o contexto de análise de cada lote.
 * - Retorna o resultado consolidado com todas as análises e contextos.
 *
 * Só confirma sucesso quando TODOS os lotes e feedbacks forem válidos.
 * Após uma falha, aguarda chamadas em voo e não inicia novos lotes.
 */
export async function runIaAnalyzeService(
  request: IaAnalyzeRemoteRunRequest,
  creds?: LlmCreds,
): Promise<IaAnalyzeRemoteRunResponse> {
  const batches = Array.isArray(request.batches) ? request.batches : [];

  if (batches.length === 0) {
    return { analyses: [], contexts: [] };
  }

  const iaApiClient = createProvider(resolveProviderConfig(creds));
  const analysesByFeedbackId = new Map<string, IaAnalyzeRemoteFeedbackAnalysis>();
  const contexts: IaAnalyzeContext[] = [];

  const concurrency = readLlmConcurrency();
  let stopScheduling = false;

  const outcomes = await mapWithConcurrency(
    batches,
    concurrency,
    async (batch, batchIndex): Promise<BatchOutcome> => {
      if (!Array.isArray(batch.feedbacks) || batch.feedbacks.length === 0) {
        return { status: 'empty' };
      }
      if (stopScheduling) return { status: 'skipped' };

      try {
        const parsed = await analyzeBatchWithLanguageRepair(iaApiClient, {
          scopeType: batch.scope_type,
          enterpriseContext: request.enterprise_context,
          feedbacks: batch.feedbacks,
        });
        return { status: 'done', batch, parsed };
      } catch (error) {
        stopScheduling = true;
        console.error('[ia-analyze] lote falhou', {
          batchIndex, feedbackCount: batch.feedbacks.length,
          code: error instanceof IaApiClientError ? error.code : 'unexpected_error',
        });
        return { status: 'failed', error };
      }
    },
  );

  const succeeded = outcomes.filter(
    (outcome): outcome is Extract<BatchOutcome, { status: 'done' }> => outcome.status === 'done',
  );
  const failed = outcomes.filter(
    (outcome): outcome is Extract<BatchOutcome, { status: 'failed' }> => outcome.status === 'failed',
  );
  const nonEmptyBatchCount = batches.filter(
    (batch) => Array.isArray(batch.feedbacks) && batch.feedbacks.length > 0,
  ).length;

  // Um HTTP 200 parcial faria o Gateway/UI avançarem indevidamente ao relatório.
  if (failed.length > 0) {
    const firstError = failed[0]?.error;
    const failureCodes = failed.map((outcome) =>
      outcome.error instanceof IaApiClientError ? outcome.error.code : 'unknown',
    );
    console.error(
      `[ia-analyze] execução incompleta: total=${nonEmptyBatchCount} concluídos=${succeeded.length} falhos=${failed.length} — códigos: ${failureCodes.join(', ')}`,
    );
    const code = succeeded.length > 0 ? 'incomplete_ai_response'
      : firstError instanceof IaApiClientError ? firstError.code : 'failed_ia_request';
    throw new IaAnalyzeServiceError('AI analysis did not complete successfully', 502, code);
  }

  for (const result of succeeded) {
    const { batch, parsed } = result;

    contexts.push(buildBatchContext(batch, parsed?.global_insights));

    const feedbackById = new Map<string, IaAnalyzeFeedbackInput>(
      batch.feedbacks.map((feedback): [string, IaAnalyzeFeedbackInput] => [feedback.id, feedback]),
    );

    const items = Array.isArray(parsed?.feedbacks) ? parsed.feedbacks : [];

    items.forEach((item) => {
      if (!canProcessAnalyzedItem({ item, feedbackById })) return;

      const sourceFeedback = feedbackById.get(item.feedback_id);
      if (!sourceFeedback) return;

      const rawKeywords = Array.isArray(item.keywords) ? item.keywords : [];
      const rawCategories = Array.isArray(item.categories) ? item.categories : [];

      const keywords = extractKeywords(sourceFeedback, rawKeywords);
      const categories = extractCategories(sourceFeedback, rawCategories, keywords, batch.scope_type);
      const aspects = extractAspects(sourceFeedback, item.aspects);
      const sentiment_score =
        clampScore(item.sentiment_score) ?? scoreFromSentiment(item.sentiment);
      const confidence = normalizeConfidence(item.confidence);

      analysesByFeedbackId.set(item.feedback_id, {
        feedback_id: item.feedback_id,
        sentiment: item.sentiment,
        categories,
        keywords,
        sentiment_score,
        confidence,
        aspects,
      });
    });
  }

  return {
    analyses: Array.from(analysesByFeedbackId.values()),
    contexts,
  };
}
