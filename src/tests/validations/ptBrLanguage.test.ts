import { describe, expect, it } from 'vitest';
import { assertInsightsInPtBr, isLikelyPtBrText } from '../../validations/ptBrLanguage.validation.js';

describe('validação do idioma do relatório', () => {
  it.each([
    'Treinar a equipe para melhorar o atendimento e reduzir o tempo de espera.',
    'Revisar as embalagens de delivery e a variedade do menu.',
    'Resumo curto.',
  ])('aceita português brasileiro: %s', text => {
    expect(isLikelyPtBrText(text)).toBe(true);
  });

  it.each([
    'Clients praise food taste, friendly staff and good lunch value.',
    'Standardize portion sizes and improve kitchen timing to reduce waits.',
    'Train staff on courtesy and handling special requests.',
    'Mejorar o isolamento acústico e o layout das mesas.',
  ])('rejeita texto estrangeiro: %s', text => {
    expect(isLikelyPtBrText(text)).toBe(false);
  });

  it('produz código tipado sem incluir o conteúdo no erro', () => {
    expect(() => assertInsightsInPtBr({
      summary: 'Clients praise food taste and friendly staff.',
      recommendations: ['Melhorar o atendimento.'],
    })).toThrow(expect.objectContaining({ code: 'invalid_ai_response_language' }));
  });
});
