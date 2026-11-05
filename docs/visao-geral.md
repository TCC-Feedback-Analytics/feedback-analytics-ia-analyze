# IA Analyze — Visão Geral

## O Que É

O `ia-analyze` é um **serviço Serverless independente** responsável pelas tarefas de IA do sistema: recebe o pedido do API Gateway, chama o **LLM da empresa** (provedor, chave e modelo chegam nos headers `x-llm-*`) e retorna o resultado estruturado. São quatro tarefas:

- **Análise de feedbacks** — classifica lotes de feedbacks e gera insights por lote
- **Síntese de insights** — consolida os insights parciais dos lotes num relatório único
- **Diagnóstico do escopo** — interpreta os números já calculados do período (e do anterior) e uma amostra de comentários
- **Sugestões de perguntas** — propõe três perguntas para o feedback geral da empresa, a partir do contexto dela

Ele não tem banco de dados, não autentica usuários e não conhece a lógica de negócio do sistema. É um processador puro de texto.

## Por Que É um Serviço Separado

Separar a IA do API Gateway traz três vantagens práticas:

1. **Escalabilidade independente** — o serviço de IA pode ser escalado (ou desligado) sem afetar o restante do sistema
2. **Substituição de modelo** — o modelo e a chave são escolhidos por empresa e chegam em cada requisição; adicionar um provedor novo é escrever mais um adaptador atrás da fábrica `createProvider`, sem tocar no motor de análise
3. **Isolamento de falhas** — uma falha no provedor LLM não derruba o Gateway inteiro

## Como Funciona

1. O API Gateway envia `POST /internal/ia-analyze/analyze` com `{ enterprise_context, batches[] }`
2. Se um **token interno** estiver configurado (`IA_ANALYZE_INTERNAL_TOKEN`), o serviço valida o header `x-ia-analyze-token` e rejeita requisições sem token válido (`401`); sem token configurado, aceita a requisição no dev local e responde `503 internal_auth_not_configured` em produção
3. Para cada batch, chama o provedor LLM com um prompt estruturado por escopo, com concorrência limitada. Quando o escopo tem pergunta própria no campo de comentário, ela vai junto (`message_question`) para o modelo ler o comentário como resposta a ela
4. **Valida** a resposta do lote: formato, um resultado por feedback enviado (sem omissões, duplicatas ou IDs de fora) e resumo e recomendações em **pt-BR** — texto em outro idioma ganha uma única nova tentativa com reforço de idioma ([detalhes](./validacao-respostas-ia.md))
5. Processa e **sanitiza** a resposta: valida sentimentos, extrai keywords e categorias, descarta alucinações. Além disso, extrai **aspectos (ABSA)** com sentimento por aspecto, calcula uma **intensidade graduada** do sentimento geral (`sentiment_score` em `[-1,1]`) e uma **confiança** da classificação (`confidence` em `[0,1]`) por feedback, e mapeia cada categoria saneada para uma **taxonomia fixa por escopo** (canonicalização — categorias sem correspondência ficam como "emergentes")
6. Retorna `{ analyses[], contexts[] }` ao Gateway — só quando **todos** os lotes concluem; se algum falhar, o serviço para de agendar novos lotes e responde `502`, sem resultado parcial

Depois das análises, o Gateway envia os insights parciais dos lotes para `POST /internal/ia-analyze/synthesize-insights`, que devolve o relatório consolidado. Diagnóstico do escopo e sugestões de perguntas são chamadas avulsas, de um pedido só. Payloads e respostas em [Endpoints](./endpoints.md).

## Serviços Internos

O processamento é dividido em oito serviços de domínio:

