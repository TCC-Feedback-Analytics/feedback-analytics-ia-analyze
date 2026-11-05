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

> **Nota:** o token só é **opcional** no desenvolvimento local. Sem `IA_ANALYZE_INTERNAL_TOKEN`, as rotas aceitam todas as requisições fora da Vercel e fora de `NODE_ENV=production`; lá, todas respondem `503 internal_auth_not_configured`.

> **Credenciais do LLM (BYO-key).** O Gateway envia o provedor, a chave e o modelo da empresa por header — fora do corpo e dos logs:
> ```
> x-llm-provider: openrouter | gemini  # outro valor responde 409 ia_config_required
> x-llm-api-key:  <chave da empresa>
> x-llm-model:    <id do modelo>       # opcional
> ```
> Nesta rota e em `/synthesize-insights`, o que faltar nos headers vem do ambiente: `LLM_PROVIDER` (sem padrão: vazio ou desconhecido responde `409 ia_config_required`), `LLM_MODEL` e a chave do provedor (`OPENROUTER_API_KEY` ou `GEMINI_API_KEY`). Sem modelo, vale o padrão do provedor (`openrouter/auto` ou `gemini-2.5-flash`). No fluxo normal, o Gateway bloqueia a operação com `ia_config_required` antes de chamar este serviço quando a empresa ainda não configurou a chave.

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
      comment_prompt?: string | null,   // pergunta própria do escopo; o message é a resposta a ela (contratos v1.6.0)
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

Com `batches` vazio, a resposta é `200` com as duas listas vazias, sem chamar o LLM; lotes sem feedbacks são ignorados. Não há sucesso parcial: se um lote falhar, a requisição inteira sai com `502` e o código do erro (`incomplete_ai_response` quando outros lotes já tinham concluído) — ver [validação das respostas](validacao-respostas-ia.md).

---

## Síntese de insights

### `POST /internal/ia-analyze/synthesize-insights`

Etapa final (reduce) do relatório. Recebe só os insights parciais de cada lote, devolvidos por `/analyze`, nunca feedbacks crus, e devolve um resumo único com as recomendações consolidadas.

**Headers:** os mesmos de `/analyze`, com o mesmo uso do ambiente quando faltam os `x-llm-*`.

**Body:** `IaInsightsSynthesisRequest` (tipo local, em `types/insightsSynthesis.types.ts`)

```typescript
{
  enterprise_context: IaAnalyzeEnterpriseContext,
  scope_type: 'COMPANY' | 'PRODUCT' | 'SERVICE' | 'DEPARTMENT',
  catalog_item_id: string | null,
  catalog_item_name: string | null,
  analyzed_count: number,                                               // inteiro maior que zero
  partial_insights: Array<{ summary: string, recommendations: string[] }> // de 1 a 100; summary não vazio
}
```

No prompt, cada resumo parcial é cortado em 6.000 caracteres e cada insight parcial leva no máximo 30 recomendações, de até 1.000 caracteres cada.

**Response 200:** `IaInsightsSynthesisResponse`

```json
{
  "global_insights": {
    "summary": "Os clientes elogiam a cremosidade dos pratos, mas reclamam da demora no atendimento.",
    "recommendations": ["Reforçar a equipe nos horários de pico.", "Manter a receita do risoto."]
  }
}
```

**Validação local:**
- `summary` não pode vir vazio;
- de 1 a 8 recomendações, nenhuma vazia (o prompt pede de 5 a 8);
- resumo e recomendações passam pela checagem de pt-BR, com uma única nova tentativa reforçada.

Os erros são `400 invalid_payload`, `401`, `409 ia_config_required` (sem provedor válido), `500 missing_*_api_key`, `500 internal_server_error`, `503 internal_auth_not_configured` (produção sem token interno) e, em qualquer falha do provedor ou da validação, `502` com o código da falha (tabela abaixo).

---

## Sugestão de perguntas da empresa

### `POST /internal/ia-analyze/generate-company-questions`

Gera três sugestões de pergunta para o feedback geral da empresa, que o cliente responde pela escala PÉSSIMO, RUIM, MEDIANA, BOA, ÓTIMA. O pedido leva só o contexto da empresa. Uma chamada ao LLM, sem retry, com timeout de 60 s (no Gemini, também com teto de 1.024 tokens de saída).

**Headers:** os mesmos de `/analyze`, mas aqui as três credenciais `x-llm-*`, inclusive `x-llm-model`, são **obrigatórias**, e `x-llm-provider` precisa ser `openrouter` ou `gemini`: sem isso, a resposta é `409 ia_config_required` e não há fallback para a chave do ambiente. A resposta sai com `Cache-Control: no-store`.

