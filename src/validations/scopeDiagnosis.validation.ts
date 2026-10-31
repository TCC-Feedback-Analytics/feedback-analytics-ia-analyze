import type {
  ScopeDiagnosisFinding,
  ScopeDiagnosisPeriod,
  ScopeDiagnosisRecommendation,
  ScopeDiagnosisRemoteRequest,
  ScopeDiagnosisResult,
} from '@feedback/lib-shared/interfaces/contracts/ia-analyze/scope-diagnosis.contract';
import { IaApiClientError } from '../providers/shared/retry.js';
import { isObject } from '../utils/isObject.js';
import { isLikelyPtBrText } from './ptBrLanguage.validation.js';

const VALID_SCOPES = new Set(['COMPANY', 'PRODUCT', 'SERVICE', 'DEPARTMENT']);
const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'negative']);
const VALID_REASONS = new Set(['most_negative', 'most_positive', 'silent_detractor', 'rating_misuse', 'aspect']);
const MAX_SAMPLES = 60;
const MAX_SAMPLE_CHARS = 2_000;
const MAX_QUESTIONS = 50;

const MAX_SUMMARY_CHARS = 1_500;
const MAX_ITEM_CHARS = 600;
const MAX_FINDINGS = 6;
const MAX_RECOMMENDATIONS = 5;
const MAX_LIMITATIONS = 6;

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPeriod(value: unknown): value is ScopeDiagnosisPeriod {
  return isObject(value) && isNullableString(value.start) && isNullableString(value.end);
}

const VALID_CHANNELS = new Set(['QR', 'LINK', 'NFC']);
const MAX_CHANNELS = 4;

/** Por onde chegaram as avaliações; ausente em pedidos de gateways antigos. */
function isChannels(value: unknown): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.length <= MAX_CHANNELS && value.every(item =>
    isObject(item)
    && (item.channel === null || (typeof item.channel === 'string' && VALID_CHANNELS.has(item.channel)))
    && isCount(item.count)
    && (item.mean === null || typeof item.mean === 'number'));
}

function isMetrics(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.counts)) return false;
  const { counts } = value;
  if (!['total', 'with_comment', 'analyzed', 'pending_analysis'].every(key => isCount(counts[key]))) return false;
  if (value.ratings !== null && !isObject(value.ratings)) return false;
  if (value.comments !== null && !isObject(value.comments)) return false;
  if (value.movement !== null && !isObject(value.movement)) return false;
  if (value.customers !== null && !isObject(value.customers)) return false;
  if (!isChannels(value.channels)) return false;
  return Array.isArray(value.questions) && value.questions.length <= MAX_QUESTIONS
    && value.questions.every(isObject)
    && Array.isArray(value.peak_times) && value.peak_times.length <= 28 && value.peak_times.every(isObject);
}

function isCommentSample(value: unknown): boolean {
  return isObject(value) && typeof value.id === 'string'
    && typeof value.message === 'string' && value.message.length <= MAX_SAMPLE_CHARS
    && (value.rating === null || typeof value.rating === 'number')
    && typeof value.sentiment === 'string' && VALID_SENTIMENTS.has(value.sentiment)
    && typeof value.reason === 'string' && VALID_REASONS.has(value.reason)
    && (value.aspect === undefined || typeof value.aspect === 'string');
}

const VALID_HIDDEN = new Set(['all', 'some', 'none']);
const VALID_ADVICE = new Set(['low_participation', 'low_content']);
const MAX_COMMENT_PROMPT_CHARS = 150;

/** Campo de comentário do escopo; ausente em pedidos de gateways antigos. */
function isCommentField(value: unknown): boolean {
  if (value === undefined) return true;
  return isObject(value)
    && typeof value.hidden === 'string' && VALID_HIDDEN.has(value.hidden)
    && (value.prompt === null || (typeof value.prompt === 'string' && value.prompt.length <= MAX_COMMENT_PROMPT_CHARS))
    && (value.advice === null || (typeof value.advice === 'string' && VALID_ADVICE.has(value.advice)));
}

