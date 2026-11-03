# feedback-analytics-ia-analyze

Serviço **serverless** de análise de feedbacks por IA do [Feedback Analytics](https://github.com/TCC-Feedback-Analytics/feedback-analytics). Recebe pedidos do **API Gateway**, chama o **LLM da empresa** (provedor, chave e modelo chegam nos headers `x-llm-*`) e devolve análises estruturadas de lotes de feedbacks (sentimento graduado, categorias, palavras-chave e aspectos/ABSA) com insights por lote, a síntese final desses insights, o diagnóstico do escopo e sugestões de perguntas para o formulário da empresa.

Não tem banco de dados, não autentica usuários finais e não conhece a regra de negócio do sistema: é um processador de texto isolado, acessível **apenas** pelo API Gateway.

- **Runtime:** Node.js 20+ · TypeScript (ESM) · Express 5
- **IA:** fábrica de provedores (padrão Strategy) com dois adaptadores — **OpenRouter** (API compatível com OpenAI; é o que o Gateway configura por empresa) e **Gemini** (`@google/genai`); provedor, chave e modelo vêm por requisição
- **Contratos:** tipos (type-only) de [`@feedback/lib-shared`](https://github.com/TCC-Feedback-Analytics/feedback-analytics-contracts) (git tag `v1.7.0`)
- **Deploy:** Vercel serverless (`@vercel/node` roda `src/index.ts`, `maxDuration` 300s)

## Endpoints internos

Montados sob `/internal` — **nunca** exponha publicamente; todo acesso vem do API Gateway.

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/internal/health` · `/internal/ia-analyze/health` | Health check → `{ ok: true, service: "ia-analyze" }` |
| `POST` | `/internal/ia-analyze/analyze` | Analisa lotes de feedbacks (header `x-ia-analyze-token`; aceita creds `x-llm-*` por empresa/BYO-key) |
| `POST` | `/internal/ia-analyze/synthesize-insights` | Síntese final: consolida os insights parciais dos lotes num relatório único |
| `POST` | `/internal/ia-analyze/diagnose-scope` | Diagnóstico do escopo: interpreta os números do período (e do anterior) e uma amostra de comentários |
| `POST` | `/internal/ia-analyze/generate-company-questions` | Sugere três perguntas para o feedback geral da empresa, a partir do contexto dela |

Payload, resposta e erros detalhados em [`docs/endpoints.md`](docs/endpoints.md).

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória | Para quê |
|---|---|---|
| `IA_ANALYZE_INTERNAL_TOKEN` | não (local) | Token do header `x-ia-analyze-token`; quando definido, deve ser idêntico ao configurado no API Gateway. **Se vazio, `analyze` e `synthesize-insights` ficam abertos** (só para dev local); na Vercel ou com `NODE_ENV=production`, `diagnose-scope` e `generate-company-questions` respondem `503 internal_auth_not_configured` |
| `PORT` | não | Porta local do Express (default `4100`; ignorada na Vercel) |
| `IA_LLM_CONCURRENCY` | não | Máx. de chamadas simultâneas ao LLM por requisição (default `3`; evita rate limit 429) |

Provedor, modelo e chave não são configurações globais deste serviço no fluxo atual. O Gateway guarda a configuração OpenRouter de cada empresa cifrada e a envia decifrada pelos headers internos `x-llm-*`.

## Rodar localmente

Este repositório **é** o serviço — os comandos rodam na raiz dele:

```bash
npm install
cp .env.example .env    # configure o token interno; as credenciais LLM vêm do Gateway
npm run dev             # http://localhost:4100
```

```bash
npm test                # testes (Vitest)
npm run lint
```

## Documentação

- [Visão geral](docs/visao-geral.md) · [Arquitetura e estrutura](docs/arquitetura-estrutura.md) · [Endpoints](docs/endpoints.md) · [Validação das respostas de IA](docs/validacao-respostas-ia.md)
- CI/CD e deploy: [`.github/CI_SETUP.md`](.github/CI_SETUP.md)
- Concepção, decisões e produto: [repositório central de documentação](https://github.com/TCC-Feedback-Analytics/feedback-analytics)
