import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../index.js';
import { runScopeDiagnosisService } from '../../services/scopeDiagnosis.service.js';
import { IaAnalyzeServiceError } from '../../services/iaAnalyze.service.js';

vi.mock('../../services/scopeDiagnosis.service.js', () => ({ runScopeDiagnosisService: vi.fn() }));

const mockService = vi.mocked(runScopeDiagnosisService);
const INTERNAL_TOKEN = 'test-internal-token';
const ROUTE = '/internal/ia-analyze/diagnose-scope';

const counts = { total: 12, with_comment: 6, analyzed: 6, pending_analysis: 0 };
const VALID_PAYLOAD = {
  enterprise_context: { enterprise_name: 'Padaria', company_objective: 'Crescer', analytics_goal: 'Entender', business_summary: 'Padaria de bairro', main_products_or_services: null },
  scope: { scope_type: 'COMPANY', catalog_item_id: null, catalog_item_name: null },
  period: { start: null, end: null },
  previous_period: null,
  current: { counts, ratings: null, questions: [], comments: null, movement: null, peak_times: [], customers: null },
  previous: null,
  comment_samples: [],
};

const RESULT = {
  summary: 'O escopo tem poucos dados, mas as notas são boas.',
  going_well: [], concerns: [], changes: [],
  recommendations: [{ priority: 1, kind: 'keep', action: 'Manter o atendimento.', evidence: 'Média de 4,6.' }],
  limitations: ['Com 12 avaliações, a precisão é baixa.'],
};

describe('[Integração] POST /internal/ia-analyze/diagnose-scope', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('retorna 401 sem token interno', async () => {
    const res = await request(app).post(ROUTE).send(VALID_PAYLOAD);
    expect(res.status).toBe(401);
    expect(mockService).not.toHaveBeenCalled();
  });

  it('retorna 400 com pacote inválido', async () => {
    const res = await request(app).post(ROUTE).set('x-ia-analyze-token', INTERNAL_TOKEN).send({ ...VALID_PAYLOAD, current: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('retorna 200 com o diagnóstico e repassa as credenciais da empresa', async () => {
    mockService.mockResolvedValueOnce(RESULT as never);
    const res = await request(app).post(ROUTE)
      .set('x-ia-analyze-token', INTERNAL_TOKEN)
      .set('x-llm-provider', 'openrouter').set('x-llm-api-key', 'test-only-key').set('x-llm-model', 'modelo/teste')
      .send(VALID_PAYLOAD);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.recommendations).toHaveLength(1);
    expect(mockService).toHaveBeenCalledWith(VALID_PAYLOAD, { provider: 'openrouter', apiKey: 'test-only-key', model: 'modelo/teste' });
  });

  it('devolve o código de erro do serviço', async () => {
    mockService.mockRejectedValueOnce(new IaAnalyzeServiceError('falhou', 502, 'ia_provider_rate_limited'));
    const res = await request(app).post(ROUTE).set('x-ia-analyze-token', INTERNAL_TOKEN).send(VALID_PAYLOAD);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('ia_provider_rate_limited');
  });
});
