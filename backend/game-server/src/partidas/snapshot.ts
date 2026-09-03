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
        // Estados dos Monstros no snapshot (issue #173), com normalização
        // defensiva no mesmo padrão dos estados persistidos por binário
        // anterior: sanidade ausente ≡ 3 (inicial), estados ausentes ≡
        // falsos — e Amedrontado derivado do valor NORMALIZADO de sanidade.
        sanidade: jogador.sanidade ?? 3,
        emBaixaIluminacao: jogador.emBaixaIluminacao ?? false,
        amedrontado: jogador.amedrontado ?? (jogador.sanidade ?? 3) === 0,
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
      pecaId: recebida.pecaId,
      tipo: recebida.tipo,
      orientacao: recebida.orientacao,
      vaga: recebida.vaga,
      celulaAlvo: recebida.celulaAlvo
        ? copiarCelula(recebida.celulaAlvo)
        : null,
    })),
    pecaSelecionadaId: estado.tabuleiro.pecaSelecionadaId,
    pecaEmManipulacaoId: estado.tabuleiro.pecaEmManipulacaoId,
    peaoSelecionadoId: estado.tabuleiro.peaoSelecionadoId,
  } as const;

  // Normalização defensiva: estados persistidos por binário anterior à #176
  // podem não ter o campo `resultado` no JSON — `?? null` evita tratá-lo como
  // término.
  const desfecho = estado.resultado ?? null;

  return {
    tabuleiro,
    jogadores,
    jogadorAtivoId: estado.jogadorAtivoId,
    rodada: estado.rodada,
    pecaDoInicioDoTurnoId: estado.pecaDoInicioDoTurnoId,
    posicaoConfirmada: estado.posicaoConfirmada,
    celulasIluminadas: estado.celulasIluminadas.map(copiarCelula),
    // Término (issue #179): o Resultado no estado do engine é a própria
    // condição "terminada" — o snapshot o reflete para que quem se conecta
    // (recarregamento) volte a ver o resultado, independente do estado da
    // partida persistida reportado pela transição de presença. O wire
    // transporta apenas o par vitória/derrota — o motivo da derrota fica
    // interno ao domínio.
    estado: desfecho !== null ? 'terminada' : estadoWire,
    resultado: desfecho === null ? null : desfecho.tipo,
  };
}
