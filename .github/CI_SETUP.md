# CI / Deploy — IA Analyze

Consome **apenas tipos** de `@feedback/lib-shared` (repositório **público**
`feedback-analytics-contracts`, via git tag). O `npm ci` clona **sem token**;
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

Chave do Gemini (`@google/genai`) e o token do header `x-ia-analyze-token`
(autenticação entre o api-gateway e este serviço) são variáveis de ambiente
configuradas nas **Settings do projeto Vercel** — não entram no CI.

## Deploy

`workflow_dispatch` (manual, `confirm_deploy=ok`). `@vercel/node` roda
`src/index.ts` direto (sem bundle). Reusa o mesmo projeto Vercel
(`VERCEL_PROJECT_ID_IA_ANALYZE`) → URL não muda; o api-gateway continua
chamando o serviço na mesma URL. Branch de staging: `developer` (alias
`feedback-analytics-ia-homolog.vercel.app`).
