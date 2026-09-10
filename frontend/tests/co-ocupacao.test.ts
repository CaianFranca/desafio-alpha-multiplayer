import {
  CANTOS_DO_PORTAO,
  OFFSET_CANTO_X,
  OFFSET_CANTO_Z,
  layoutDoPeaoNaCelula,
} from '../web/src/game/tabuleiro/contrato'
import {
  atualizarOrdemDeChegada,
  criarEstadoInicialDoCliente,
  reduzirEvento,
} from '../web/src/game/tabuleiro/reducao'
import { aplicarSnapshot } from '../web/src/game/tabuleiro/snapshot'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'

// ── Helpers ──

/** Snapshot mínimo com peões co-ocupando o Portão (3:4) e a Inicial (3:3). */
function snapshotComPeoes(): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [
        { pecaId: 'portao-1', tipo: 'portao_de_saida', orientacao: 0, celula: { linha: 3, coluna: 4 } },
        { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
      ],
      iniciais: [],
      peoes: [
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'portao-1' },
        { peaoId: 'peao-azul', cor: 'azul', pecaId: 'portao-1' },
        { peaoId: 'peao-branco', cor: 'branco', pecaId: 'inicial-1' },
        // Sem peça → sobre a Mesa: não entra em fila nenhuma.
        { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
      ],
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 83,
    },
    jogadores: [
      { jogadorId: 'j-vermelho', apelido: 'Vermelho', cor: 'vermelho', ordem: 1, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'j-azul', apelido: 'Azul', cor: 'azul', ordem: 2, peaoId: 'peao-azul', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'j-branco', apelido: 'Branco', cor: 'branco', ordem: 3, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'j-amarelo', apelido: 'Amarelo', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ],
    jogadorAtivoId: 'j-branco',
    rodada: 2,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
  } as unknown as EstadoDaPartidaSnapshot
}

describe('arranjo visual de co-ocupação — seam puro (issue #298)', () => {
  it('Portão com 1 ocupante: fica no canto SE, não no centro', () => {
    const layout = layoutDoPeaoNaCelula('portao_de_saida', ['peao-branco'], 'peao-branco')
    expect(layout).toEqual({ dx: -OFFSET_CANTO_X, dz: -OFFSET_CANTO_Z })
    expect(CANTOS_DO_PORTAO[0]).toEqual([-OFFSET_CANTO_X, -OFFSET_CANTO_Z])
  })

  it('Portão com 4 ocupantes: cantos SE→SD→ID→IE na ordem da fila', () => {
    const fila = ['p1', 'p2', 'p3', 'p4']
    fila.forEach((peaoId, i) => {
      const layout = layoutDoPeaoNaCelula('portao_de_saida', fila, peaoId)
      expect([layout.dx, layout.dz]).toEqual(CANTOS_DO_PORTAO[i])
    })
  })

  it('Portão: peão fora da fila cai no centro (sem NaN)', () => {
    const layout = layoutDoPeaoNaCelula('portao_de_saida', ['p1'], 'peao-fora')
    expect(layout).toEqual({ dx: 0, dz: 0 })
    expect(Number.isNaN(layout.dx)).toBe(false)
    expect(Number.isNaN(layout.dz)).toBe(false)
  })

  it('Portão: 5º ocupante (teto 4 + resgate #171) ocupa o centro, sem sobrepor o IE', () => {
    const fila = ['p1', 'p2', 'p3', 'p4', 'p5']
    const layout = layoutDoPeaoNaCelula('portao_de_saida', fila, 'p5')
    expect(layout).toEqual({ dx: 0, dz: 0 })
    expect(Number.isNaN(layout.dx)).toBe(false)
    expect(Number.isNaN(layout.dz)).toBe(false)
  })

  it('Portão com 5 ocupantes: 5 posições distintas (4 cantos + centro)', () => {
    const fila = ['p1', 'p2', 'p3', 'p4', 'p5']
    const posicoes = fila.map((peaoId) => {
      const layout = layoutDoPeaoNaCelula('portao_de_saida', fila, peaoId)
      return `${layout.dx},${layout.dz}`
    })
    expect(new Set(posicoes).size).toBe(5)
  })

  it('peça comum (resgate #171): 1º ocupante no centro; 2º no canto SE', () => {
    const fila = ['p1', 'p2']
    expect(layoutDoPeaoNaCelula('inicial', fila, 'p1')).toEqual({ dx: 0, dz: 0 })
    expect(layoutDoPeaoNaCelula('inicial', fila, 'p2')).toEqual({
      dx: -OFFSET_CANTO_X,
      dz: -OFFSET_CANTO_Z,
    })
  })

  it('peça comum com 1 ocupante: centro; peão fora da fila: centro', () => {
    expect(layoutDoPeaoNaCelula('cruz', ['p1'], 'p1')).toEqual({ dx: 0, dz: 0 })
    expect(layoutDoPeaoNaCelula('cruz', ['p1'], 'peao-fora')).toEqual({ dx: 0, dz: 0 })
  })
})

