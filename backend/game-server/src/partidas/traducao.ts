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
      case 'peao_desselecionado':
        saida.push({ type: 'PEAO_DESELECIONADO', peaoId: evento.peaoId });
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
      // Travessia do Escuro (issue #264): shape 1:1 com o domínio — o Peão
      // alcançou a célula escura conectada; o Recebimento gerado chega pelos
      // eventos PECA_SORTEADA/RECEBIMENTO_GERADO do mesmo lote.
      case 'atravessou_o_escuro':
        saida.push({
          type: 'ATRAVESSOU_O_ESCURO',
          peaoId: evento.peaoId,
          celula: evento.celula,
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
          // Proteção RESULTANTE do ator no gatilho (issue #227): a concessão
          // da Sala Médica e o consumo pelo ataque do MESMO gatilho já estão
          // resolvidos no domínio — o wire só transporta o estado final.
          // `?? false` no padrão de snapshot.ts:44: binário do engine anterior
          // à #227 durante rolling deploy não carrega o campo no payload.
          protegido: evento.protegido ?? false,
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
      // Término (issues #176 e #179): broadcast com o Resultado; o motivo da
      // derrota viaja em campo opcional (issue #145-exp — sync
      // DesfechoDaPartida, engine/src/partida.ts:158-165; 'desistencia' pela
      // issue #288). A vitória não tem motivo no domínio — a chave `motivo`
      // só aparece nas derrotas. O engine emite partida_terminada como último
      // evento do lote da Ação.
      case 'partida_terminada': {
        const desfecho = evento.desfecho;
        saida.push(
          desfecho.tipo === 'derrota'
            ? {
                type: 'PARTIDA_TERMINADA',
                resultado: desfecho.tipo,
                motivo: desfecho.motivo,
              }
            : { type: 'PARTIDA_TERMINADA', resultado: desfecho.tipo },
        );
        break;
      }
      // Ataque dos Monstros (issues #172/#173): shape 1:1 com o evento de
      // domínio — estadosAplicados carrega o estado resultante das
      // penalidades por Jogador mudado (eco do feedback da #173).
      // Semântica centrada no atuante (ADR-0008, issues #237/#236): o gatilho
      // é a decisão definitiva do Jogador Ativo (Confirmação de Posição com
      // troca de Peça, Permanência e posicionamento do Peão no Primeiro
      // Turno); fora→fora é silêncio — o lote nem emite o evento — e
      // `atacantes` traz SÓ os Monstros envolvidos, nunca o roster inteiro.
      case 'ataque_resolvido':
        saida.push({
          type: 'ATAQUE_RESOLVIDO',
          atacantes: evento.atacantes,
          peoesAtingidos: evento.peoesAtingidos,
          protegidos: evento.protegidos,
          estadosAplicados: evento.estadosAplicados,
        });
        break;
      // Desistência (issue #288): shape 1:1 com o domínio — abre o lote do
      // comando e serve de aviso aos restantes (nova ordem via TURNO_INICIADO
      // e tabuleiro via CELULAS_ILUMINADAS/LIMPEZA_APLICADA do mesmo lote).
      case 'desistencia_registrada':
        saida.push({
          type: 'DESISTENCIA_REGISTRADA',
          jogadorId: evento.jogadorId,
          peaoId: evento.peaoId,
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