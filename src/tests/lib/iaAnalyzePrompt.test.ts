import { describe, expect, it } from 'vitest';
import type { IaAnalyzeFeedbackInput } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/input.contract';
import { buildIaPromptByScope } from '../../lib/iaAnalyzePromptBuilders.js';

const enterpriseContext = {
  enterprise_name: 'Padaria',
  company_objective: 'Fidelizar os clientes',
  analytics_goal: 'Do que os clientes mais reclamam',
  business_summary: 'Padaria de bairro',
  main_products_or_services: ['Pães'],
};

function feedback(id: string, extra: Partial<IaAnalyzeFeedbackInput> = {}): IaAnalyzeFeedbackInput {
  return {
    id,
    message: 'Guardanapo.',
    rating: 3,
    created_at: '2026-10-20T12:00:00.000Z',
    scope_type: 'COMPANY',
    collection_point: null,
    catalog_item: null,
    dynamic_answers: [],
    dynamic_subanswers: [],
    ...extra,
  };
}

describe('prompt da análise dos comentários', () => {
  it('leva a pergunta própria junto do comentário e a regra de lê-lo como resposta', () => {
    const prompt = buildIaPromptByScope({
      scopeType: 'COMPANY',
      enterpriseContext,
      feedbacks: [feedback('fb-1', { comment_prompt: 'O que faltou no atendimento?' })],
    });
    expect(prompt).toContain('"message_primary":"Guardanapo.","message_question":"O que faltou no atendimento?"');
    expect(prompt).toContain('leia o texto como resposta a ela');
  });

  it('com o convite padrão, o feedback vai como antes, sem pergunta', () => {
    const prompt = buildIaPromptByScope({ scopeType: 'COMPANY', enterpriseContext, feedbacks: [feedback('fb-2')] });
    // A regra fica no cabeçalho; o que não pode aparecer é o campo nos dados do feedback.
    expect(prompt).not.toContain('"message_question":');
  });
});