describe('rastreamento da ordem de chegada no reducer (issue #298)', () => {
  it('estado inicial parte sem filas', () => {
    expect(criarEstadoInicialDoCliente().ordemDeChegadaPorChave).toEqual({})
  })

  it('PEAO_POSICIONADO anexa o peão ao fim da fila da célula', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
    expect(estado.ordemDeChegadaPorChave['3:3']).toEqual(['peao-branco'])
    // 2º posicionado na mesma peça entra DEPOIS (fica no canto SE do resgate).
    estado = reduzirEvento(estado, {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-vermelho',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
    expect(estado.ordemDeChegadaPorChave['3:3']).toEqual(['peao-branco', 'peao-vermelho'])
  })

  it('PEAO_MOVIDO remove da origem e anexa ao destino', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
    estado = reduzirEvento(estado, {
      type: 'PEAO_MOVIDO',
      peaoId: 'peao-branco',
      pecaIdDe: 'inicial-1',
      pecaIdPara: 'portao-1',
      celula: { linha: 3, coluna: 4 },
    })
    // Origem esvaziou → chave podada (limpeza #151); destino anexou no fim.
    expect(estado.ordemDeChegadaPorChave['3:3']).toBeUndefined()
    expect(estado.ordemDeChegadaPorChave['3:4']).toEqual(['peao-branco'])
  })

  it('nova célula null remove o peão sem anexar (defensivo — wire nunca envia)', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
    estado = {
      ...estado,
      ordemDeChegadaPorChave: atualizarOrdemDeChegada(estado, 'peao-branco', null),
    }
    expect(estado.ordemDeChegadaPorChave).toEqual({})
  })

  it('re-posicionamento na MESMA célula não duplica na fila (replay pós-snapshot)', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
    estado = reduzirEvento(estado, {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
    expect(estado.ordemDeChegadaPorChave['3:3']).toEqual(['peao-branco'])
  })
})

describe('snapshot reconstrói a fila de chegada (issue #298)', () => {
  it('aplicarSnapshot agrupa os peões por célula na ordem da lista do motor', () => {
    const estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshotComPeoes())
    // Ordem canônica do snapshot (limitação de reload): índice só define o
    // desempate visual — o Portão aqui tem vermelho no SE e azul no SD.
    expect(estado.ordemDeChegadaPorChave['3:4']).toEqual(['peao-vermelho', 'peao-azul'])
    expect(estado.ordemDeChegadaPorChave['3:3']).toEqual(['peao-branco'])
    // Peão sobre a Mesa não entra em fila.
    expect(Object.keys(estado.ordemDeChegadaPorChave).sort()).toEqual(['3:3', '3:4'])
  })

  it('LIMPEZA_APLICADA poda a fila da célula removida (sem chave órfã)', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_POSICIONADA',
      pecaId: 'inicial-1',
      orientacao: 0,
      celula: { linha: 3, coluna: 3 },
    } as never)
    estado = reduzirEvento(estado, {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    } as never)
    expect(estado.ordemDeChegadaPorChave['3:3']).toEqual(['peao-branco'])
    estado = reduzirEvento(estado, {
      type: 'LIMPEZA_APLICADA',
      pecasRemovidas: ['inicial-1'],
    } as never)
    expect(estado.posicionadas).toEqual([])
    expect(estado.ordemDeChegadaPorChave['3:3']).toBeUndefined()
    expect(estado.ordemDeChegadaPorChave).toEqual({})
  })

  it('LIMPEZA_APLICADA preserva a fila das células não removidas', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    } as never)
    estado = reduzirEvento(estado, {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-azul',
      pecaId: 'portao-1',
      celula: { linha: 3, coluna: 4 },
    } as never)
    estado = reduzirEvento(estado, {
      type: 'LIMPEZA_APLICADA',
      pecasRemovidas: ['outra-peca'],
    } as never)
    expect(estado.ordemDeChegadaPorChave['3:3']).toEqual(['peao-branco'])
    expect(estado.ordemDeChegadaPorChave['3:4']).toEqual(['peao-azul'])
  })
})