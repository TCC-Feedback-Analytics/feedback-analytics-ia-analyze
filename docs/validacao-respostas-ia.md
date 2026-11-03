# Validação e diagnóstico das respostas de IA

O OpenRouter é chamado com `response_format: { type: "json_object" }` e
`provider: { require_parameters: true }`. O modelo escolhido pela empresa não é
trocado automaticamente. Se não houver provedor compatível/disponível, a chamada
falha com diagnóstico; não há fallback silencioso para um modelo pago.

O HTTP 200 não basta: erros no corpo, falta de `choices`, conteúdo vazio, recusa,
saída truncada, JSON inválido e estrutura inválida são tratados separadamente.
O formato JSON não substitui a validação local do conteúdo.

No Gemini, a checagem antes da validação local é menor: a saída truncada
(`finishReason=MAX_TOKENS`) sai como `invalid_ai_response`, e o texto só passa
pela extração e pelo parse do JSON.

Todas as chamadas recebem uma instrução de sistema que exige português
brasileiro. Resumos e recomendações da análise e da síntese, todo texto do
diagnóstico do escopo e as perguntas sugeridas também passam por uma validação
local conservadora. Ela rejeita o texto que começa com um verbo típico de inglês
ou espanhol (`improve`, `ensure`, `mejorar`…), que tem palavras só do espanhol em
número igual ou maior que as do português, ou que tem três ou mais palavras do
inglês e mais delas que do português; termos emprestados comuns (delivery, menu,
feedback) e textos sem evidência suficiente passam. Na análise, na síntese e no
diagnóstico, o serviço faz uma única nova tentativa com reforço de idioma; uma
segunda resposta inválida falha com código tipado, sem loop de regeneração. Nas
perguntas sugeridas não há nova tentativa: o texto fora do pt-BR falha direto.

## Síntese final

Os insights de cada lote são intermediários. O endpoint interno
`POST /internal/ia-analyze/synthesize-insights` executa o reduce final usando
somente esses insights (não recebe feedbacks crus). O pedido precisa trazer de 1
a 100 insights parciais, cada um com resumo não vazio, e `analyzed_count` inteiro
maior que zero; fora disso, `400 invalid_payload`. O prompt pede um resumo coeso
e de 5 a 8 recomendações semanticamente consolidadas em pt-BR; a validação local
exige resumo não vazio e aceita de 1 a 8 recomendações, nenhuma vazia.

## Diagnóstico do escopo

`POST /internal/ia-analyze/diagnose-scope` recebe os números do escopo já
calculados no Gateway e uma amostra de comentários.

- O pedido precisa de escopo válido, períodos, métricas com contagens inteiras
  não negativas, até 50 perguntas, até 28 células de pico, até 4 canais (`QR`,
  `LINK`, `NFC` ou `null`) e até 60 comentários de até 2.000 caracteres, com
  sentimento e motivo válidos. O `comment_field`, opcional, aceita `prompt` de
  até 150 caracteres. Fora disso, `400 invalid_payload`.
- A resposta precisa de `summary` de até 1.500 caracteres; cada ponto, com
  `text` e `evidence` não vazios de até 600 caracteres; até 6 pontos por lista e
  até 6 limitações; e de 1 a 5 recomendações `fix` ou `keep`, que são
  reordenadas pela prioridade e renumeradas de 1 a N. Sem período anterior,
  `changes` sai vazio. Estrutura fora disso: `invalid_ai_response_schema`.

## Perguntas sugeridas da empresa

`POST /internal/ia-analyze/generate-company-questions` recebe só o contexto da
empresa. É uma chamada sem retry, com timeout de 60 s.

- O pedido precisa ter só `enterprise_context`, com exatamente os cinco campos:
  resumo do negócio, objetivo e meta de análise obrigatórios, de até 6.000
  caracteres; nome de até 200; e até 50 produtos ou serviços de até 200
  caracteres. Fora disso, `400 invalid_payload`.
