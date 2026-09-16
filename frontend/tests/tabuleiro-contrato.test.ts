import {
  LADO_DA_GRADE,
  TAMANHO_CELULA,
  LARGURA_TABULEIRO,
  PROFUNDIDADE_TABULEIRO,
  ALTURA_TABULEIRO,
  ALTURA_ZONA_CAIXA,
  POSICAO_TABULEIRO,
  POSICAO_CAIXA,
  POSICAO_BANDEJA,
  POSICAO_INICIAIS,
  OFFSET_CAIXA_X,
  CAIXA_LARGURA,
  CAIXA_PROFUNDIDADE,
  CAIXA_ALTURA,
  COLUNAS_INICIAIS,
  QUANTIDADE_INICIAIS,
  ESPACAMENTO_ENTRE_PECAS_MESA,
  abreJanelaDeManipulacao,
  criarIniciaisDaMesa,
  bordasAbertas,
  celulaParaMundo,
  mundoParaCelula,
  inicialIndiceParaMundo,
  inicialIndiceParaLocal,
  todasAsCelulas,
  validarDimensoes,
  PILHA_DA_CAIXA,
  validarPilhaDaCaixa,
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
    expect(ALTURA_ZONA_CAIXA).toBeGreaterThan(0)
    expect(ALTURA_TABULEIRO).toBeLessThan(0.1)
  })

  it('posições sobre a Mesa: tabuleiro central, zona da Caixa lateral +X de trás para frente (issue #143)', () => {
    expect(POSICAO_TABULEIRO).toEqual([0, ALTURA_TABULEIRO, 0])
    expect(POSICAO_CAIXA[0]).toBe(OFFSET_CAIXA_X)
    expect(POSICAO_CAIXA[0]).toBeGreaterThan(LARGURA_TABULEIRO / 2)
    // Ordem da zona +X, de trás (−z) para frente (+z): Caixa → bandeja → iniciais.
    expect(POSICAO_CAIXA[2]).toBeLessThan(POSICAO_BANDEJA[2])
    expect(POSICAO_BANDEJA[2]).toBeLessThan(POSICAO_INICIAIS[2])
    // Caixa: bloco opaco com dimensões positivas.
    expect(CAIXA_LARGURA).toBeGreaterThan(0)
    expect(CAIXA_PROFUNDIDADE).toBeGreaterThan(0)
    expect(CAIXA_ALTURA).toBeGreaterThan(0)
    // Zona ainda sobre a Mesa (não extrapola além da borda com margem):
    // o limite em x é a própria Caixa (a mais larga da zona em x).
    const maxXCaixa = POSICAO_CAIXA[0] + CAIXA_LARGURA / 2
    expect(maxXCaixa).toBeLessThan(LARGURA_MESA / 2 + 1)
    // em z, a frente da grade 2×2 de iniciais é o ponto mais distante.
    const linhasIniciais = Math.ceil(QUANTIDADE_INICIAIS / COLUNAS_INICIAIS)
    const maxZIniciais =
      POSICAO_INICIAIS[2] + ((linhasIniciais - 1) / 2) * ESPACAMENTO_ENTRE_PECAS_MESA + TAMANHO_CELULA / 2
    const minZCaixa = POSICAO_CAIXA[2] - CAIXA_PROFUNDIDADE / 2
    expect(Math.max(maxZIniciais, Math.abs(minZCaixa))).toBeLessThan(LARGURA_MESA / 2 + 1)
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

  it('iniciais da mesa: 4 peças com os mesmos ids do engine, orientação 0 (issue #143)', () => {
    const iniciais = criarIniciaisDaMesa()
    expect(iniciais).toHaveLength(QUANTIDADE_INICIAIS)
    expect(iniciais.map((p) => p.pecaId)).toEqual(['inicial-1', 'inicial-2', 'inicial-3', 'inicial-4'])
    expect(iniciais.every((p) => p.tipo === 'inicial')).toBe(true)
    expect(iniciais.every((p) => p.orientacao === 0)).toBe(true)
  })

  it('estado mock exibe 4 iniciais na mesa e caminho basico de 5 pecas encaixadas sem fisica', () => {
    const mock = criarEstadoExibicaoMock()
    expect(mock.iniciais).toHaveLength(4)
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
    // Monstros (#143/#169): 4 bordas abertas em qualquer orientação (engine).
    expect(bordasAbertas({ tipo: 'vulto', orientacao: 0 })).toEqual(['norte', 'leste', 'sul', 'oeste'])
    expect(bordasAbertas({ tipo: 'espectro', orientacao: 90 })).toEqual(['norte', 'leste', 'sul', 'oeste'])
  })

  it('inicialIndiceParaMundo distribui as 4 iniciais em grade 2×2 sem colisão', () => {
    const posicoes = Array.from({ length: QUANTIDADE_INICIAIS }, (_, i) => inicialIndiceParaMundo(i))
    // todos têm mesma altura
    expect(posicoes.every(([, y]) => y === ALTURA_ZONA_CAIXA)).toBe(true)
    // todos distintos
    expect(new Set(posicoes.map((p) => p.join(','))).size).toBe(QUANTIDADE_INICIAIS)
    // consistência local→mundo
    const [lx, , lz] = inicialIndiceParaLocal(0)
    const [mx, my, mz] = inicialIndiceParaMundo(0)
    expect(mx).toBeCloseTo(POSICAO_INICIAIS[0] + lx)
    expect(my).toBe(ALTURA_ZONA_CAIXA)
    expect(mz).toBeCloseTo(POSICAO_INICIAIS[2] + lz)
  })

  it('abreJanelaDeManipulacao: caminho/inicial sim, especiais e monstros não (revisão #199)', () => {
    // Espelha engine peoes.ts:622-630/683-689 (posicionarRecebida): só peças
    // de caminho (e a Inicial, encaixe direto na mesa) têm janela.
    expect(abreJanelaDeManipulacao('inicial')).toBe(true)
    for (const tipo of ['reta', 'T', 'cruz'] as const) {
      expect(abreJanelaDeManipulacao(tipo)).toBe(true)
    }
    for (const tipo of [
      'gerador',
      'sala_do_diretor',
      'sala_medica',
      'portao_de_saida',
      'vulto',
      'espectro',
    ] as const) {
      expect(abreJanelaDeManipulacao(tipo)).toBe(false)
    }
  })

  it('pilha da Caixa: 4 peças de caminho com pose manual válida', () => {
    expect(validarPilhaDaCaixa()).toBeNull()
    expect(PILHA_DA_CAIXA).toHaveLength(4)
    // Só caminho (nunca Inicial/especial/monstro), cada qual com posição
    // dentro da caixa e inclinação válida.
    for (const peca of PILHA_DA_CAIXA) {
      expect(['reta', 'T', 'cruz']).toContain(peca.tipo)
      const [x, y, z] = peca.posicao
      expect(Math.abs(x)).toBeLessThanOrEqual(2.2)
      expect(Math.abs(z)).toBeLessThanOrEqual(1.2)
      expect(y).toBeGreaterThanOrEqual(0)
      const [rx, rz] = peca.inclinacao
      expect(Number.isFinite(rx)).toBe(true)
      expect(Number.isFinite(rz)).toBe(true)
    }
  })
})
