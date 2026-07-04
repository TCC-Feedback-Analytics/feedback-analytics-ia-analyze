import type {
  IaAnalyzeFeedbackInput,
} from '@feedback/lib-shared/interfaces/contracts/ia-analyze/input.contract';
import type { IaAnalyzeRemoteFeedbackAnalysis } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/remote.contract';

/**
 * Tipos do modulo de validacao de sentimento do dominio ia-analyze.
 * Centraliza contratos de entrada para filtragem de itens retornados pela IA.
 */

/**
 * Parametros para validar se um item analisado pode ser processado.
 * Serve para garantir que item e referencia de feedback estejam coerentes.
 */
export type CanProcessAnalyzedItemParams = {
  item: IaAnalyzeRemoteFeedbackAnalysis;
  feedbackById: Map<string, IaAnalyzeFeedbackInput>;
};