- A resposta precisa ter exatamente três perguntas, com `question_order` 1, 2 e
  3 em ordem e sem campo a mais; cada uma de 20 a 150 caracteres, terminando no
  único `?` e sem caractere de controle; e as três distintas, ignorando acento,
  caixa e espaços. Estrutura fora disso: `invalid_ai_response_schema`.

## Conclusão integral

- Cada lote precisa devolver exatamente um resultado válido por ID enviado,
  sem IDs externos, duplicações ou omissões, além de um resumo válido.
- Um lote falho interrompe o agendamento dos próximos lotes. Chamadas já em voo
  são aguardadas, mas não transformam a execução em sucesso parcial.
- No fluxo síncrono, uma requisição com falhas não devolve resultados parciais
  ao Gateway nem inicia a geração de insights. Uma nova tentativa pode precisar
  repetir os lotes dessa requisição; não há repetição automática de JSON inválido.
- No worker, lotes completos persistidos anteriormente continuam salvos; a
  retomada busca os pendentes. O Gateway também confere a cobertura dos IDs antes
  de persistir e não contabiliza persistência parcial como lote concluído.

## Logs e códigos

Os logs do adaptador OpenRouter contêm somente código, modelo, tarefa, quantidade
de itens, status HTTP/status do provedor, motivo de término e tamanho do conteúdo.
Não incluem chave, headers, prompt, feedbacks, raciocínio, resposta bruta ou
mensagens/metadados arbitrários devolvidos pelo provedor. O adaptador Gemini
registra o status e até 300 caracteres da mensagem de erro do SDK.

Todos os códigos abaixo chegam ao Gateway com status `502`.

| Código | Significado |
| --- | --- |
| `failed_ia_request` | Provedor não alcançado: falha de rede ou timeout no OpenRouter; no Gemini, qualquer erro do SDK após as tentativas |
| `ia_provider_auth_error` | Chave recusada pelo OpenRouter (ou pelo Gemini, nas perguntas sugeridas) |
| `ia_provider_credits_exhausted` | Créditos insuficientes (no Gemini, cota diária esgotada, nas perguntas sugeridas) |
| `ia_provider_rate_limited` | Limite de chamadas após as tentativas transitórias (nas perguntas sugeridas, sem nova tentativa) |
| `ia_provider_unavailable` | Provedor indisponível/incompatível ou falha upstream |
| `ia_provider_error` | Outro erro informado pelo provedor |
| `invalid_provider_response` | Envelope ou tipo de conteúdo inesperado |
| `empty_ai_response` | Resposta sem conteúdo |
| `truncated_ai_response` | Saída cortada por limite de tokens (no Gemini, sai como `invalid_ai_response`) |
| `ai_response_refused` | Recusa/filtro de conteúdo |
| `invalid_ai_response` | Texto não interpretável como JSON |
| `invalid_ai_response_schema` | Estrutura, tipos ou IDs inválidos |
| `invalid_ai_response_language` | Texto permaneceu fora de pt-BR após a correção (nas perguntas sugeridas, já na primeira resposta) |
| `incomplete_ai_response` | Feedbacks ausentes ou execução parcialmente falha |

Os códigos do próprio serviço (`invalid_payload`, `ia_config_required`,
`missing_*_api_key`, `internal_auth_not_configured`) estão em
[endpoints](endpoints.md).

O frontend preserva esses códigos tanto na resposta síncrona quanto no polling
de jobs, exibindo orientações específicas. A mensagem não é uma garantia de que
repetir a chamada resolverá a falha; o comportamento depende também do provedor.

Não é necessária uma variável nova de ambiente. No desenvolvimento local,
reinicie `npm run dev` no ia-analyze para carregar as alterações (o script não
usa watch). Atualize também o Gateway e o frontend.

Referências oficiais: [roteamento e suporte a parâmetros](https://openrouter.ai/docs/guides/routing/provider-selection)
e [erros durante geração, inclusive HTTP 200](https://openrouter.ai/docs/api/reference/errors-and-debugging).
