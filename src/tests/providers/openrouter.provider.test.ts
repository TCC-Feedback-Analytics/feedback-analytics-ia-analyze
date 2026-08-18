import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createOpenRouterClient } from '../../providers/openrouter.provider.js';
import { IaApiClientError } from '../../providers/shared/retry.js';
import type { AnalyzeBatchWithIaParams } from '../../../types/iaApiClient.types.js';

const PARAMS: AnalyzeBatchWithIaParams = {
  scopeType: 'COMPANY',
  enterpriseContext: {
    enterprise_name: 'Empresa Teste',
    company_objective: 'Melhorar satisfação',
    analytics_goal: 'Identificar pontos de melhoria',
    business_summary: 'Varejo com foco em atendimento',
    main_products_or_services: ['Produto A'],
  },
  feedbacks: [
    {
      id: 'fb-1',
      message: 'Ótimo atendimento',
      rating: 5,
      created_at: '2026-01-01T00:00:00.000Z',
      scope_type: 'COMPANY',
      collection_point: { id: 'cp-1', name: 'Geral', type: 'QR_CODE', identifier: 'abc' },
      catalog_item: null,
      dynamic_answers: [],
      dynamic_subanswers: [],
    },
  ],
};

const VALID_JSON = JSON.stringify({
  feedbacks: [],
  global_insights: { summary: 'ok', recommendations: [] },
});

/** Response fake do fetch para respostas 2xx. */
function okResponse(content: string, finishReason = 'stop') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content }, finish_reason: finishReason }] }),
    text: async () => '',
    headers: { get: () => null },
  };
}

/** Response fake do fetch para erros HTTP (com Retry-After opcional). */
function errResponse(status: number, retryAfter?: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => `error ${status}`,
    headers: {
      get: (h: string) => (h.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null),
    },
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(IaApiClientError);
  await promise.catch((e) => expect((e as IaApiClientError).code).toBe(code));
}

describe('[Unit] openrouter.provider — analyzeBatch', () => {
  it('sucesso: parseia choices[0].message.content', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(VALID_JSON));
    const client = createOpenRouterClient({ apiKey: 'sk-or-x', model: 'openrouter/auto' });

    const result = await client.analyzeBatch(PARAMS);

    expect(result.global_insights?.summary).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // manda o Bearer e o modelo no corpo
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-or-x' });
    expect(String((init as RequestInit).body)).toContain('openrouter/auto');
  });

  it('tolera JSON com texto/cercas ao redor (extractJsonFromText)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('Claro! Aqui está:\n```json\n' + VALID_JSON + '\n```'));
    const client = createOpenRouterClient({ apiKey: 'sk-or-x' });

    const result = await client.analyzeBatch(PARAMS);
    expect(result.global_insights?.summary).toBe('ok');
  });

  it('finish_reason "length" (truncado) → invalid_ai_response', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('{"feedbacks":[', 'length'));
    const client = createOpenRouterClient({ apiKey: 'sk-or-x' });
    await expectError(client.analyzeBatch(PARAMS), 'invalid_ai_response');
  });

  it('conteúdo não-JSON → invalid_ai_response', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('desculpe, não consegui'));
    const client = createOpenRouterClient({ apiKey: 'sk-or-x' });
    await expectError(client.analyzeBatch(PARAMS), 'invalid_ai_response');
  });

  it('401 (chave inválida) NÃO retenta — falha em 1 tentativa', async () => {
    fetchMock.mockResolvedValue(errResponse(401));
    const client = createOpenRouterClient({ apiKey: 'sk-or-bad' });
    await expectError(client.analyzeBatch(PARAMS), 'failed_ia_request');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('402 (sem créditos) NÃO retenta — falha em 1 tentativa', async () => {
    fetchMock.mockResolvedValue(errResponse(402));
    const client = createOpenRouterClient({ apiKey: 'sk-or-x' });
    await expectError(client.analyzeBatch(PARAMS), 'failed_ia_request');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('429 com Retry-After: retenta e conclui na 2ª tentativa', async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(429, '0'))
      .mockResolvedValueOnce(okResponse(VALID_JSON));
    const client = createOpenRouterClient({ apiKey: 'sk-or-x' });

    const result = await client.analyzeBatch(PARAMS);
    expect(result.global_insights?.summary).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