**Body:** `CompanyQuestionSuggestionsRemoteRequest` (`@feedback/lib-shared`, `interfaces/contracts/ia-analyze/company-question-suggestions.contract.ts`)

```typescript
{
  enterprise_context: {                          // única chave do body, com exatamente estes cinco campos
    enterprise_name: string | null,              // até 200 caracteres
    business_summary: string,                    // obrigatório, não vazio, até 6.000 caracteres
    company_objective: string,                   // idem
    analytics_goal: string,                      // idem
    main_products_or_services: string[] | null   // até 50 itens, de até 200 caracteres cada
  }
}
```

**Response 200:** `CompanyQuestionSuggestionsRemoteResponse`

```json
{
  "questions": [
    { "question_order": 1, "question_text": "Como você avalia a rapidez do atendimento?" },
    { "question_order": 2, "question_text": "Como você avalia a limpeza do ambiente?" },
    { "question_order": 3, "question_text": "Como você avalia o sabor dos pratos servidos?" }
  ]
}
```

**Validação local:**
- exatamente três perguntas, com `question_order` 1, 2 e 3 nessa ordem e nenhum campo a mais;
- cada texto, sem os espaços das pontas, tem de 20 a 150 caracteres, termina no único `?` e não tem caractere de controle;
- as três são distintas, ignorando acento, caixa e espaços repetidos;
- texto fora do pt-BR falha direto com `invalid_ai_response_language`, sem nova tentativa.

Os erros são os do provedor (tabela abaixo) com status `502`, além de `400 invalid_payload`, `401`, `409 ia_config_required`, `500 internal_server_error` e `503 internal_auth_not_configured` (produção sem token interno).

---

## Diagnóstico do escopo

### `POST /internal/ia-analyze/diagnose-scope`

Uma chamada só ao LLM. O pedido não leva feedbacks crus em lotes: leva os **números do escopo já calculados no Gateway**, do período e do período anterior de mesmo tamanho, e uma **amostra de comentários**. A IA só interpreta: diz o que vai bem, o que preocupa, o que mudou e o que fazer.

**Headers:** os mesmos de `/analyze`. Aqui as três credenciais `x-llm-*` da empresa, inclusive `x-llm-model`, são **obrigatórias**, e `x-llm-provider` precisa ser `openrouter` ou `gemini`: sem isso, a resposta é `409 ia_config_required` e não há fallback para a chave do ambiente. A resposta sai com `Cache-Control: no-store`.

**Body:** `ScopeDiagnosisRemoteRequest` (`@feedback/lib-shared`, `interfaces/contracts/ia-analyze/scope-diagnosis.contract.ts`)

```typescript
{
  enterprise_context: IaAnalyzeEnterpriseContext,
  scope: { scope_type, catalog_item_id, catalog_item_name },
  period: { start: string | null, end: string | null },          // ISO; null nas duas = todo o período
  previous_period: { start, end } | null,
  current: ScopeDiagnosisMetrics,                                  // contagens, estrelas, perguntas, comentários, participação nos comentários, movimento, pico, clientes e canais
  previous: ScopeDiagnosisMetrics | null,
  comment_samples: Array<{ id, message, rating, sentiment, reason, aspect? }>, // até 60
  comment_field?: { hidden: 'all' | 'some' | 'none', prompt: string | null, advice: 'low_participation' | 'low_content' | null }
}
```

`comment_field` (contratos `v1.5.0`) é o campo de comentário do formulário do escopo: oculto em todos ou em parte dos itens, a pergunta própria que os clientes responderam e, quando vale mudar o campo, a sugestão calculada no Gateway. Com o campo oculto em tudo, o prompt pede para não falar de comentários; com `advice`, pede uma recomendação para ajustar o campo, com o número como evidência. Sem o campo (Gateway antigo), vale campo visível e sem sugestão.

`current.channels` e `previous.channels` (contratos `v1.7.0`, opcionais) dizem por onde chegaram as avaliações: `QR`, `LINK`, `NFC` e `null` (sem a marca de canal). O prompt pede comparar canais só com 10 ou mais avaliações em cada um.

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
- todo ponto precisa ter texto e evidência, de até 600 caracteres cada; `summary` vai até 1.500 caracteres;
- até 6 pontos em `going_well`, `concerns` e `changes`, e até 6 `limitations`;
- de 1 a 5 recomendações, do tipo `fix` ou `keep`, reordenadas e renumeradas pela prioridade;
- sem período anterior, `changes` sai vazio;
- todo texto passa pela checagem de pt-BR, com uma única nova tentativa reforçada, como na síntese.

