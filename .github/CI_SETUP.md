# CI / Deploy — IA Analyze

Consome **apenas tipos** de `@feedback/lib-shared` (repositório **público**
`feedback-analytics-contracts`, via git tag `v1.7.0`). O `npm ci` clona **sem token**;
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

## CI

`ci.yml` roda em `push` e `pull_request` para `main` e `developer`, com Node 20, em
dois jobs: `lint-typecheck` (`npm run lint` + `tsc -p tsconfig.ci.json --noEmit`) e
`unit-tests` (`npm test`).

## Env de runtime (no projeto Vercel, NÃO como GitHub secret)

O token interno (`IA_ANALYZE_INTERNAL_TOKEN`, autenticação do header
`x-ia-analyze-token` entre o api-gateway e este serviço) é variável de ambiente
configurada nas **Settings do projeto Vercel** — não entra no CI. Na Vercel, sem ele,
`diagnose-scope` e `generate-company-questions` respondem `503`. Provedor, chave e
modelo do LLM **não** ficam no ambiente: o api-gateway manda os da empresa em cada
requisição (headers `x-llm-*`). O código ainda lê `LLM_PROVIDER`, `GEMINI_API_KEY`/
`OPENROUTER_API_KEY` e `LLM_MODEL` como fallback legado na análise e na síntese, mas
eles não fazem parte da configuração padrão. (Opcionais: `PORT`, `IA_LLM_CONCURRENCY`;
ver `.env.example`.)

## Deploy

`workflow_dispatch` (manual, `confirm_deploy=ok`). `@vercel/node` roda
`src/index.ts` direto (sem bundle). Reusa o mesmo projeto Vercel
(`VERCEL_PROJECT_ID_IA_ANALYZE`) → URL não muda; o api-gateway continua
chamando o serviço na mesma URL. Aceito **apenas na branch `main`** — não há mais
deploy da branch `developer`/alias de homologação.
