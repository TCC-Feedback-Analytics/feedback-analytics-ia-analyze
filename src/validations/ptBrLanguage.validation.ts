import type { IaAnalyzeInsights } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/analysis.contract';
import { IaApiClientError } from '../providers/shared/retry.js';

const PORTUGUESE_MARKERS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas',
  'no', 'nos', 'o', 'os', 'ou', 'para', 'pela', 'pelas', 'pelo', 'pelos', 'por', 'que',
  'se', 'uma', 'um', 'cliente', 'clientes', 'equipe', 'melhorar', 'atendimento', 'garantir',
]);

const ENGLISH_MARKERS = new Set([
  'and', 'but', 'for', 'from', 'of', 'on', 'the', 'to', 'with', 'clients', 'customers',
  'staff', 'food', 'service', 'improve', 'ensure', 'review', 'reduce', 'train', 'expand',
  'standardize', 'offerings', 'packaging', 'loyalty', 'reward', 'requests', 'needs',
  'dining', 'lighting', 'waits', 'kitchen', 'sizes', 'portion', 'consistency', 'friendly',
]);

const SPANISH_ONLY_MARKERS = new Set([
  'mejorar', 'asegurar', 'entrenar', 'equipo', 'atencion', 'retrasos', 'comida', 'mesas',
]);

const FOREIGN_OPENING_VERBS = new Set([
  'standardize', 'train', 'expand', 'improve', 'ensure', 'review', 'reduce', 'mejorar',
  'asegurar', 'entrenar',
]);

function tokensOf(text: string): string[] {
  return text.toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z]+/g) ?? [];
}

/**
 * Detector conservador: rejeita frases claramente inglesas/espanholas, mas
 * aceita termos emprestados comuns (delivery, menu, feedback) e textos curtos
 * sem evidência suficiente para identificar o idioma.
 */
export function isLikelyPtBrText(text: string): boolean {
  const tokens = tokensOf(text);
  if (tokens.length === 0) return true;
  if (FOREIGN_OPENING_VERBS.has(tokens[0])) return false;

  const portuguese = tokens.filter(token => PORTUGUESE_MARKERS.has(token)).length;
  const english = tokens.filter(token => ENGLISH_MARKERS.has(token)).length;
  const spanish = tokens.filter(token => SPANISH_ONLY_MARKERS.has(token)).length;

  if (spanish >= 1 && spanish >= portuguese) return false;
  return !(english >= 3 && english > portuguese);
}

/** Valida apenas o texto que aparece no relatório; nunca registra seu conteúdo. */
export function assertInsightsInPtBr(insights: IaAnalyzeInsights): void {
  const texts = [insights.summary ?? '', ...(insights.recommendations ?? [])];
  if (texts.some(text => typeof text === 'string' && !isLikelyPtBrText(text))) {
    throw new IaApiClientError(
      'AI response contains report text outside Brazilian Portuguese',
      'invalid_ai_response_language',
    );
  }
}
