import { describe, expect, it } from 'vitest'
import { criarEstadoInicialDoCliente } from '../web/src/game/tabuleiro/reducao'
import { aplicarSnapshot } from '../web/src/game/tabuleiro/snapshot'
import { jogador, snapshotComJogadores } from './helpers/rosterN'

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

const INICIAIS_4 = [
  { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0 },
  { pecaId: 'inicial-2', tipo: 'inicial', orientacao: 0 },
  { pecaId: 'inicial-3', tipo: 'inicial', orientacao: 0 },
  { pecaId: 'inicial-4', tipo: 'inicial', orientacao: 0 },
] as const

/**
 * União do merge feat/random-walk × origin/main: o campo foi renomeado
 * `quantidadeDeJogadores` → `quantidadeParaLayout`. Lê ambos para cobrir
 * as duas pontas até a fonte convergir. `??` não serve: `quantidadeParaLayout`
 * é `number | null` (reducao.ts:223) e `null ?? x` cairia no campo antigo —
 * presente só quando presente.
 */
function quantidadeDeLayout(estado: unknown): unknown {
  const e = estado as unknown as {
    quantidadeParaLayout?: unknown
    quantidadeDeJogadores?: unknown
  }
  return e.quantidadeParaLayout !== undefined
    ? e.quantidadeParaLayout
    : e.quantidadeDeJogadores
}

describe('aplicarSnapshot com roster N=2..4 (#284)', () => {
  it('filtra os peões pelos peaoId dos jogadores, não por posição no array', () => {
    // Ordem de entrada: azul 1º, amarelo 2º — NÃO são os 2 primeiros canônicos.
    // O tabuleiro ainda carrega os 4 (servidor pré-fiação #283).
    const snapshot = snapshotComJogadores(
      [
        jogador('j1', 'Eu', 'azul', 1),
        jogador('j2', 'Outro', 'amarelo', 2),
      ],
      [...PEOES_4],
    )
    const estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshot)
    expect(estado.peoes.map((p) => p.peaoId)).toEqual(['peao-azul', 'peao-amarelo'])
  })

  it('projeta só as N iniciais do roster, sem fantasmas do ausente', () => {
    const snapshot = snapshotComJogadores(
      [
        jogador('j1', 'Eu', 'azul', 1),
        jogador('j2', 'Outro', 'amarelo', 2),
      ],
      [...PEOES_4],
    )
    const comIniciais = {
      ...snapshot,
      tabuleiro: {
        ...snapshot.tabuleiro,
        iniciais: [...INICIAIS_4] as unknown as typeof snapshot.tabuleiro.iniciais,
      },
    }
    const estado = aplicarSnapshot(criarEstadoInicialDoCliente(), comIniciais)
    expect(estado.iniciais.map((p) => p.pecaId)).toEqual(['inicial-1', 'inicial-2'])
  })

  it('sem jogadores no snapshot projeta mesa vazia (sem fantasmas)', () => {
    const estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshotComJogadores([], [...PEOES_4]))
    expect(estado.peoes).toHaveLength(0)
    expect(estado.iniciais).toHaveLength(0)
    expect(quantidadeDeLayout(estado)).toBeNull()
  })

  it('roster fora da faixa não inventa fantasmas: N cru é exibido, layout usa clamp', () => {
    const snapshot = snapshotComJogadores(
      [jogador('j1', 'Eu', 'branco', 1)],
      [...PEOES_4],
    )
    const estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshot)
    // Só o peão real aparece (sem os 3 fantasmas); o N de layout/teto vai
    // ao clamp 2..4 enquanto o anúncio deriva o N real do roster.
    expect(estado.peoes.map((p) => p.peaoId)).toEqual(['peao-branco'])
    expect(quantidadeDeLayout(estado)).toBe(2)
  })
})
