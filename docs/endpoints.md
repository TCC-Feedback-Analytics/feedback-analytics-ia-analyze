# IA Analyze — Endpoints

> **Base URL (desenvolvimento):** `http://localhost:4100`

> ⚠️ **Serviço interno.** Esta API é exclusivamente para comunicação interna — nunca exponha esses endpoints diretamente ao frontend. Todo acesso vem do API Gateway. Quando `IA_ANALYZE_INTERNAL_TOKEN` está configurado, o Gateway envia o token no header `x-ia-analyze-token` (ver nota sobre o comportamento opcional abaixo).

---

## Health Check

### `GET /internal/health` · `GET /internal/ia-analyze/health`

Verifica se o serviço está operacional. Ambas as rotas retornam o mesmo resultado.

```bash
curl http://localhost:4100/internal/health
```

**Response 200**
```json
{ "ok": true, "service": "ia-analyze" }
```

---

## Análise de Feedbacks

### `POST /internal/ia-analyze/analyze`

Recebe lotes de feedbacks e retorna análises individuais por feedback e contextos de insights por lote.

**Headers**
```
x-ia-analyze-token: <IA_ANALYZE_INTERNAL_TOKEN>
Content-Type: application/json
```

> **Nota:** o token é **opcional**. Se `IA_ANALYZE_INTERNAL_TOKEN` não estiver definido no ambiente do serviço, todas as requisições são aceitas — comportamento intencional para desenvolvimento local.

> **Credenciais do LLM (obrigatórias, BYO-key).** O Gateway envia a chave/modelo OpenRouter da empresa por header — fora do corpo e dos logs:
> ```
> x-llm-provider: openrouter
> x-llm-api-key:  <chave da empresa>
> x-llm-model:    <id do modelo>       # opcional
> ```
> No fluxo normal, o Gateway bloqueia a operação com `ia_config_required` antes de chamar este serviço quando a empresa ainda não configurou a chave.

**Schema do Body**

```typescript
// IaAnalyzeRemoteRunRequest
{
  enterprise_context: {
    enterprise_name: string | null,
    company_objective: string | null,
    analytics_goal: string | null,
    business_summary: string | null,
    main_products_or_services: string[] | null
  },
  batches: Array<{
    scope_type: 'COMPANY' | 'PRODUCT' | 'SERVICE' | 'DEPARTMENT',
    catalog_item_id: string | null,
    catalog_item_name: string | null,
    feedbacks: Array<{
      id: string,
      message: string,
      rating: number | null,
      created_at: string | null,
      scope_type: 'COMPANY' | 'PRODUCT' | 'SERVICE' | 'DEPARTMENT',
      collection_point: { id, name, type, identifier } | null,
      catalog_item: { id, name, kind, description } | null,
      dynamic_answers: IaAnalyzeDynamicAnswer[],
      dynamic_subanswers: IaAnalyzeDynamicSubanswer[]
    }>
  }>
}
```

**Exemplo Completo**

```json
{
  "enterprise_context": {
    "enterprise_name": "Restaurante Bella Vista",
    "company_objective": "Ser referência em atendimento",
    "analytics_goal": "Reduzir feedbacks negativos em 20%",
    "business_summary": "Restaurante italiano fundado em 2010",
    "main_products_or_services": ["Massa artesanal", "Risoto", "Vinho"]
  },
  "batches": [
    {
      "scope_type": "PRODUCT",
      "catalog_item_id": "uuid-do-prato",
      "catalog_item_name": "Risoto de Funghi",
      "feedbacks": [
        {
          "id": "uuid-feedback-1",
          "message": "Risoto perfeito, muito cremoso e saboroso!",
          "rating": 5,
          "created_at": "2026-05-12T12:00:00Z",
          "scope_type": "PRODUCT",
          "collection_point": null,
          "catalog_item": {
            "id": "uuid-do-prato",
            "name": "Risoto de Funghi",
            "kind": "PRODUCT",
            "description": "Risoto cremoso com funghi porcini"
          },
          "dynamic_answers": [],
          "dynamic_subanswers": []
        }
      ]
    }
  ]
}
```

