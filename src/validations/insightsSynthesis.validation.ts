import type { IaAnalyzeInsights } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/analysis.contract';
import { IaApiClientError } from '../providers/shared/retry.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateInsightsSynthesisResponse(value: unknown): asserts value is IaAnalyzeInsights {
  const invalid = () => {
    throw new IaApiClientError(
      'AI synthesis response does not match the expected schema',
      'invalid_ai_response_schema',
    );
  };
  if (!isObject(value) || typeof value.summary !== 'string' || !value.summary.trim()) return invalid();
  if (!Array.isArray(value.recommendations) || value.recommendations.length === 0 ||
      value.recommendations.length > 8 || value.recommendations.some(item =>
        typeof item !== 'string' || !item.trim())) return invalid();
}
