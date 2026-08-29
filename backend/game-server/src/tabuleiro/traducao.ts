// Tradução engine→wire dos eventos de tabuleiro (issue #80).
//
// O domínio (`@flicker/engine`) emite eventos em `snake_case`; o wire
// (`@flicker/shared`) os espera em `UPPER_SNAKE_CASE`. Campos em
// `camelCase` são idênticos nos dois lados. Eventos fora do escopo do #80
// (ciclo de Peões, Recebimento) são ignorados silenciosamente.

import type { EventoDoTabuleiro } from '@flicker/engine';
import type { TabuleiroEventoDoServidor } from '@flicker/shared';

export function traduzirEventos(
  eventos: readonly EventoDoTabuleiro[],
): TabuleiroEventoDoServidor[] {
  const saida: TabuleiroEventoDoServidor[] = [];
  for (const evento of eventos) {
    switch (evento.tipo) {
      case 'peca_selecionada':
        saida.push({ type: 'PECA_SELECIONADA', pecaId: evento.pecaId });
        break;
      case 'peca_deselecionada':
        saida.push({ type: 'PECA_DESELECIONADA', pecaId: evento.pecaId });
        break;
      case 'peca_girada':
        saida.push({
          type: 'PECA_GIRADA',
          pecaId: evento.pecaId,
          orientacaoAnterior: evento.orientacaoAnterior,
          orientacao: evento.orientacao,
          sentido: evento.sentido,
        });
        break;
      case 'peca_posicionada':
        saida.push({
          type: 'PECA_POSICIONADA',
          pecaId: evento.pecaId,
          celula: evento.celula,
          orientacao: evento.orientacao,
        });
        break;
      case 'manipulacao_finalizada':
        saida.push({ type: 'MANIPULACAO_FINALIZADA', pecaId: evento.pecaId });
        break;
      default:
        // Eventos de Peões/Recebimento pertencem ao ST-10 e não são do #80.
        break;
    }
  }
  return saida;
}