export function isScopeDiagnosisRequest(value: unknown): value is ScopeDiagnosisRemoteRequest {
  if (!isObject(value) || !isObject(value.enterprise_context) || !isObject(value.scope)) return false;
  const { scope } = value;
  if (typeof scope.scope_type !== 'string' || !VALID_SCOPES.has(scope.scope_type)) return false;
  if (!isNullableString(scope.catalog_item_id) || !isNullableString(scope.catalog_item_name)) return false;
  if (!isPeriod(value.period)) return false;
  if (value.previous_period !== null && !isPeriod(value.previous_period)) return false;
  if (!isMetrics(value.current)) return false;
  if (value.previous !== null && !isMetrics(value.previous)) return false;
  if (!isCommentField(value.comment_field)) return false;
  return Array.isArray(value.comment_samples) && value.comment_samples.length <= MAX_SAMPLES
    && value.comment_samples.every(isCommentSample);
}

const invalid = (): never => {
  throw new IaApiClientError('AI scope diagnosis does not match the expected schema', 'invalid_ai_response_schema');
};

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return invalid();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return invalid();
  return trimmed;
}

function findings(value: unknown): ScopeDiagnosisFinding[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FINDINGS) return invalid();
  return value.map(item => {
    if (!isObject(item)) return invalid();
    return { text: text(item.text, MAX_ITEM_CHARS), evidence: text(item.evidence, MAX_ITEM_CHARS) };
  });
}

function recommendations(value: unknown): ScopeDiagnosisRecommendation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECOMMENDATIONS) return invalid();
  const parsed = value.map((item, index) => {
    if (!isObject(item) || (item.kind !== 'fix' && item.kind !== 'keep')) return invalid();
    const priority = typeof item.priority === 'number' && Number.isFinite(item.priority) ? item.priority : index + 1;
    return {
      priority,
      kind: item.kind,
      action: text(item.action, MAX_ITEM_CHARS),
      evidence: text(item.evidence, MAX_ITEM_CHARS),
    } satisfies ScopeDiagnosisRecommendation;
  });
  // A ordem vale mais que o número que a IA escreveu: renumera 1..N sem lacunas.
  return parsed
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.priority - b.item.priority || a.index - b.index)
    .map(({ item }, index) => ({ ...item, priority: index + 1 }));
}

/**
 * Valida e normaliza a resposta. Sem período anterior, "changes" sai vazio
 * mesmo que a IA tenha escrito algo (não há com o que comparar).
 */
export function parseScopeDiagnosisResult(value: unknown, hasPrevious: boolean): ScopeDiagnosisResult {
  if (!isObject(value)) return invalid();
  const limitations = value.limitations === undefined ? [] : value.limitations;
  if (!Array.isArray(limitations) || limitations.length > MAX_LIMITATIONS) return invalid();
  const result: ScopeDiagnosisResult = {
    summary: text(value.summary, MAX_SUMMARY_CHARS),
    going_well: findings(value.going_well),
    concerns: findings(value.concerns),
    changes: hasPrevious ? findings(value.changes) : [],
    recommendations: recommendations(value.recommendations),
    limitations: limitations.map(item => text(item, MAX_ITEM_CHARS)),
  };
  assertScopeDiagnosisInPtBr(result);
  return result;
}

/** Confere o idioma de todo texto que aparece na tela; nunca registra o conteúdo. */
export function assertScopeDiagnosisInPtBr(result: ScopeDiagnosisResult): void {
  const texts = [
    result.summary,
    ...[...result.going_well, ...result.concerns, ...result.changes].flatMap(item => [item.text, item.evidence]),
    ...result.recommendations.flatMap(item => [item.action, item.evidence]),
    ...result.limitations,
  ];
  if (texts.some(item => !isLikelyPtBrText(item))) {
    throw new IaApiClientError('AI scope diagnosis contains text outside Brazilian Portuguese', 'invalid_ai_response_language');
  }
}
