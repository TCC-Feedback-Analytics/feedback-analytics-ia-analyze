import type { IaApiClient } from '../../types/iaApiClient.types.js';
import { createIaApiClient } from './gemini.provider.js';
import { createOpenRouterClient } from './openrouter.provider.js';

/**
 * Fábrica de provedor de IA (padrão Strategy). Inverte o antigo import fixo do
 * Gemini: o motor passa a depender da porta `IaApiClient`, e QUAL provedor
 * responde é decidido em runtime por `config` (env na Camada 1; por requisição/
 * empresa na Camada 2 do BYO-key).
 */
export type LlmProvider = 'gemini' | 'openrouter';

export type ProviderConfig = {
  provider: LlmProvider;
  apiKey: string;
  /** id do modelo; cada provedor aplica o seu default quando ausente. */
  model?: string;
};

export function createProvider(config: ProviderConfig): IaApiClient {
  switch (config.provider) {
    case 'openrouter':
      return createOpenRouterClient({ apiKey: config.apiKey, model: config.model });
    case 'gemini':
    default:
      return createIaApiClient(config.apiKey, config.model);
  }
}
