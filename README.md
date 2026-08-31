# feedback-analytics-ia-analyze

Serviço **serverless** de análise de feedbacks por IA do [Feedback Analytics](https://github.com/TCC-Feedback-Analytics/feedback-analytics). Recebe lotes de feedbacks do **API Gateway**, chama o **provedor de LLM configurável** (Gemini ou OpenRouter) e devolve análises estruturadas (sentimento graduado, categorias, palavras-chave e aspectos/ABSA), além de insights por lote.

Não tem banco de dados, não autentica usuários finais e não conhece a regra de negócio do sistema: é um processador de texto isolado, acessível **apenas** pelo API Gateway.

- **Runtime:** Node.js 20+ · TypeScript (ESM) · Express 5
- **IA:** provedor configurável (padrão Strategy) — **Gemini** (`@google/genai`) ou **OpenRouter** (API compatível com OpenAI); modelo configurável
- **Contratos:** tipos (type-only) de [`@feedback/lib-shared`](https://github.com/TCC-Feedback-Analytics/feedback-analytics-contracts) (git tag `v1.0.0`)
- **Deploy:** Vercel serverless (`@vercel/node` roda `src/index.ts`, `maxDuration` 300s)

## Endpoints internos

Montados sob `/internal` — **nunca** exponha publicamente; todo acesso vem do API Gateway.

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/internal/health` · `/internal/ia-analyze/health` | Health check → `{ ok: true, service: "ia-analyze" }` |
| `POST` | `/internal/ia-analyze/analyze` | Analisa lotes de feedbacks (header `x-ia-analyze-token`; aceita creds `x-llm-*` por empresa/BYO-key) |

Payload, resposta e erros detalhados em [`docs/endpoints.md`](docs/endpoints.md).

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória | Para quê |
|---|---|---|
| `IA_ANALYZE_INTERNAL_TOKEN` | não | Token do header `x-ia-analyze-token`. **Se vazio, o endpoint fica aberto** (só para dev local); quando definido, deve ser idêntico ao configurado no API Gateway |
| `PORT` | não | Porta local do Express (default `4100`; ignorada na Vercel) |
| `IA_LLM_CONCURRENCY` | não | Máx. de chamadas simultâneas ao LLM por requisição (default `3`; evita rate limit 429) |

Provedor, modelo e chave não são configurações globais deste serviço no fluxo atual. O Gateway envia a configuração OpenRouter cifrada de cada empresa pelos headers internos `x-llm-*`.

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

- [Visão geral](docs/visao-geral.md) · [Arquitetura e estrutura](docs/arquitetura-estrutura.md) · [Endpoints](docs/endpoints.md)
- CI/CD e deploy: [`.github/CI_SETUP.md`](.github/CI_SETUP.md)
- Concepção, decisões e produto: [repositório central de documentação](https://github.com/TCC-Feedback-Analytics/feedback-analytics)
