import type { SynthesizeInsightsParams } from '../../types/iaApiClient.types.js';
import { PT_BR_REPAIR_INSTRUCTION } from './prompts/ptBrSystemInstruction.js';

const MAX_SUMMARY_CHARS = 6_000;
const MAX_RECOMMENDATIONS_PER_PARTIAL = 30;
const MAX_RECOMMENDATION_CHARS = 1_000;

/**
 * Monta o reduce final: recebe apenas insights parciais, nunca os feedbacks
 * crus. Isso mantém a chamada curta e produz um único relatório coeso.
 */
export function buildInsightsSynthesisPrompt(params: SynthesizeInsightsParams): string {
  const partialInsights = params.partialInsights.map(insight => ({
    summary: (insight.summary ?? '').slice(0, MAX_SUMMARY_CHARS),
    recommendations: (insight.recommendations ?? [])
      .slice(0, MAX_RECOMMENDATIONS_PER_PARTIAL)
      .map(item => item.slice(0, MAX_RECOMMENDATION_CHARS)),
  }));

  return [
    ...(params.languageRepair ? [PT_BR_REPAIR_INSTRUCTION, ''] : []),
    'Produza o relatório final consolidado a partir dos insights parciais abaixo.',
    'Regras obrigatórias:',
    '- Escreva exclusivamente em português brasileiro (pt-BR).',
    '- Crie um único resumo coeso, com no máximo dois parágrafos curtos.',
    '- Elimine repetições e una recomendações semanticamente equivalentes.',
    '- Retorne entre 5 e 8 recomendações objetivas, priorizando padrões recorrentes e acionáveis.',
    '- Não invente fatos, métricas ou temas ausentes nos insights parciais.',
    '- Não mencione lotes, etapas intermediárias ou o processo de consolidação.',
    '- Retorne somente JSON válido no formato exato indicado.',
    '',
    'Formato exato:',
    JSON.stringify({
      summary: 'Resumo final coeso dos principais padrões encontrados.',
      recommendations: ['Recomendação objetiva e acionável.'],
    }, null, 2),
    '',
    'Contexto da síntese:',
    JSON.stringify({
      scope_type: params.scopeType,
      catalog_item_id: params.catalogItemId,
      catalog_item_name: params.catalogItemName,
      analyzed_count: params.analyzedCount,
      enterprise: params.enterpriseContext,
      partial_insights: partialInsights,
    }),
  ].join('\n');
}
