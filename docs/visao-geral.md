# IA Analyze — Visão Geral

## O Que É

O `ia-analyze` é um **serviço Serverless independente** responsável por uma única coisa: receber lotes de feedbacks, chamar o **provedor de LLM** (Gemini ou OpenRouter, configurável) e retornar análises estruturadas.

Ele não tem banco de dados, não autentica usuários e não conhece a lógica de negócio do sistema. É um processador puro de texto.

## Por Que É um Serviço Separado

Separar a IA do API Gateway traz três vantagens práticas:

1. **Escalabilidade independente** — o serviço de IA pode ser escalado (ou desligado) sem afetar o restante do sistema
2. **Substituição de modelo** — trocar de provedor/modelo LLM é **configuração** deste serviço (fábrica `createProvider`), sem tocar no Gateway
3. **Isolamento de falhas** — uma falha no provedor LLM não derruba o Gateway inteiro

## Como Funciona

1. O API Gateway envia `POST /internal/ia-analyze/analyze` com `{ enterprise_context, batches[] }`
2. Se um **token interno** estiver configurado (`IA_ANALYZE_INTERNAL_TOKEN`), o serviço valida o header `x-ia-analyze-token` e rejeita requisições sem token válido (`401`); sem token configurado, aceita a requisição (default — só para dev local)
3. Para cada batch, chama o provedor LLM com um prompt estruturado por escopo
4. Processa e **sanitiza** a resposta: valida sentimentos, extrai keywords e categorias, descarta alucinações. Além disso, extrai **aspectos (ABSA)** com sentimento por aspecto, calcula uma **intensidade graduada** do sentimento geral (`sentiment_score` em `[-1,1]`) e uma **confiança** da classificação (`confidence` em `[0,1]`) por feedback, e mapeia cada categoria saneada para uma **taxonomia fixa por escopo** (canonicalização — categorias sem correspondência ficam como "emergentes")
5. Retorna `{ analyses[], contexts[] }` ao Gateway

## Serviços Internos

O processamento é dividido em seis serviços de domínio:

| Serviço | Responsabilidade |
|---|---|
| `iaAnalyze.service.ts` | Orquestrador — coordena o fluxo completo |
| `sentimentAnalysis.service.ts` | Valida se o sentimento retornado é aceito |
| `keywordExtraction.service.ts` | Extrai e sanitiza palavras-chave |
| `categorization.service.ts` | Extrai e sanitiza categorias |
| `aspectExtraction.service.ts` | Extrai aspectos ABSA do texto, com sentimento e intensidade por aspecto |
| `globalInsights.service.ts` | Monta o contexto de insights por batch |

## Autenticação Interna

Toda requisição deve incluir o header:
```
x-ia-analyze-token: <IA_ANALYZE_INTERNAL_TOKEN>
```

O valor deve ser idêntico ao configurado no API Gateway via variável de ambiente `IA_ANALYZE_INTERNAL_TOKEN`. Requisições com token inválido recebem `401 unauthorized_internal_request`.

> **Nota:** o token é **opcional**. Se `IA_ANALYZE_INTERNAL_TOKEN` não estiver definido no ambiente, todas as requisições são aceitas — comportamento intencional para desenvolvimento local.

> ⚠️ **Aviso:** Nunca exponha a URL do IA Analyze publicamente. Ela deve ser acessível apenas pelo API Gateway na rede interna.

## Tecnologias

- **Runtime:** Node.js 20+ com TypeScript (ESM)
- **Framework:** Express
- **Provedor de IA (configurável):** o motor depende de uma **porta** (`IaApiClient`), e uma **fábrica** (`providers/createProvider.ts`, padrão Strategy/Adapter) escolhe o adaptador em runtime — **Gemini** (`@google/genai`) ou **OpenRouter** (API compatível com OpenAI). Definido por `LLM_PROVIDER` (default `gemini`, sem regressão) + a chave do provedor (`GEMINI_API_KEY` / `OPENROUTER_API_KEY`). Cada empresa também pode trazer a **própria chave/modelo** por requisição (BYO-key, headers `x-llm-*`; ver [Arquitetura](./arquitetura-estrutura.md)).
- **Modelo (configurável):** `LLM_MODEL` — cada provedor aplica o seu default quando ausente (`gemini-2.5-flash` / `openrouter/auto`).
- **Concorrência:** `IA_LLM_CONCURRENCY` (default `3`; aceita o nome antigo `IA_GEMINI_CONCURRENCY`) limita quantas chamadas ao LLM ficam em voo ao mesmo tempo por requisição, evitando estourar o rate limit do provedor (→ `429`).
- **Resiliência:** helpers compartilhados (`providers/shared/retry.ts`) aplicam retry com backoff exponencial e jitter (até 4 tentativas) nos **dois** adaptadores, repetindo apenas em status transitórios (`429`, `500`, `502`, `503`, `504`); cada provedor decide o que **não** retentar (no OpenRouter, `401`/`402`; no Gemini, a **cota diária** falha rápido).
- **Testes:** Vitest
- **Deploy:** Vercel (serverless)

## Veja Também

- [Endpoints](./endpoints.md)
- [Arquitetura e Estrutura](./arquitetura-estrutura.md)
- [Regras de Negócio](https://github.com/TCC-Feedback-Analytics/feedback-analytics/blob/main/docs/produto/regras-negocio.md)
- [Funcionalidade — Painel de Insights](https://github.com/TCC-Feedback-Analytics/feedback-analytics/blob/main/docs/produto/painel-insights-ia.md)
