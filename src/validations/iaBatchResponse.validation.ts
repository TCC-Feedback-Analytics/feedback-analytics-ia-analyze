import type { IaAnalyzeFeedbackInput } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/input.contract';
import type { ParsedIaResponse } from '../../types/iaApiClient.types.js';
import { IaApiClientError } from '../providers/shared/retry.js';
import { isValidSentiment } from '../services/sentimentAnalysis.service.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');
const score = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Valida formato e cobertura exata do lote, sem registrar conteúdo da IA. */
export function validateIaBatchResponse(
  value: unknown,
  feedbacks: IaAnalyzeFeedbackInput[],
): asserts value is ParsedIaResponse {
  const invalid = () => { throw new IaApiClientError('AI response does not match the expected schema', 'invalid_ai_response_schema'); };
  if (!isObject(value) || !Array.isArray(value.feedbacks)) return invalid();
  const insights = value.global_insights;
  if (!isObject(insights) || typeof insights.summary !== 'string' || !insights.summary.trim() || !strings(insights.recommendations)) return invalid();

  const expectedIds = new Set(feedbacks.map(feedback => feedback.id));
  const seen = new Set<string>();
  for (const item of value.feedbacks) {
    if (!isObject(item) || typeof item.feedback_id !== 'string' ||
        !expectedIds.has(item.feedback_id) || seen.has(item.feedback_id) ||
        !isValidSentiment(item.sentiment) || !strings(item.categories) || !strings(item.keywords)) return invalid();
    if (item.sentiment_score != null && !score(item.sentiment_score, -1, 1)) return invalid();
    if (item.confidence != null && !score(item.confidence, 0, 1)) return invalid();
    if (item.aspects != null && (!Array.isArray(item.aspects) || item.aspects.some(aspect =>
      !isObject(aspect) || typeof aspect.aspect !== 'string' || !aspect.aspect.trim() ||
      !isValidSentiment(aspect.sentiment) || !score(aspect.sentiment_score, -1, 1)
    ))) return invalid();
    seen.add(item.feedback_id);
  }
  if (seen.size !== expectedIds.size) {
    throw new IaApiClientError('AI response is missing feedback analyses', 'incomplete_ai_response');
  }
}
