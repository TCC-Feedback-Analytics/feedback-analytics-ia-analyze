# Validação e diagnóstico das respostas de IA

O OpenRouter é chamado com `response_format: { type: "json_object" }` e
`provider: { require_parameters: true }`. O modelo escolhido pela empresa não é
trocado automaticamente. Se não houver provedor compatível/disponível, a chamada
falha com diagnóstico; não há fallback silencioso para um modelo pago.

O HTTP 200 não basta: erros no corpo, falta de `choices`, conteúdo vazio, recusa,
saída truncada, JSON inválido e estrutura inválida são tratados separadamente.
O formato JSON não substitui a validação local do conteúdo.

Todas as chamadas recebem uma instrução de sistema que exige português
brasileiro. Resumos e recomendações também passam por uma validação local
conservadora. Se for detectada uma frase claramente em inglês ou espanhol, o
serviço faz uma única nova tentativa com reforço de idioma; uma segunda resposta
inválida falha com código tipado, sem loop de regeneração.

## Síntese final

Os insights de cada lote são intermediários. O endpoint interno
`POST /internal/ia-analyze/synthesize-insights` executa o reduce final usando
somente esses insights (não recebe feedbacks crus), produzindo um resumo coeso e
de 5 a 8 recomendações semanticamente consolidadas em pt-BR.

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

Os logs do adaptador contêm somente código, modelo, quantidade de feedbacks,
status HTTP/status do provedor, motivo de término e tamanho do conteúdo.
Não incluem chave, headers, prompt, feedbacks, raciocínio, resposta bruta ou
mensagens/metadados arbitrários devolvidos pelo provedor.

| Código | Significado |
| --- | --- |
| `ia_provider_auth_error` | Chave recusada pelo OpenRouter |
| `ia_provider_credits_exhausted` | Créditos insuficientes |
| `ia_provider_rate_limited` | Limite de chamadas após as tentativas transitórias |
| `ia_provider_unavailable` | Provedor indisponível/incompatível ou falha upstream |
| `ia_provider_error` | Outro erro informado pelo provedor |
| `invalid_provider_response` | Envelope ou tipo de conteúdo inesperado |
| `empty_ai_response` | Resposta sem conteúdo |
| `truncated_ai_response` | Saída cortada por limite de tokens |
| `ai_response_refused` | Recusa/filtro de conteúdo |
| `invalid_ai_response` | Texto não interpretável como JSON |
| `invalid_ai_response_schema` | Estrutura, tipos ou IDs inválidos |
| `invalid_ai_response_language` | Texto do relatório permaneceu fora de pt-BR após a correção |
| `incomplete_ai_response` | Feedbacks ausentes ou execução parcialmente falha |

O frontend preserva esses códigos tanto na resposta síncrona quanto no polling
de jobs, exibindo orientações específicas. A mensagem não é uma garantia de que
repetir a chamada resolverá a falha; o comportamento depende também do provedor.

Não é necessária uma variável nova de ambiente. No desenvolvimento local,
reinicie `npm run dev` no ia-analyze para carregar as alterações (o script não
usa watch). Atualize também o Gateway e o frontend.

Referências oficiais: [roteamento e suporte a parâmetros](https://openrouter.ai/docs/guides/routing/provider-selection)
e [erros durante geração, inclusive HTTP 200](https://openrouter.ai/docs/api/reference/errors-and-debugging).