| Serviço | Responsabilidade |
|---|---|
| `iaAnalyze.service.ts` | Orquestrador da análise — coordena o fluxo completo; também executa a síntese de insights |
| `sentimentAnalysis.service.ts` | Valida se o sentimento retornado é aceito |
| `keywordExtraction.service.ts` | Extrai e sanitiza palavras-chave |
| `categorization.service.ts` | Extrai e sanitiza categorias |
| `aspectExtraction.service.ts` | Extrai aspectos ABSA do texto, com sentimento e intensidade por aspecto |
| `globalInsights.service.ts` | Monta o contexto de insights por batch |
| `scopeDiagnosis.service.ts` | Diagnóstico do escopo, com uma nova tentativa se o texto vier fora do pt-BR |
| `companyQuestionSuggestions.service.ts` | Sugestões de perguntas da empresa |

## Autenticação Interna

Toda requisição deve incluir o header:
```
x-ia-analyze-token: <IA_ANALYZE_INTERNAL_TOKEN>
```

O valor deve ser idêntico ao configurado no API Gateway via variável de ambiente `IA_ANALYZE_INTERNAL_TOKEN`. Requisições com token inválido recebem `401 unauthorized_internal_request`.

> **Nota:** o token é **opcional** em desenvolvimento local. Se `IA_ANALYZE_INTERNAL_TOKEN` não estiver definido, as rotas só aceitam requisições fora da Vercel e fora de `NODE_ENV=production`; lá, todas respondem `503 internal_auth_not_configured`.

> ⚠️ **Aviso:** Nunca exponha a URL do IA Analyze publicamente. Ela deve ser acessível apenas pelo API Gateway na rede interna.

## Tecnologias

- **Runtime:** Node.js 20+ com TypeScript (ESM)
- **Framework:** Express 5
- **Provedor de IA por empresa:** o Gateway envia obrigatoriamente a chave e o modelo OpenRouter configurados no perfil pelos headers internos `x-llm-*`. A fábrica (`providers/createProvider.ts`, padrão Strategy/Adapter) escolhe entre os adaptadores `openrouter` e `gemini` pelo `x-llm-provider`; não há credencial LLM global no ambiente padrão. Diagnóstico e sugestões de perguntas exigem provedor, chave e modelo da empresa (sem eles, `409 ia_config_required`); análise e síntese ainda aceitam um fallback legado por variáveis de ambiente ([Arquitetura](./arquitetura-estrutura.md#provedor-de-llm-configurável--byo-key-etapa-04)).
- **Modelo configurável:** vem do perfil da empresa; na análise e na síntese, quando omitido, o OpenRouter usa `openrouter/auto`.
- **Idioma:** todas as chamadas levam uma instrução de sistema que exige pt-BR, e o texto exibido ao usuário passa por uma validação local de idioma.
- **Concorrência:** `IA_LLM_CONCURRENCY` (default `3`; aceita o nome antigo `IA_GEMINI_CONCURRENCY`) limita quantas chamadas ao LLM ficam em voo ao mesmo tempo por requisição, evitando estourar o rate limit do provedor (→ `429`).
- **Resiliência:** helpers compartilhados (`providers/shared/retry.ts`) aplicam retry com backoff exponencial e jitter (até 4 tentativas) nos **dois** adaptadores, repetindo apenas em status transitórios (`429`, `500`, `502`, `503`, `504`); cada provedor decide o que **não** retentar (no OpenRouter, `401`/`402`; no Gemini, a **cota diária** falha rápido). A geração de perguntas não tem retry e tem timeout de 60 s.
- **Testes:** Vitest
- **Deploy:** Vercel (serverless)

## Veja Também

- [Endpoints](./endpoints.md)
- [Arquitetura e Estrutura](./arquitetura-estrutura.md)
- [Validação das Respostas de IA](./validacao-respostas-ia.md)
- [Regras de Negócio](https://github.com/TCC-Feedback-Analytics/feedback-analytics/blob/main/docs/produto/regras-negocio.md)
- [Funcionalidade — Painel de Insights](https://github.com/TCC-Feedback-Analytics/feedback-analytics/blob/main/docs/produto/painel-insights-ia.md)
