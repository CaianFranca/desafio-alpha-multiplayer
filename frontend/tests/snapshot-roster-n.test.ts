import { describe, expect, it } from 'vitest'
import { criarEstadoInicialDoCliente } from '../web/src/game/tabuleiro/reducao'
import { aplicarSnapshot } from '../web/src/game/tabuleiro/snapshot'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'

// Roster variável N=2..4 no snapshot (issue #284, história 4 da #281):
// o cliente exibe os peões dos jogadores (peaoId da ordem de entrada),
// nunca os N primeiros do array — com o servidor ainda em 4 e N=2, o
// slice por posição exibia cores erradas.

const PEOES_4 = [
  { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
  { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
  { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
  { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
] as const

function jogador(id: string, apelido: string, cor: 'branco' | 'vermelho' | 'azul' | 'amarelo', ordem: number) {
  return {
    jogadorId: id, apelido, cor, ordem, peaoId: `peao-${cor}`,
    primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false,
    amedrontado: false, protegido: false,
  }
}

function snapshotComJogadores(
  jogadores: EstadoDaPartidaSnapshot['jogadores'],
): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [],
      iniciais: [],
      peoes: [...PEOES_4],
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 83,
    },
    jogadores,
    jogadorAtivoId: jogadores[0]?.jogadorId ?? 'j1',
    rodada: 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
  } as unknown as EstadoDaPartidaSnapshot
}

describe('aplicarSnapshot com roster N=2..4 (#284)', () => {
  it('filtra os peões pelos peaoId dos jogadores, não por posição no array', () => {
    // Ordem de entrada: azul 1º, amarelo 2º — NÃO são os 2 primeiros canônicos.
    const snapshot = snapshotComJogadores([
      jogador('j1', 'Eu', 'azul', 1),
      jogador('j2', 'Outro', 'amarelo', 2),
    ])
    const estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshot)
    expect(estado.peoes.map((p) => p.peaoId)).toEqual(['peao-azul', 'peao-amarelo'])
  })

  it('sem jogadores no snapshot mantém a lista cheia (fallback defensivo)', () => {
    const estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshotComJogadores([]))
    expect(estado.peoes).toHaveLength(4)
  })
})
