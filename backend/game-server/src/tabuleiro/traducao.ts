// Tradução engine→wire dos eventos de tabuleiro e do ciclo de Peões
// (issues #80 e #88).
//
// O domínio (`@flicker/engine`) emite eventos em `snake_case`; o wire
// (`@flicker/shared`) os espera em `UPPER_SNAKE_CASE`. Campos em
// `camelCase` são idênticos nos dois lados. A saída é `SalaServerMessage`,
// pois os eventos de Peões chegam pelo mesmo canal da partida.

import type { EventoDoTabuleiro } from '@flicker/engine';
import type { SalaServerMessage } from '@flicker/shared';

export function traduzirEventos(
  eventos: readonly EventoDoTabuleiro[],
): SalaServerMessage[] {
  const saida: SalaServerMessage[] = [];
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
      case 'peao_selecionado':
        saida.push({ type: 'PEAO_SELECIONADO', peaoId: evento.peaoId });
        break;
      case 'recebimento_gerado':
        saida.push({ type: 'RECEBIMENTO_GERADO', recebidas: evento.recebidas });
        break;
      case 'peao_posicionado':
        saida.push({
          type: 'PEAO_POSICIONADO',
          peaoId: evento.peaoId,
          pecaId: evento.pecaId,
          celula: evento.celula,
        });
        break;
      case 'tipo_da_peca_recebida_escolhido':
        saida.push({
          type: 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO',
          recebidaId: evento.recebidaId,
          pecaId: evento.pecaId,
          tipoDaPeca: evento.tipoDaPeca,
        });
        break;
      case 'peao_movido':
        saida.push({
          type: 'PEAO_MOVIDO',
          peaoId: evento.peaoId,
          pecaIdDe: evento.pecaIdDe,
          pecaIdPara: evento.pecaIdPara,
          celula: evento.celula,
        });
        break;
      case 'peao_permaneceu':
        saida.push({
          type: 'PEAO_PERMANECEU',
          peaoId: evento.peaoId,
          pecaId: evento.pecaId,
        });
        break;
    }
  }
  return saida;
}
