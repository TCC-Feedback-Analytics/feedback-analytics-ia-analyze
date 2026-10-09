import type { CompanyQuestionSuggestion, CompanyQuestionSuggestionsRemoteRequest, CompanyQuestionSuggestionsRemoteResponse } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/company-question-suggestions.contract';
import { IaApiClientError } from '../providers/shared/retry.js';
import { isLikelyPtBrText } from './ptBrLanguage.validation.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isCompanyQuestionSuggestionsRequest(value: unknown): value is CompanyQuestionSuggestionsRemoteRequest {
  if (!isObject(value) || Object.keys(value).length !== 1 || !isObject(value.enterprise_context)) return false;
  const context = value.enterprise_context;
  const fields = ['enterprise_name', 'business_summary', 'company_objective', 'analytics_goal', 'main_products_or_services'];
  if (Object.keys(context).length !== fields.length || Object.keys(context).some(key => !fields.includes(key))) return false;
  if (context.enterprise_name !== null && (typeof context.enterprise_name !== 'string' || context.enterprise_name.length > 200)) return false;
  if (['business_summary', 'company_objective', 'analytics_goal'].some(key =>
    typeof context[key] !== 'string' || !context[key].trim() || context[key].length > 6000)) return false;
  return context.main_products_or_services === null || (Array.isArray(context.main_products_or_services)
    && context.main_products_or_services.length <= 50
    && context.main_products_or_services.every(item => typeof item === 'string' && item.length <= 200));
}

export function parseCompanyQuestionSuggestions(value: unknown): CompanyQuestionSuggestionsRemoteResponse {
  const invalid = (): never => { throw new IaApiClientError('Invalid question suggestions', 'invalid_ai_response_schema'); };
  if (!isObject(value) || Object.keys(value).length !== 1 || !Array.isArray(value.questions) || value.questions.length !== 3) return invalid();
  const questions: CompanyQuestionSuggestion[] = value.questions.map((item: unknown, index: number) => {
    if (!isObject(item) || Object.keys(item).length !== 2 || item.question_order !== index + 1 || typeof item.question_text !== 'string') return invalid();
    const text = item.question_text.trim();
    if (text.length < 20 || text.length > 150 || !/^[^?]+\?$/.test(text)
      || Array.from(text).some(char => char.charCodeAt(0) < 32)) return invalid();
    if (!isLikelyPtBrText(text)) throw new IaApiClientError('Questions must be in Brazilian Portuguese', 'invalid_ai_response_language');
    return { question_order: (index + 1) as 1 | 2 | 3, question_text: text };
  });
  const normalized = questions.map(q => q.question_text.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' '));
  if (new Set(normalized).size !== 3) return invalid();
  return { questions: questions as CompanyQuestionSuggestionsRemoteResponse['questions'] };
}
