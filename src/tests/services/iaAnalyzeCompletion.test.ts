import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IaAnalyzeRemoteRunRequest } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/remote.contract';
import { runIaAnalyzeService, runIaInsightsSynthesisService } from '../../services/iaAnalyze.service.js';
import { IaApiClientError } from '../../providers/shared/retry.js';
import { validateIaBatchResponse } from '../../validations/iaBatchResponse.validation.js';

const { analyzeBatch, synthesizeInsights } = vi.hoisted(() => ({ analyzeBatch: vi.fn(), synthesizeInsights: vi.fn() }));
vi.mock('../../providers/createProvider.js', () => ({ createProvider: () => ({ analyzeBatch, synthesizeInsights }) }));

function payload(count = 1): IaAnalyzeRemoteRunRequest {
  return {
    enterprise_context: { enterprise_name: 'Teste', company_objective: 'Objetivo', analytics_goal: 'Meta', business_summary: 'Resumo', main_products_or_services: [] },
    batches: Array.from({ length: count }, (_, i) => ({
      scope_type: 'COMPANY', catalog_item_id: null, catalog_item_name: null,
      feedbacks: [{ id: `fb-${i}`, message: 'Ótimo atendimento', rating: 5, created_at: null, scope_type: 'COMPANY', catalog_item: null, collection_point: null, dynamic_answers: [], dynamic_subanswers: [] }],
    })),
  };
}
const response = (id = 'fb-0') => ({
  feedbacks: [{ feedback_id: id, sentiment: 'positive', keywords: ['atendimento'], categories: ['atendimento'], sentiment_score: 0.8, confidence: 0.9, aspects: [] }],
  global_insights: { summary: 'Bom atendimento', recommendations: [] },
});
const creds = { provider: 'openrouter', apiKey: 'test-only-key' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('IA_LLM_CONCURRENCY', '1');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('conclusão integral da análise', () => {
  it('retorna sucesso apenas com cobertura de todos os lotes', async () => {
    analyzeBatch.mockImplementation(async ({ feedbacks }) => response(feedbacks[0].id));
    const result = await runIaAnalyzeService(payload(3), creds);
    expect(result.analyses.map(item => item.feedback_id)).toEqual(['fb-0', 'fb-1', 'fb-2']);
    expect(result.contexts).toHaveLength(3);
  });

  it('um lote bom e outro falho não vira HTTP 200 parcial; não agenda restantes', async () => {
    analyzeBatch.mockResolvedValueOnce(response()).mockRejectedValueOnce(new IaApiClientError('empty', 'empty_ai_response'));
    await expect(runIaAnalyzeService(payload(3), creds)).rejects.toMatchObject({ statusCode: 502, code: 'incomplete_ai_response' });
    expect(analyzeBatch).toHaveBeenCalledTimes(2);
  });

  it('preserva a causa quando a primeira chamada falha e interrompe os lotes restantes', async () => {
    analyzeBatch.mockRejectedValue(new IaApiClientError('empty', 'empty_ai_response'));
    await expect(runIaAnalyzeService(payload(6), creds)).rejects.toMatchObject({ code: 'empty_ai_response' });
    expect(analyzeBatch).toHaveBeenCalledOnce();
  });

  it('aguarda chamadas já em voo mas não retorna seus resultados como sucesso parcial', async () => {
    vi.stubEnv('IA_LLM_CONCURRENCY', '2');
    let finish!: (value: unknown) => void;
    analyzeBatch.mockRejectedValueOnce(new IaApiClientError('bad JSON', 'invalid_ai_response'))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const execution = runIaAnalyzeService(payload(4), creds);
    const check = expect(execution).rejects.toMatchObject({ code: 'incomplete_ai_response' });
    await Promise.resolve();
    finish(response('fb-1'));
    await check;
    expect(analyzeBatch).toHaveBeenCalledTimes(2);
  });

  it('logs do serviço não imprimem erro arbitrário com dados sensíveis', async () => {
    analyzeBatch.mockRejectedValue(new Error('sk-or-secret PRIVATE-FEEDBACK'));
    await expect(runIaAnalyzeService(payload(), creds)).rejects.toMatchObject({ code: 'failed_ia_request' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/sk-or-secret|PRIVATE-FEEDBACK/);
  });

  it.each([null, [], {}, { feedbacks: [null] }, { ...response(), global_insights: null }, { ...response(), feedbacks: [{ ...response().feedbacks[0], sentiment: 'unknown' }] }])('rejeita estrutura inválida %j', async value => {
    analyzeBatch.mockResolvedValue(value);
    await expect(runIaAnalyzeService(payload(), creds)).rejects.toMatchObject({ code: 'invalid_ai_response_schema' });
  });

  it('detecta feedback omitido mesmo com JSON e resumo válidos', async () => {
    analyzeBatch.mockResolvedValue({ ...response(), feedbacks: [] });
    await expect(runIaAnalyzeService(payload(), creds)).rejects.toMatchObject({ code: 'incomplete_ai_response' });
  });
  it('refaz uma única vez quando o relatório do lote vem em inglês', async () => {
    analyzeBatch.mockResolvedValueOnce({
      ...response(), global_insights: { summary: 'Clients praise food taste and friendly staff.', recommendations: [] },
    }).mockResolvedValueOnce(response());

    await expect(runIaAnalyzeService(payload(), creds)).resolves.toMatchObject({ contexts: [{ globalInsights: { summary: 'Bom atendimento' } }] });
    expect(analyzeBatch).toHaveBeenCalledTimes(2);
    expect(analyzeBatch.mock.calls[1][0]).toMatchObject({ languageRepair: true });
  });

  it('falha com código específico se a correção também vier fora de pt-BR', async () => {
    analyzeBatch.mockResolvedValue({
      ...response(), global_insights: { summary: 'Clients praise food taste and friendly staff.', recommendations: [] },
    });
    await expect(runIaAnalyzeService(payload(), creds)).rejects.toMatchObject({ code: 'invalid_ai_response_language' });
    expect(analyzeBatch).toHaveBeenCalledTimes(2);
  });
});

describe('síntese final', () => {
  const request = {
    enterprise_context: payload().enterprise_context,
    scope_type: 'COMPANY' as const,
    catalog_item_id: null,
    catalog_item_name: null,
    analyzed_count: 105,
    partial_insights: [{ summary: 'Resumo parcial', recommendations: ['Melhorar atendimento'] }],
  };

  it('corrige idioma e retorna um único insight final', async () => {
    synthesizeInsights.mockResolvedValueOnce({
      summary: 'Clients praise food taste and friendly staff.', recommendations: ['Improve service quality.'],
    }).mockResolvedValueOnce({
      summary: 'Os clientes elogiam a comida e o atendimento.', recommendations: ['Padronizar o atendimento.'],
    });
    await expect(runIaInsightsSynthesisService(request, creds)).resolves.toEqual({
      global_insights: {
        summary: 'Os clientes elogiam a comida e o atendimento.', recommendations: ['Padronizar o atendimento.'],
      },
    });
    expect(synthesizeInsights).toHaveBeenCalledTimes(2);
    expect(synthesizeInsights.mock.calls[1][0]).toMatchObject({ languageRepair: true });
  });

  it('preserva o código tipado do provedor para o Gateway poder retentar', async () => {
    synthesizeInsights.mockRejectedValueOnce(new IaApiClientError('rate limit', 'ia_provider_rate_limited'));
    await expect(runIaInsightsSynthesisService(request, creds)).rejects.toMatchObject({
      statusCode: 502, code: 'ia_provider_rate_limited',
    });
  });
});

describe('schema do lote e isolamento de IDs', () => {
  it.each([
    { ...response().feedbacks[0], feedback_id: 'another-tenant-id' },
    { ...response().feedbacks[0], categories: 'text' },
    { ...response().feedbacks[0], keywords: [1] },
    { ...response().feedbacks[0], confidence: 5 },
    { ...response().feedbacks[0], sentiment_score: -2 },
    { ...response().feedbacks[0], aspects: [null] },
  ])('rejeita item inválido %j', item => {
    expect(() => validateIaBatchResponse({ ...response(), feedbacks: [item] }, payload().batches[0].feedbacks)).toThrow();
  });
  it('não conta IDs duplicados como análises adicionais', () => {
    expect(() => validateIaBatchResponse({ ...response(), feedbacks: [response().feedbacks[0], response().feedbacks[0]] }, payload().batches[0].feedbacks)).toThrow();
  });
});
