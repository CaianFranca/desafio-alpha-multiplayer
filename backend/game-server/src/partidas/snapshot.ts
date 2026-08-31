// Tradução do EstadoDaPartida do @flicker/engine para o snapshot wire de @flicker/shared (ST-14).
//
// Projeção tipada sem runtime: mapeia EstadoDaPartida (engine) + roster MembroDaSala (apelido)
// para EstadoDaPartidaSnapshot wire (shared). Sem validação, apenas cópia de campos.
// Fronteira shared vs engine — sync manual, UPPER_SNAKE no wire vs snake no domínio, camelCase nos campos.

import type { EstadoDaPartida } from '@flicker/engine';
import type { Celula } from '@flicker/shared';
import type { EstadoDaPartidaSnapshot, EstadoDaPartidaWire } from '@flicker/shared';
import type { MembroDaSala } from '@flicker/shared';

function copiarCelula(celula: { linha: number; coluna: number }): Celula {
  return { linha: celula.linha, coluna: celula.coluna };
}

export function paraSnapshotWire(
  estado: EstadoDaPartida,
  roster: readonly MembroDaSala[],
  estadoWire: EstadoDaPartidaWire,
): EstadoDaPartidaSnapshot {
  const rosterPorJogadorId = new Map(roster.map((m) => [m.jogadorId, m] as const));

  const jogadores = [...estado.jogadores]
    .sort((a, b) => a.ordem - b.ordem)
    .map((jogador) => {
      const membro = rosterPorJogadorId.get(jogador.jogadorId);
      if (membro === undefined) {
        throw new Error(`roster inconsistente: jogador ${jogador.jogadorId} não encontrado`);
      }
      return {
        jogadorId: jogador.jogadorId,
        apelido: membro.apelido,
        cor: jogador.cor,
        ordem: jogador.ordem,
        peaoId: jogador.peaoId,
        primeiroTurnoPendente: jogador.primeiroTurnoPendente,
      } as const;
    });

  const tabuleiro = {
    posicionadas: estado.tabuleiro.posicionadas.map((peca) => ({
      pecaId: peca.pecaId,
      tipo: peca.tipo,
      orientacao: peca.orientacao,
      celula: copiarCelula(peca.celula),
    })),
    iniciais: estado.tabuleiro.iniciais.map((peca) => ({
      pecaId: peca.pecaId,
      tipo: peca.tipo,
      orientacao: peca.orientacao,
    })),
    peoes: estado.tabuleiro.peoes.map((peao) => ({
      peaoId: peao.peaoId,
      cor: peao.cor,
      pecaId: peao.pecaId,
    })),
    recebidas: estado.tabuleiro.recebidas.map((recebida) => ({
      recebidaId: recebida.recebidaId,
      bordaGeradora: recebida.bordaGeradora,
      celulaAlvo: copiarCelula(recebida.celulaAlvo),
      pecaId: recebida.pecaId,
      tipo: recebida.tipo,
      orientacao: recebida.orientacao,
    })),
    pecaSelecionadaId: estado.tabuleiro.pecaSelecionadaId,
    pecaEmManipulacaoId: estado.tabuleiro.pecaEmManipulacaoId,
    peaoSelecionadoId: estado.tabuleiro.peaoSelecionadoId,
  } as const;

  return {
    tabuleiro,
    jogadores,
    jogadorAtivoId: estado.jogadorAtivoId,
    rodada: estado.rodada,
    pecaDoInicioDoTurnoId: estado.pecaDoInicioDoTurnoId,
    posicaoConfirmada: estado.posicaoConfirmada,
    celulasIluminadas: estado.celulasIluminadas.map(copiarCelula),
    estado: estadoWire,
  };
}
