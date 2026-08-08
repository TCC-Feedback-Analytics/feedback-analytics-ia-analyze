# CI / Deploy — IA Analyze

Consome **apenas tipos** de `@feedback/lib-shared` (repositório **público**
`feedback-analytics-contracts`, via git tag `v1.0.0`). O `npm ci` clona **sem token**;
os workflows só reescrevem `ssh→https` antes do install:

```
git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
```

## Secrets (só o deploy usa)

| Secret | Para quê |
|---|---|
| `VERCEL_TOKEN` | Token da conta/projeto Vercel |
| `VERCEL_ORG_ID` | ID da org no Vercel |
| `VERCEL_PROJECT_ID_IA_ANALYZE` | ID do projeto Vercel do serviço de IA |

O **CI** (lint/typecheck/unit) **não precisa de secret** — os testes são mockados.

## Env de runtime (no projeto Vercel, NÃO como GitHub secret)

A chave do Gemini (`GEMINI_API_KEY`, usada pelo `@google/genai`) e o token
interno (`IA_ANALYZE_INTERNAL_TOKEN`, autenticação do header `x-ia-analyze-token`
entre o api-gateway e este serviço) são variáveis de ambiente configuradas nas
**Settings do projeto Vercel** — não entram no CI. (Opcionais locais: `PORT`,
`IA_GEMINI_CONCURRENCY`; ver `.env.example`.)

## Deploy

`workflow_dispatch` (manual, `confirm_deploy=ok`). `@vercel/node` roda
`src/index.ts` direto (sem bundle). Reusa o mesmo projeto Vercel
(`VERCEL_PROJECT_ID_IA_ANALYZE`) → URL não muda; o api-gateway continua
chamando o serviço na mesma URL. Aceito **apenas na branch `main`** — não há mais
deploy da branch `developer`/alias de homologação.
