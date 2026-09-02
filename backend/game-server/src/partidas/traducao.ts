// Tradução engine→wire dos eventos do canal de Partida (issue #117).
//
// O domínio (`@flicker/engine`) emite eventos em `snake_case`; o wire
// (`@flicker/shared`) os espera em `UPPER_SNAKE_CASE`. Campos em
// `camelCase` são idênticos nos dois lados. Cobre os eventos de tabuleiro/
// Peões (issues #80 e #88) e os do ciclo de Turnos do ST-11. A saída é
// `SalaServerMessage`, pois os eventos chegam pelo mesmo canal da partida.

import type { EventoDaPartida } from '@flicker/engine';
import type { SalaServerMessage } from '@flicker/shared';

export function traduzirEventos(
  eventos: readonly EventoDaPartida[],
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
      case 'peca_sorteada':
        saida.push({
          type: 'PECA_SORTEADA',
          pecaId: evento.pecaId,
          tipoDaPeca: evento.tipoDaPeca,
          orientacao: evento.orientacao,
        });
        break;
      case 'vaga_da_peca_recebida_escolhida':
        saida.push({
          type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
          recebidaId: evento.recebidaId,
          borda: evento.borda,
          celulaAlvo: evento.celulaAlvo,
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
      case 'turno_iniciado':
        saida.push({
          type: 'TURNO_INICIADO',
          jogadorId: evento.jogadorId,
          rodada: evento.rodada,
        });
        break;
      case 'turno_encerrado':
        saida.push({ type: 'TURNO_ENCERRADO', jogadorId: evento.jogadorId });
        break;
      case 'posicao_confirmada':
        saida.push({
          type: 'POSICAO_CONFIRMADA',
          jogadorId: evento.jogadorId,
          peaoId: evento.peaoId,
          pecaId: evento.pecaId,
        });
        break;
      case 'celulas_iluminadas':
        saida.push({ type: 'CELULAS_ILUMINADAS', celulas: evento.celulas });
        break;
      case 'limpeza_aplicada':
        saida.push({
          type: 'LIMPEZA_APLICADA',
          pecasRemovidas: evento.pecasRemovidas,
        });
        break;
      // Término (issues #176 e #179): broadcast com o Resultado (par
      // vitória/derrota — o motivo da derrota fica interno ao domínio); o
      // engine emite partida_terminada como último evento do lote da Ação.
      case 'partida_terminada':
        saida.push({ type: 'PARTIDA_TERMINADA', resultado: evento.desfecho.tipo });
        break;
      // Ataque dos Monstros (issue #172): shape 1:1 com o evento de domínio —
      // o refinamento do wire/feedback é da issue #173.
      case 'ataque_resolvido':
        saida.push({
          type: 'ATAQUE_RESOLVIDO',
          atacantes: evento.atacantes,
          peoesAtingidos: evento.peoesAtingidos,
          protegidos: evento.protegidos,
        });
        break;
      // Resgate (issue #171): shape 1:1 com o domínio — wire follow-up #173
      // pode refinar feedback, mas o broadcast já expõe o resgate.
      case 'resgate_realizado':
        saida.push({
          type: 'RESGATE_REALIZADO',
          pecaId: evento.pecaId,
          resgatadoJogadorId: evento.resgatadoJogadorId,
          resgatadorJogadorId: evento.resgatadorJogadorId,
          resgatadorPeaoId: evento.resgatadorPeaoId,
        });
        break;
      default: {
        const _exaustivo: never = evento;
        break;
      }
    }
  }
  return saida;
}