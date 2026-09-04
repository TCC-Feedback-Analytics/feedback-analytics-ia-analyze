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
  feedbacks: [{ feedback_id: 'fb-1', sentiment: 'positive', categories: ['atendimento'], keywords: ['ótimo'] }],
  global_insights: { summary: 'ok', recommendations: [] },
});

/** Response fake do fetch para respostas 2xx. */
function okResponse(content: unknown, finishReason = 'stop') {
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
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
    expect(JSON.parse(String(init.body))).toMatchObject({
      messages: [
        { role: 'system', content: expect.stringContaining('português brasileiro') },
        { role: 'user' },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }, provider: { require_parameters: true },
    });
  });

  it('síntese usa prompt dedicado e valida o schema final', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(JSON.stringify({
      summary: 'Resumo final em português.', recommendations: ['Melhorar o atendimento.'],
    })));
    const result = await createOpenRouterClient({ apiKey: 'sk-or-x' }).synthesizeInsights({
      scopeType: 'COMPANY', catalogItemId: null, catalogItemName: null, analyzedCount: 105,
      enterpriseContext: PARAMS.enterpriseContext,
      partialInsights: [{ summary: 'Resumo parcial.', recommendations: ['Ação parcial.'] }],
    });
    expect(result.summary).toBe('Resumo final em português.');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('relatório final consolidado');
  });

  it('tolera JSON com texto/cercas ao redor (extractJsonFromText)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('Claro! Aqui está:\n```json\n' + VALID_JSON + '\n```'));
    const client = createOpenRouterClient({ apiKey: 'sk-or-x' });

    const result = await client.analyzeBatch(PARAMS);
    expect(result.global_insights?.summary).toBe('ok');
  });

  it('finish_reason "length" (truncado) tem código próprio', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('{"feedbacks":[', 'length'));
    const client = createOpenRouterClient({ apiKey: 'sk-or-x' });
    await expectError(client.analyzeBatch(PARAMS), 'truncated_ai_response');
  });

  it('conteúdo não-JSON → invalid_ai_response', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('desculpe, não consegui'));
    const client = createOpenRouterClient({ apiKey: 'sk-or-x' });
    await expectError(client.analyzeBatch(PARAMS), 'invalid_ai_response');
  });

  it('401 (chave inválida) NÃO retenta — falha em 1 tentativa', async () => {
    fetchMock.mockResolvedValue(errResponse(401));
    const client = createOpenRouterClient({ apiKey: 'sk-or-bad' });
    await expectError(client.analyzeBatch(PARAMS), 'ia_provider_auth_error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('402 (sem créditos) NÃO retenta — falha em 1 tentativa', async () => {
    fetchMock.mockResolvedValue(errResponse(402));
    const client = createOpenRouterClient({ apiKey: 'sk-or-x' });
    await expectError(client.analyzeBatch(PARAMS), 'ia_provider_credits_exhausted');
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

  it.each([null, undefined, '', '   '])('conteúdo vazio %j não é mascarado como JSON inválido', async content => {
    fetchMock.mockResolvedValue(okResponse(content));
    await expectError(createOpenRouterClient({ apiKey: 'sk-or-x' }).analyzeBatch(PARAMS), 'empty_ai_response');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    [null, 'invalid_provider_response'],
    [{ choices: [] }, 'invalid_provider_response'],
    [{ error: { code: 401, message: 'secret' } }, 'ia_provider_auth_error'],
    [{ error: { code: '402' } }, 'ia_provider_credits_exhausted'],
    [{ choices: [{ finish_reason: 'error', message: { content: '' } }] }, 'ia_provider_error'],
    [{ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }, 'ai_response_refused'],
    [{ choices: [{ finish_reason: 'stop', message: { refusal: 'secret', content: null } }] }, 'ai_response_refused'],
    [{ choices: [{ message: { content: [{ type: 'text', text: VALID_JSON }] } }] }, 'invalid_provider_response'],
  ])('envelope HTTP 200 inválido/falho: %j → %s', async (payload, code) => {
    fetchMock.mockResolvedValue({ ...okResponse(''), json: async () => payload });
    await expectError(createOpenRouterClient({ apiKey: 'sk-or-x' }).analyzeBatch(PARAMS), code as string);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('HTTP 200 com error 429 entra no retry transitório', async () => {
    fetchMock.mockResolvedValueOnce({ ...errResponse(200, '0'), ok: true, json: async () => ({ error: { code: 429 } }) })
      .mockResolvedValueOnce(okResponse(VALID_JSON));
    await createOpenRouterClient({ apiKey: 'sk-or-x' }).analyzeBatch(PARAMS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429 persistente esgota apenas 4 tentativas e mantém código específico', async () => {
    fetchMock.mockResolvedValue(errResponse(429, '0'));
    await expectError(createOpenRouterClient({ apiKey: 'sk-or-x' }).analyzeBatch(PARAMS), 'ia_provider_rate_limited');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('não troca automaticamente de modelo quando não há provedor compatível', async () => {
    fetchMock.mockResolvedValue(errResponse(404));
    await expectError(createOpenRouterClient({ apiKey: 'sk-or-x', model: 'vendor/model:free' }).analyzeBatch(PARAMS), 'ia_provider_unavailable');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: 'vendor/model:free', provider: { require_parameters: true } });
  });

  it('não vaza mensagens/metadata/chave/prompt de erros HTTP', async () => {
    const secret = 'sk-or-test-secret';
    fetchMock.mockResolvedValue({ ...errResponse(401), json: async () => ({ error: { code: 401, message: secret, metadata: { raw: PARAMS.feedbacks[0].message } } }), text: async () => secret });
    await expectError(createOpenRouterClient({ apiKey: secret }).analyzeBatch(PARAMS), 'ia_provider_auth_error');
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain(PARAMS.feedbacks[0].message);
    expect(logs).toContain('httpStatus');
    expect(logs).toContain('providerStatus');
  });

  it('diagnóstico de JSON inválido registra tamanho, não conteúdo nem erro de parse', async () => {
    fetchMock.mockResolvedValue(okResponse('sk-or-test-secret { malformed feedback }'));
    await expectError(createOpenRouterClient({ apiKey: 'sk-or-test-secret' }).analyzeBatch(PARAMS), 'invalid_ai_response');
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).toContain('contentLength');
    expect(logs).toContain('stop');
    expect(logs).not.toContain('sk-or-test-secret');
    expect(logs).not.toContain('malformed feedback');
  });

  it('erro de rede não expõe sua mensagem original', async () => {
    fetchMock.mockRejectedValue(new Error('headers contain sk-or-test-secret'));
    await expectError(createOpenRouterClient({ apiKey: 'sk-or-test-secret' }).analyzeBatch(PARAMS), 'failed_ia_request');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sk-or-test-secret');
  });

  it('JSON parseável mas incompleto é rejeitado, sem novas chamadas', async () => {
    fetchMock.mockResolvedValue(okResponse(JSON.stringify({ feedbacks: [], global_insights: { summary: 'ok', recommendations: [] } })));
    await expectError(createOpenRouterClient({ apiKey: 'sk-or-x' }).analyzeBatch(PARAMS), 'incomplete_ai_response');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(['null', '[]', '42', JSON.stringify([JSON.parse(VALID_JSON)])])('JSON válido de tipo errado não é reinterpretado como objeto: %s', async content => {
    fetchMock.mockResolvedValue(okResponse(content));
    await expectError(createOpenRouterClient({ apiKey: 'sk-or-x' }).analyzeBatch(PARAMS), 'invalid_ai_response_schema');
  });
});
