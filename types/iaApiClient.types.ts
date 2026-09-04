import type {
  IaAnalyzeEnterpriseContext,
  IaAnalyzeFeedbackInput,
} from '@feedback/lib-shared/interfaces/contracts/ia-analyze/input.contract';
import type { IaAnalyzeScopeType } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/scope.contract';
import type { IaAnalyzeInsights } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/analysis.contract';
import type { IaAnalyzeRemoteFeedbackAnalysis } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/remote.contract';

/**
 * Tipos do cliente de IA do dominio ia-analyze.
 * Centraliza contratos de entrada, saida e erros da chamada ao modelo.
 */

/**
 * Codigos de erro previstos na comunicacao com o provedor de IA.
 * Serve para padronizar tratamento de falhas no engine.
 */
export type IaApiClientErrorCode =
  | 'failed_ia_request' | 'invalid_ai_response' | 'invalid_ai_response_schema'
  | 'invalid_ai_response_language'
  | 'invalid_provider_response' | 'empty_ai_response' | 'truncated_ai_response'
  | 'incomplete_ai_response' | 'ai_response_refused' | 'ia_provider_error'
  | 'ia_provider_auth_error' | 'ia_provider_credits_exhausted'
  | 'ia_provider_rate_limited' | 'ia_provider_unavailable';

/**
 * Shape parseado da resposta da IA apos extracao de JSON.
 * Serve como contrato de retorno do cliente para o engine.
 */
export type ParsedIaResponse = {
  feedbacks?: IaAnalyzeRemoteFeedbackAnalysis[];
  global_insights?: IaAnalyzeInsights;
};

/**
 * Parametros necessarios para analisar um batch no modelo.
 * Serve para transportar escopo, contexto de empresa e feedbacks.
 */
export type AnalyzeBatchWithIaParams = {
  scopeType: IaAnalyzeScopeType;
  enterpriseContext: IaAnalyzeEnterpriseContext;
  feedbacks: IaAnalyzeFeedbackInput[];
  languageRepair?: boolean;
};

export type SynthesizeInsightsParams = {
  scopeType: IaAnalyzeScopeType;
  catalogItemId: string | null;
  catalogItemName: string | null;
  analyzedCount: number;
  enterpriseContext: IaAnalyzeEnterpriseContext;
  partialInsights: IaAnalyzeInsights[];
  languageRepair?: boolean;
};

/**
 * Contrato publico do cliente de IA utilizado pelo engine.
 * Serve para desacoplar implementacao da chamada remota do restante do fluxo.
 */
export type IaApiClient = {
  analyzeBatch: (params: AnalyzeBatchWithIaParams) => Promise<ParsedIaResponse>;
  synthesizeInsights: (params: SynthesizeInsightsParams) => Promise<IaAnalyzeInsights>;
};

/**
 * Shape minimo esperado do SDK de IA para leitura do texto bruto e do motivo de
 * encerramento (finishReason). 'MAX_TOKENS' indica resposta TRUNCADA — JSON
 * incompleto que nao deve ser parseado.
 * Serve para proteger cast e lidar com variacao de retorno da biblioteca.
 */
export type AiResponseShape = {
  text?: string | (() => string);
  candidates?: Array<{ finishReason?: string }>;
};
