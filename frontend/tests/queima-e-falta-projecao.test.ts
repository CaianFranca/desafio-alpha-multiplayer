import { describe, expect, it } from 'vitest'
import {
  criarEstadoInicialDoCliente,
  reduzirEvento,
  reduzirEventos,
  type EstadoDoTabuleiroNoCliente,
} from '../web/src/game/tabuleiro/reducao'

// Projeção da falta/queima do relógio no cliente (issue #429, spec #405).
//
// O lote do estouro viaja com FALTA_REGISTRADA abrindo e PECAS_QUEIMADAS
// informando a queima (espelho 1:1 do engine via traducao.ts). Sem projeção,
// o cliente mantém peças fantasmas na Bandeja/pendências e todo comando
// seguinte é recusado (soft block) — em especial nos caminhos com turno
// mantido, onde nenhum TURNO_INICIADO futuro reseta o modelo.

function estadoComPendencias(): EstadoDoTabuleiroNoCliente {
  return {
    ...criarEstadoInicialDoCliente(2),
    recebidasPendentes: [
      { recebidaId: 'r1', pecaId: 'reta-1', tipoDaPeca: 'reta', vaga: null, celulaAlvo: null, orientacao: 0 },
      { recebidaId: 'r2', pecaId: 'cruz-2', tipoDaPeca: 'cruz', vaga: null, celulaAlvo: null, orientacao: 0 },
    ],
    pecasDeRecebimento: { 'reta-1': 'reta', 'cruz-2': 'cruz' },
    pecaSelecionadaId: 'reta-1',
    posicionadas: [
      { pecaId: 'vulto-1', tipo: 'vulto', orientacao: 0, celula: { linha: 3, coluna: 3 } },
    ],
    pecasRestantesNaCaixa: 80,
  }
}

describe('projeção da queima do relógio — PECAS_QUEIMADAS (issue #429)', () => {
  it('remove as queimadas das pendentes, do recebimento e da seleção; mantém as demais', () => {
    const estado = reduzirEvento(estadoComPendencias(), {
      type: 'PECAS_QUEIMADAS',
      pecaIds: ['reta-1'],
    })

    expect(estado.recebidasPendentes.map((r) => r.pecaId)).toEqual(['cruz-2'])
    expect(estado.pecasDeRecebimento).toEqual({ 'cruz-2': 'cruz' })
    expect(estado.pecaSelecionadaId).toBeNull()
    // Posicionadas intactas (a queimada não estava no tabuleiro).
    expect(estado.posicionadas.map((p) => p.pecaId)).toEqual(['vulto-1'])
  })

  it('seleção de peça fora da queima sobrevive', () => {
    const estado = reduzirEvento(
      { ...estadoComPendencias(), pecaSelecionadaId: 'cruz-2' },
      { type: 'PECAS_QUEIMADAS', pecaIds: ['reta-1'] },
    )
    expect(estado.pecaSelecionadaId).toBe('cruz-2')
  })

  it('remove a aposta posicionada da Travessia do tabuleiro', () => {
    const estado = reduzirEvento(estadoComPendencias(), {
      type: 'PECAS_QUEIMADAS',
      pecaIds: ['vulto-1'],
    })
    expect(estado.posicionadas).toEqual([])
    // Pendências intactas (a aposta não era recebida).
    expect(estado.recebidasPendentes.map((r) => r.pecaId)).toEqual(['reta-1', 'cruz-2'])
  })

  it('ids desconhecidos não quebram nem alteram o modelo', () => {
    const base = estadoComPendencias()
    const estado = reduzirEvento(base, {
      type: 'PECAS_QUEIMADAS',
      pecaIds: ['fantasma-9'],
    })
    expect(estado.recebidasPendentes).toEqual(base.recebidasPendentes)
    expect(estado.posicionadas).toEqual(base.posicionadas)
    expect(estado.pecaSelecionadaId).toBe('reta-1')
  })

  it('lote vazio é no-op (mesma referência)', () => {
    const base = estadoComPendencias()
    expect(reduzirEvento(base, { type: 'PECAS_QUEIMADAS', pecaIds: [] })).toBe(base)
  })

  it('não toca na contagem da Caixa (queima não devolve — o Sorteio já descontou)', () => {
    const estado = reduzirEvento(estadoComPendencias(), {
      type: 'PECAS_QUEIMADAS',
      pecaIds: ['reta-1', 'cruz-2'],
    })
    expect(estado.pecasRestantesNaCaixa).toBe(80)
  })
})

describe('projeção da falta do relógio — FALTA_REGISTRADA (issue #429)', () => {
  it('sem projeção de estado (faltas vivem no servidor; o HUD não as exibe)', () => {
    const base = estadoComPendencias()
    expect(
      reduzirEvento(base, { type: 'FALTA_REGISTRADA', jogadorId: 'j1', totalDeFaltas: 1 }),
    ).toBe(base)
  })
})

describe('lote do estouro com avanço — sem fantasmas no turno seguinte (issue #429)', () => {
  it('FALTA + QUEIMA + TURNO_ENCERRADO + TURNO_INICIADO zeram as pendências e passam a vez', () => {
    const queimado = reduzirEventos(estadoComPendencias(), [
      { type: 'FALTA_REGISTRADA', jogadorId: 'j1', totalDeFaltas: 2 },
      { type: 'PECAS_QUEIMADAS', pecaIds: ['reta-1', 'cruz-2'] },
      { type: 'TURNO_ENCERRADO', jogadorId: 'j1' },
      { type: 'TURNO_INICIADO', jogadorId: 'j2', rodada: 3 },
    ])
    expect(queimado.recebidasPendentes).toEqual([])
    expect(queimado.pecasDeRecebimento).toEqual({})
    expect(queimado.pecaSelecionadaId).toBeNull()
    expect(queimado.jogadorAtivoId).toBe('j2')
    expect(queimado.rodada).toBe(3)
  })
})

describe('lote do estouro com recuo — peão volta sem reload (soft block do recuo mudo)', () => {
  it('FALTA + QUEIMA + recuo + permanência + virada deixam o peão na origem', () => {
    const base: EstadoDoTabuleiroNoCliente = {
      ...criarEstadoInicialDoCliente(2),
      jogadorAtivoId: 'j1',
      rodada: 2,
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', celula: { linha: 3, coluna: 4 } },
        { peaoId: 'peao-vermelho', cor: 'vermelho', celula: null },
      ],
      recebidasPendentes: [
        { recebidaId: 'r1', pecaId: 'reta-1', tipoDaPeca: 'reta', vaga: null, celulaAlvo: null, orientacao: 0 },
      ],
      pecasDeRecebimento: { 'reta-1': 'reta' },
    };
    const final = reduzirEventos(base, [
      { type: 'FALTA_REGISTRADA', jogadorId: 'j1', totalDeFaltas: 1 },
      { type: 'PECAS_QUEIMADAS', pecaIds: ['reta-1'] },
      {
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'reta-9',
        pecaIdPara: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
      },
      { type: 'PEAO_PERMANECEU', peaoId: 'peao-branco', pecaId: 'inicial-1' },
      { type: 'TURNO_ENCERRADO', jogadorId: 'j1' },
      { type: 'TURNO_INICIADO', jogadorId: 'j2', rodada: 2 },
    ])
    // Sem o recuo no lote, o peão seguiria em (3,4) até o reload.
    const peao = final.peoes.find((p) => p.peaoId === 'peao-branco')
    expect(peao?.celula).toEqual({ linha: 3, coluna: 3 })
    expect(final.recebidasPendentes).toEqual([])
    expect(final.jogadorAtivoId).toBe('j2')
  })
})
