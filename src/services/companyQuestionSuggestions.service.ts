import { createProvider } from '../providers/createProvider.js';
import { IaApiClientError } from '../providers/shared/retry.js';
import { IaAnalyzeServiceError, type LlmCreds } from './iaAnalyze.service.js';
import { parseCompanyQuestionSuggestions } from '../validations/companyQuestionSuggestions.validation.js';
import type { CompanyQuestionSuggestionsRemoteRequest } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/company-question-suggestions.contract';

export async function generateCompanyQuestionSuggestions(body: CompanyQuestionSuggestionsRemoteRequest, creds?: LlmCreds) {
  if (!creds?.apiKey?.trim() || !creds.model?.trim() || !['openrouter', 'gemini'].includes(creds.provider ?? '')) {
    throw new IaAnalyzeServiceError('Company AI configuration required', 409, 'ia_config_required');
  }
  try {
    const client = createProvider({ provider: creds.provider as 'openrouter' | 'gemini', apiKey: creds.apiKey, model: creds.model });
    if (!client.generateCompanyQuestions) throw new IaAnalyzeServiceError('Unsupported operation', 503, 'question_generation_service_unavailable');
    return parseCompanyQuestionSuggestions(await client.generateCompanyQuestions(body.enterprise_context));
  } catch (error) {
    if (error instanceof IaAnalyzeServiceError) throw error;
    const code = error instanceof IaApiClientError ? error.code : 'failed_ia_request';
    console.error('[company-question-suggestions] generation_failed', { code });
    throw new IaAnalyzeServiceError('Unable to generate question suggestions', 502, code);
  }
}
