# Documentação — Serviço IA Analyze

- [Visão geral](visao-geral.md) — o que o serviço faz, por que é separado do Gateway e como funciona em linhas gerais
- [Arquitetura e estrutura](arquitetura-estrutura.md) — camadas, fluxo de uma análise, saneamento, provedores, resiliência e árvore de `src/`
- [Endpoints](endpoints.md) — rotas internas, payloads, respostas e erros
- [Validação das respostas de IA](validacao-respostas-ia.md) — como as respostas do LLM são validadas (formato, cobertura, idioma) na análise, na síntese, no diagnóstico e nas perguntas sugeridas, a regra de conclusão integral e os códigos de erro nos logs

Como rodar e variáveis de ambiente: [README do repositório](../README.md). CI/CD e deploy: [`.github/CI_SETUP.md`](../.github/CI_SETUP.md).

Concepção, decisões e produto vivem no [repositório central de documentação](https://github.com/TCC-Feedback-Analytics/feedback-analytics).
