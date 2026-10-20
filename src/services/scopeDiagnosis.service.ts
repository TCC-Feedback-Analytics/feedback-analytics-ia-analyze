import type { ScopeDiagnosisRemoteRequest, ScopeDiagnosisRemoteResponse } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/scope-diagnosis.contract';
import { createProvider } from '../providers/createProvider.js';
import { IaApiClientError } from '../providers/shared/retry.js';
import { IaAnalyzeServiceError, type LlmCreds } from './iaAnalyze.service.js';

/**
 * Diagnóstico do escopo: uma chamada só, com a chave da empresa (sem cair na
 * chave do ambiente). Texto fora do pt-BR ganha uma única nova tentativa.
 */
export async function runScopeDiagnosisService(
  request: ScopeDiagnosisRemoteRequest,
  creds?: LlmCreds,
): Promise<ScopeDiagnosisRemoteResponse> {
  if (!creds?.apiKey?.trim() || !creds.model?.trim() || !['openrouter', 'gemini'].includes(creds.provider ?? '')) {
    throw new IaAnalyzeServiceError('Company AI configuration required', 409, 'ia_config_required');
  }
  const client = createProvider({ provider: creds.provider as 'openrouter' | 'gemini', apiKey: creds.apiKey, model: creds.model });
  const diagnoseScope = client.diagnoseScope;
  if (!diagnoseScope) throw new IaAnalyzeServiceError('Unsupported operation', 503, 'scope_diagnosis_service_unavailable');
  try {
    try {
      return await diagnoseScope({ request });
    } catch (error) {
      if (!(error instanceof IaApiClientError) || error.code !== 'invalid_ai_response_language') throw error;
      console.warn('[ia-analyze] idioma inválido no diagnóstico; executando uma correção pt-BR');
      return await diagnoseScope({ request, languageRepair: true });
    }
  } catch (error) {
    const code = error instanceof IaApiClientError ? error.code : 'failed_ia_request';
    console.error('[scope-diagnosis] generation_failed', { code });
    throw new IaAnalyzeServiceError('AI scope diagnosis did not complete successfully', 502, code);
  }
}