**Response 200**

```typescript
// IaAnalyzeRemoteRunResponse
{
  analyses: Array<{
    feedback_id: string,
    sentiment: 'positive' | 'neutral' | 'negative',
    categories: string[],   // máx. 4
    keywords: string[],     // máx. 6
    sentiment_score?: number,  // intensidade graduada do sentimento geral em [-1, 1]
    confidence?: number,       // confiança da classificação em [0, 1]
    aspects?: Array<{          // ABSA: sentimento por aspecto, ancorado no texto (máx. 6)
      aspect: string,
      sentiment: 'positive' | 'neutral' | 'negative',
      sentiment_score?: number
    }>
  }>,
  contexts: Array<{
    scope_type: 'COMPANY' | 'PRODUCT' | 'SERVICE' | 'DEPARTMENT',
    catalog_item_id: string | null,
    catalog_item_name: string | null,
    analyzedCount: number,
    globalInsights: {
      summary: string,
      recommendations: string[]
    } | null
  }>
}
```

**Exemplo de Response**

```json
{
  "analyses": [
    {
      "feedback_id": "uuid-feedback-1",
      "sentiment": "positive",
      "categories": ["sabor", "textura"],
      "keywords": ["cremoso", "perfeito", "saboroso"],
      "sentiment_score": 0.85,
      "confidence": 0.92,
      "aspects": [
        { "aspect": "sabor", "sentiment": "positive", "sentiment_score": 0.9 },
        { "aspect": "textura", "sentiment": "positive", "sentiment_score": 0.8 }
      ]
    }
  ],
  "contexts": [
    {
      "scope_type": "PRODUCT",
      "catalog_item_id": "uuid-do-prato",
      "catalog_item_name": "Risoto de Funghi",
      "analyzedCount": 1,
      "globalInsights": {
        "summary": "Feedbacks altamente positivos com destaque para cremosidade.",
        "recommendations": ["Manter a receita original", "Considerar opção sem glúten"]
      }
    }
  ]
}
```

> **Nota:** `keywords` e `categorias` são sempre retornadas **normalizadas** — minúsculas, sem acento e sem pontuação (ex.: `"Atendimento Ágil"` vira `"atendimento agil"`).

---

## Diagnóstico do escopo

### `POST /internal/ia-analyze/diagnose-scope`

Uma chamada só ao LLM. O pedido não leva feedbacks crus em lotes: leva os **números do escopo já calculados no Gateway**, do período e do período anterior de mesmo tamanho, e uma **amostra de comentários**. A IA só interpreta: diz o que vai bem, o que preocupa, o que mudou e o que fazer.

**Headers:** os mesmos de `/analyze`. Aqui as credenciais `x-llm-*` da empresa são **obrigatórias**: sem elas, a resposta é `409 ia_config_required` e não há fallback para a chave do ambiente.

**Body:** `ScopeDiagnosisRemoteRequest` (`@feedback/lib-shared` `v1.2.0`, `interfaces/contracts/ia-analyze/scope-diagnosis.contract.ts`)

```typescript
{
  enterprise_context: IaAnalyzeEnterpriseContext,
  scope: { scope_type, catalog_item_id, catalog_item_name },
  period: { start: string | null, end: string | null },          // ISO; null nas duas = todo o período
  previous_period: { start, end } | null,
  current: ScopeDiagnosisMetrics,                                  // contagens, estrelas, perguntas, comentários, movimento, pico e clientes
  previous: ScopeDiagnosisMetrics | null,
  comment_samples: Array<{ id, message, rating, sentiment, reason, aspect? }>  // até 60
}
```

Cada número leva a sua precisão (`confidence`). O prompt pede cautela com `insufficient` e `low`. Dia e faixa dos horários de pico vão por extenso, e cada comentário é cortado em 500 caracteres, com no máximo 40 na amostra.

**Response 200:** `ScopeDiagnosisResult`

