import {
  LADO_DA_GRADE,
  TAMANHO_CELULA,
  LARGURA_TABULEIRO,
  PROFUNDIDADE_TABULEIRO,
  ALTURA_TABULEIRO,
  ALTURA_RESERVA,
  POSICAO_TABULEIRO,
  POSICAO_RESERVA,
  OFFSET_RESERVA_X,
  COLUNAS_RESERVA,
  ESPACAMENTO_RESERVA,
  criarReservaInicial,
  bordasAbertas,
  celulaParaMundo,
  mundoParaCelula,
  reservaIndiceParaMundo,
  reservaIndiceParaLocal,
  todasAsCelulas,
  validarDimensoes,
} from '../web/src/game/tabuleiro/contrato'
import { LARGURA_MESA } from '../web/src/game/ambiente/contrato'
import { criarEstadoExibicaoMock } from './helpers/mockExibicao'

describe('contrato do tabuleiro', () => {
  it('grade fixa 7x7 conforme ADR-0004', () => {
    expect(LADO_DA_GRADE).toBe(7)
    expect(todasAsCelulas()).toHaveLength(49)
    expect(new Set(todasAsCelulas().map((c) => `${c.linha}:${c.coluna}`)).size).toBe(49)
  })

  it('dimensões do tabuleiro menores que a Mesa (sem z-fighting)', () => {
    expect(TAMANHO_CELULA).toBeGreaterThan(0)
    expect(LARGURA_TABULEIRO).toBe(LADO_DA_GRADE * TAMANHO_CELULA)
    expect(PROFUNDIDADE_TABULEIRO).toBe(LADO_DA_GRADE * TAMANHO_CELULA)
    expect(LARGURA_TABULEIRO).toBeLessThan(LARGURA_MESA)
    expect(PROFUNDIDADE_TABULEIRO).toBeLessThan(LARGURA_MESA)
    expect(validarDimensoes()).toBeNull()
    expect(ALTURA_TABULEIRO).toBeGreaterThan(0)
    expect(ALTURA_RESERVA).toBeGreaterThan(0)
    expect(ALTURA_TABULEIRO).toBeLessThan(0.1)
  })

  it('posições sobre a Mesa: tabuleiro centralizado, reserva lateral +X', () => {
    expect(POSICAO_TABULEIRO).toEqual([0, ALTURA_TABULEIRO, 0])
    expect(POSICAO_RESERVA[0]).toBe(OFFSET_RESERVA_X)
    expect(POSICAO_RESERVA[0]).toBeGreaterThan(LARGURA_TABULEIRO / 2)
    // Reserva ainda sobre a Mesa (não extrapola além da borda com margem)
    const maxXReserva = POSICAO_RESERVA[0] + (COLUNAS_RESERVA * ESPACAMENTO_RESERVA) / 2
    expect(maxXReserva).toBeLessThan(LARGURA_MESA / 2 + 1)
  })

  it('celulaParaMundo mapeia centro 3:3 para origem e cantos simetricamente', () => {
    expect(celulaParaMundo({ linha: 3, coluna: 3 })).toEqual([0, ALTURA_TABULEIRO, 0])
    const nw = celulaParaMundo({ linha: 0, coluna: 0 })
    const se = celulaParaMundo({ linha: 6, coluna: 6 })
    expect(nw[0]).toBe(-se[0])
    expect(nw[2]).toBe(-se[2])
    expect(nw[1]).toBe(ALTURA_TABULEIRO)
  })

  it('mundoParaCelula inverte celulaParaMundo e retorna null fora da grade', () => {
    for (const cel of todasAsCelulas()) {
      const [x, , z] = celulaParaMundo(cel)
      expect(mundoParaCelula(x, z)).toEqual(cel)
    }
    expect(mundoParaCelula(999, 999)).toBeNull()
    expect(mundoParaCelula(-999, -999)).toBeNull()
    // ponto exatamente entre duas células arredonda para a mais próxima
    const meio = celulaParaMundo({ linha: 3, coluna: 3 })
    expect(mundoParaCelula(meio[0] + TAMANHO_CELULA * 0.49, meio[2])).toEqual({ linha: 3, coluna: 3 })
  })

  it('reserva inicial contém 4 iniciais + 6 de cada caminho (22 peças)', () => {
    const reserva = criarReservaInicial()
    expect(reserva).toHaveLength(22)
    expect(reserva.filter((p) => p.tipo === 'inicial')).toHaveLength(4)
    expect(reserva.filter((p) => p.tipo === 'reta')).toHaveLength(6)
    expect(reserva.filter((p) => p.tipo === 'T')).toHaveLength(6)
    expect(reserva.filter((p) => p.tipo === 'cruz')).toHaveLength(6)
    expect(reserva.every((p) => p.orientacao === 0)).toBe(true)
  })

  it('estado mock exibe reserva completa e caminho basico de 5 pecas encaixadas sem fisica', () => {
    const mock = criarEstadoExibicaoMock()
    expect(mock.reserva).toHaveLength(22)
    expect(mock.posicionadas).toHaveLength(5)
    // Contrato #151: o mock DEV nasce sem iluminação (o estado compartilhado é
    // espelhado apenas pelo reducer com alvo de conexão).
    expect(mock.celulasIluminadas).toEqual([])
    expect(mock.posicionadas[0]).toMatchObject({ celula: { linha: 3, coluna: 3 }, tipo: 'inicial', orientacao: 0 })
    expect(mock.posicionadas[1]).toMatchObject({ celula: { linha: 3, coluna: 4 }, tipo: 'reta', orientacao: 90 })
    expect(mock.posicionadas[2]).toMatchObject({ celula: { linha: 3, coluna: 5 }, tipo: 'cruz', orientacao: 0 })
    expect(mock.posicionadas[3]).toMatchObject({ celula: { linha: 4, coluna: 5 }, tipo: 'reta', orientacao: 0 })
    expect(mock.posicionadas[4]).toMatchObject({ celula: { linha: 2, coluna: 5 }, tipo: 'T', orientacao: 180 })
  })

  it('bordas abertas por tipo e orientação (placeholder BoxGeometry)', () => {
    expect(bordasAbertas({ tipo: 'inicial', orientacao: 0 })).toEqual(['norte', 'leste'])
    expect(bordasAbertas({ tipo: 'inicial', orientacao: 90 })).toEqual(['leste', 'sul'])
    expect(bordasAbertas({ tipo: 'reta', orientacao: 0 })).toEqual(['norte', 'sul'])
    expect(bordasAbertas({ tipo: 'reta', orientacao: 90 })).toEqual(['leste', 'oeste'])
    expect(bordasAbertas({ tipo: 'T', orientacao: 0 })).toEqual(['norte', 'leste', 'oeste'])
    expect(bordasAbertas({ tipo: 'cruz', orientacao: 0 })).toEqual(['norte', 'leste', 'sul', 'oeste'])
    expect(bordasAbertas({ tipo: 'cruz', orientacao: 180 })).toEqual(['norte', 'leste', 'sul', 'oeste'])
  })

  it('reservaIndiceParaMundo distribui 22 placeholders em grade lateral sem colisão', () => {
    const posicoes = Array.from({ length: 22 }, (_, i) => reservaIndiceParaMundo(i))
    // todos têm mesma altura
    expect(posicoes.every(([, y]) => y === ALTURA_RESERVA)).toBe(true)
    // todos distintos
    expect(new Set(posicoes.map((p) => p.join(','))).size).toBe(22)
    // consistência local→mundo
    const [lx, , lz] = reservaIndiceParaLocal(0)
    const [mx, my, mz] = reservaIndiceParaMundo(0)
    expect(mx).toBeCloseTo(POSICAO_RESERVA[0] + lx)
    expect(my).toBe(ALTURA_RESERVA)
    expect(mz).toBeCloseTo(POSICAO_RESERVA[2] + lz)
  })
})
