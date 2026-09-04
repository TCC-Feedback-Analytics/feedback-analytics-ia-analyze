import type { IaInsightsSynthesisRequest } from '../../types/insightsSynthesis.types.js';
import { isObject } from '../utils/isObject.js';

const VALID_SCOPES = new Set(['COMPANY', 'PRODUCT', 'SERVICE', 'DEPARTMENT']);

export function isValidInsightsSynthesisRequest(value: unknown): value is IaInsightsSynthesisRequest {
  if (!isObject(value) || !isObject(value.enterprise_context)) return false;
  if (typeof value.scope_type !== 'string' || !VALID_SCOPES.has(value.scope_type)) return false;
  if (value.catalog_item_id !== null && typeof value.catalog_item_id !== 'string') return false;
  if (value.catalog_item_name !== null && typeof value.catalog_item_name !== 'string') return false;
  if (typeof value.analyzed_count !== 'number' || !Number.isInteger(value.analyzed_count) || value.analyzed_count <= 0) return false;
  if (!Array.isArray(value.partial_insights) || value.partial_insights.length === 0 || value.partial_insights.length > 100) return false;
  return value.partial_insights.every(insight =>
    isObject(insight) && typeof insight.summary === 'string' && Boolean(insight.summary.trim()) &&
    Array.isArray(insight.recommendations) && insight.recommendations.every(item => typeof item === 'string')
  );
}