```json
{
  "summary": "O escopo vai bem no geral, mas a entrega preocupa.",
  "going_well": [{ "text": "Quem volta dá notas mais altas.", "evidence": "4,5 contra 4,1 na primeira visita." }],
  "concerns": [{ "text": "A entrega é o ponto mais fraco.", "evidence": "Média 3,4, com 48% de satisfeitos." }],
  "changes": [{ "text": "A média das estrelas caiu.", "evidence": "De 4,5 para 4,2." }],
  "recommendations": [{ "priority": 1, "kind": "fix", "action": "Rever os prazos de entrega.", "evidence": "Média 3,4 na pergunta sobre entrega." }],
  "limitations": ["Ainda há 5 comentários sem análise da IA."]
}
```

**Validação local:**
- todo ponto precisa ter texto e evidência;
- de 1 a 5 recomendações, reordenadas e renumeradas pela prioridade;
- sem período anterior, `changes` sai vazio;
- todo texto passa pela checagem de pt-BR, com uma única nova tentativa reforçada, como na síntese.

Os erros são os do provedor (tabela abaixo) com status `502`, além de `400 invalid_payload`, `409 ia_config_required` e `503 internal_auth_not_configured` (produção sem token interno).

---

## Erros

| Status | Código | Causa |
|---|---|---|
| `400` | `invalid_payload` | `enterprise_context` ou `batches` ausentes no body |
| `401` | `unauthorized_internal_request` | Header `x-ia-analyze-token` ausente ou incorreto |
| `500` | `missing_gemini_api_key` | Provedor `gemini` sem chave: nem header `x-llm-api-key` nem `GEMINI_API_KEY` no ambiente |
| `500` | `missing_openrouter_api_key` | Provedor `openrouter` sem chave: nem header `x-llm-api-key` nem `OPENROUTER_API_KEY` no ambiente |
| `502` | `failed_ia_request` | Falha ao chamar o provedor LLM (erro do SDK, credencial ou rede), após esgotar as tentativas do provider — ver Troubleshooting |
| `502` | `invalid_ai_response` | Provedor LLM retornou resposta não parseável como JSON ou saída truncada (`finishReason=MAX_TOKENS`) |

**Formato de todos os erros:**
```json
{
  "error": "codigo_do_erro",
  "message": "Descrição legível do problema"
}
```

---

## Troubleshooting

| Sintoma | Causa | Solução |
|---|---|---|
| `401` em toda requisição | Token interno errado | Iguale `IA_ANALYZE_INTERNAL_TOKEN` no Gateway e no IA Analyze |
| `500 missing_gemini_api_key` / `missing_openrouter_api_key` | Chave do provedor ausente em uma chamada interna direta | Garanta que o Gateway enviou `x-llm-provider`, `x-llm-api-key` e, opcionalmente, `x-llm-model` |
| `502 failed_ia_request` | Provedor LLM inacessível | Verifique a chave de API e a conectividade com a internet. Só é propagado **após esgotar o retry/backoff** do provider (até 4 tentativas, com backoff exponencial + jitter e respeito ao delay sugerido — `retryDelay` do Gemini ou `Retry-After` do OpenRouter) |
| `502 invalid_ai_response` | Modelo retornou JSON malformado **ou** saída truncada (`finishReason=MAX_TOKENS`) | Tente novamente; pode ser instabilidade do modelo. Se for truncamento recorrente, reduza o tamanho dos lotes na configuração do **API Gateway** (variável `IA_MAX_FEEDBACKS_PER_BATCH` **do Gateway** — o fatiamento de lotes acontece lá, não neste serviço) |
| Analyses vazias (`analyses: []`) | O modelo não retornou sentimento válido para nenhum feedback (ou todos os lotes com conteúdo falharam) | Reenvie; confira que os feedbacks têm `message` significativa (a `message` é a fonte exclusiva de categorias/keywords) e cheque os logs por `failureCodes` (`failed_ia_request` vs `invalid_ai_response`) |