Os erros são os do provedor (tabela abaixo) com status `502`, além de `400 invalid_payload`, `401`, `409 ia_config_required`, `500 internal_server_error` e `503 internal_auth_not_configured` (produção sem token interno).

---

## Erros

| Status | Código | Causa |
|---|---|---|
| `400` | `invalid_payload` | Body fora do formato da rota (em `/analyze`, `enterprise_context` ou `batches` ausentes) |
| `401` | `unauthorized_internal_request` | Header `x-ia-analyze-token` ausente ou incorreto, com `IA_ANALYZE_INTERNAL_TOKEN` configurado |
| `409` | `ia_config_required` | `/diagnose-scope` ou `/generate-company-questions` sem as três credenciais `x-llm-*` válidas; `/analyze` ou `/synthesize-insights` sem provedor válido (`openrouter` ou `gemini`) no header nem no `LLM_PROVIDER` |
| `500` | `missing_gemini_api_key` | Provedor `gemini` sem chave: nem header `x-llm-api-key` nem `GEMINI_API_KEY` no ambiente (`/analyze` e `/synthesize-insights`) |
| `500` | `missing_openrouter_api_key` | Provedor `openrouter` sem chave: nem header `x-llm-api-key` nem `OPENROUTER_API_KEY` no ambiente (`/analyze` e `/synthesize-insights`) |
| `500` | `internal_server_error` | Erro inesperado no serviço |
| `502` | `failed_ia_request` | Falha ao chamar o provedor LLM, após esgotar as tentativas do provider: no Gemini, qualquer erro do SDK (credencial, cota ou rede); no OpenRouter, falha de rede ou timeout — ver Troubleshooting |
| `502` | `invalid_ai_response` | Provedor LLM retornou resposta não parseável como JSON |
| `502` | demais códigos do provedor | Erro HTTP do provedor (`ia_provider_*`), recusa, resposta vazia no OpenRouter, truncada (`truncated_ai_response`, nos dois provedores), schema, idioma ou cobertura incompleta — ver [validação das respostas](validacao-respostas-ia.md) |
| `503` | `internal_auth_not_configured` | Qualquer rota em produção (`VERCEL=1` ou `NODE_ENV=production`) sem `IA_ANALYZE_INTERNAL_TOKEN` |

**Formato dos erros:**
```json
{
  "error": "codigo_do_erro",
  "message": "Descrição legível do problema"
}
```

Em `/diagnose-scope` e `/generate-company-questions`, só o `401` traz `message`; os demais erros dessas rotas trazem só `error`. Em todas as rotas, o `503 internal_auth_not_configured` traz só `error`.

---

## Troubleshooting

| Sintoma | Causa | Solução |
|---|---|---|
| `401` em toda requisição | Token interno errado | Iguale `IA_ANALYZE_INTERNAL_TOKEN` no Gateway e no IA Analyze |
| `500 missing_gemini_api_key` / `missing_openrouter_api_key` | Chave do provedor ausente em uma chamada interna direta | Garanta que o Gateway enviou `x-llm-provider`, `x-llm-api-key` e, opcionalmente, `x-llm-model` |
| `502 failed_ia_request` | Provedor LLM inacessível | Verifique a chave de API e a conectividade com a internet. Só é propagado **após esgotar o retry/backoff** do provider (até 4 tentativas, com backoff exponencial + jitter e respeito ao delay sugerido — `retryDelay` do Gemini ou `Retry-After` do OpenRouter); `/generate-company-questions` não retenta |
| `502 invalid_ai_response` ou `truncated_ai_response` | Modelo retornou JSON malformado, ou a saída foi cortada pelo limite de tokens (`truncated_ai_response`, nos dois provedores) | Tente novamente; pode ser instabilidade do modelo. Se for truncamento recorrente, reduza o tamanho dos lotes na configuração do **API Gateway** (variável `IA_MAX_FEEDBACKS_PER_BATCH` **do Gateway** — o fatiamento de lotes acontece lá, não neste serviço) |
| Analyses vazias (`analyses: []`) | `batches` veio vazio ou só com lotes sem feedbacks. Lote com falha não gera lista vazia: a requisição inteira sai com `502` | Confira o fatiamento de lotes no Gateway; num `502`, cheque os logs por `execução incompleta` e pelos códigos dos lotes (`failed_ia_request`, `invalid_ai_response_schema` etc.) |
