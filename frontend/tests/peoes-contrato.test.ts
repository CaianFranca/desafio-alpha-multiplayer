import {
  CORES_DOS_PEOES,
  HEX_COR_PEAO,
  LADO_DA_GRADE,
  PEAO_Y,
  QUANTIDADE_PEOES,
  destinosConectadosDoPeao,
  encontrarPecaNaCelula,
  estaDentroDaGrade,
  peaoMesaParaMundo,
  selecionarPeaoNaExibicao,
  vizinhasConectadas,
} from '../web/src/game/tabuleiro/contrato'
import type {
  EstadoExibicaoTabuleiro,
  PecaPosicionada,
} from '../web/src/game/tabuleiro/contrato'
import { LARGURA_MESA } from '../web/src/game/ambiente/contrato'
import { criarEstadoExibicaoMock } from './helpers/mockExibicao'

// ── Helpers ──

function peca(
  pecaId: string,
  tipo: PecaPosicionada['tipo'],
  orientacao: PecaPosicionada['orientacao'],
  linha: number,
  coluna: number,
): PecaPosicionada {
  return { pecaId, tipo, orientacao, celula: { linha, coluna } }
}

function comPeoes(
  posicionadas: readonly PecaPosicionada[],
  peoes: EstadoExibicaoTabuleiro['peoes'],
): Pick<EstadoExibicaoTabuleiro, 'posicionadas' | 'peoes'> {
  return { posicionadas, peoes }
}

describe('peões no contrato de exibição (issue #90)', () => {
  it('cores canônicas espelham o engine e têm hex distintas', () => {
    expect(CORES_DOS_PEOES).toEqual(['branco', 'vermelho', 'azul', 'amarelo'])
    expect(QUANTIDADE_PEOES).toBe(CORES_DOS_PEOES.length)
    const hex = CORES_DOS_PEOES.map((cor) => HEX_COR_PEAO[cor])
    expect(new Set(hex).size).toBe(4)
    hex.forEach((h) => expect(h).toMatch(/^#[0-9a-f]{6}$/i))
  })

  it('peão sobre a peça fica acima do topo da caixa da peça', () => {
    // topo da peça = PECA_Y(0.02) + caixa em y=0.08 com espessura 0.12 → 0.16
    expect(PEAO_Y).toBeGreaterThanOrEqual(0.16)
  })

  // ── Conexões: espelho de `vizinhasConectadas` do engine ──

  it('inicial(3,3)@0 conecta com reta(3,4)@90 (leste↔oeste abertos)', () => {
    const pos = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('reta', 'reta', 90, 3, 4),
    ]
    const conectadas = vizinhasConectadas(pos, pos[0])
    expect(conectadas.map((p) => p.pecaId)).toEqual(['reta'])
  })

  it('vizinha com a borda voltada fechada não conecta', () => {
    // reta(3,4)@0 abre norte/sul — oeste fechado → sem conexão com a inicial
    const pos = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('reta', 'reta', 0, 3, 4),
    ]
    expect(vizinhasConectadas(pos, pos[0])).toEqual([])
  })

  it('célula vizinha vazia não conecta', () => {
    const pos = [peca('inicial', 'inicial', 0, 3, 3)]
    expect(vizinhasConectadas(pos, pos[0])).toEqual([])
  })

  it('borda aberta que aponta para fora da grade não conecta nem explode', () => {
    // reta(0,3)@0 abre norte → linha -1, fora da grade 7x7
    const pos = [peca('reta', 'reta', 0, 0, 3), peca('outra', 'cruz', 0, 1, 3)]
    const conectadas = vizinhasConectadas(pos, pos[0])
    // norte fora da grade é ignorado; sul→(1,3) cruz tem norte aberto → conecta
    expect(conectadas.map((p) => p.pecaId)).toEqual(['outra'])
  })

  it('conexão vale nos dois sentidos (reta@90 ↔ cruz)', () => {
    const pos = [
      peca('reta', 'reta', 90, 3, 4),
      peca('cruz', 'cruz', 0, 3, 5),
    ]
    expect(vizinhasConectadas(pos, pos[0]).map((p) => p.pecaId)).toEqual(['cruz'])
    expect(vizinhasConectadas(pos, pos[1]).map((p) => p.pecaId)).toEqual(['reta'])
  })

  it('estaDentroDaGrade respeita a grade 7x7 inteira', () => {
    expect(estaDentroDaGrade({ linha: 0, coluna: 0 })).toBe(true)
    expect(estaDentroDaGrade({ linha: 6, coluna: 6 })).toBe(true)
    expect(estaDentroDaGrade({ linha: -1, coluna: 0 })).toBe(false)
    expect(estaDentroDaGrade({ linha: 0, coluna: LADO_DA_GRADE })).toBe(false)
    expect(estaDentroDaGrade({ linha: 1.5, coluna: 0 })).toBe(false)
  })

  it('encontrarPecaNaCelula acha por chave e retorna null em célula livre', () => {
    const pos = [peca('a', 'inicial', 0, 3, 3)]
    expect(encontrarPecaNaCelula(pos, { linha: 3, coluna: 3 })?.pecaId).toBe('a')
    expect(encontrarPecaNaCelula(pos, { linha: 2, coluna: 3 })).toBeNull()
  })

  // ── Seleção e destinos válidos ──

  it('seleção de peão posicionado resolve a peça sob ele', () => {
    const mock = criarEstadoExibicaoMock()
    const selecao = selecionarPeaoNaExibicao(mock, 'peao-1-branco')
    expect(selecao).not.toBeNull()
    expect(selecao?.pecaId).toBe('posicionada-inicial-1')
    expect(selecao?.celula).toEqual({ linha: 3, coluna: 3 })
  })

  it('peão sobre a Mesa não tem seleção resolvida nem destinos', () => {
    const mock = criarEstadoExibicaoMock()
    expect(selecionarPeaoNaExibicao(mock, 'peao-2-vermelho')).toBeNull()
    expect(destinosConectadosDoPeao(mock.posicionadas, mock.peoes, 'peao-2-vermelho')).toEqual([])
    expect(selecionarPeaoNaExibicao(mock, 'peao-inexistente')).toBeNull()
  })

  it('peão posicionado em célula sem peça não resolve seleção', () => {
    const estado = comPeoes([peca('a', 'reta', 0, 0, 0)], [
      { peaoId: 'p1', cor: 'azul', celula: { linha: 5, coluna: 5 } },
    ])
    expect(selecionarPeaoNaExibicao(estado, 'p1')).toBeNull()
  })

  it('destinos conectados excluem peça ocupada por outro peão (máx. 1 peão/peça)', () => {
    const pos = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('reta', 'reta', 90, 3, 4),
    ]
    const doisPeoes: EstadoExibicaoTabuleiro['peoes'] = [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 3, coluna: 3 } },
      { peaoId: 'p2', cor: 'vermelho', celula: { linha: 3, coluna: 4 } },
    ]
    // conectada, mas ocupada por p2 → não é destino válido de p1
    expect(destinosConectadosDoPeao(pos, doisPeoes, 'p1').map((p) => p.pecaId)).toEqual([])
    // sem p2, a reta é destino válido
    const umPeao: EstadoExibicaoTabuleiro['peoes'] = [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 3, coluna: 3 } },
    ]
    expect(destinosConectadosDoPeao(pos, umPeao, 'p1').map((p) => p.pecaId)).toEqual(['reta'])
  })

  // ── Fileira na Mesa ──

  it('peaoMesaParaMundo coloca 4 slots distintos no lado oposto à Caixa (-X)', () => {
    const pos = Array.from({ length: QUANTIDADE_PEOES }, (_, i) => peaoMesaParaMundo(i))
    expect(new Set(pos.map((p) => p.join(','))).size).toBe(QUANTIDADE_PEOES)
    for (const [x, y, z] of pos) {
      expect(x).toBeLessThan(0) // oposto à zona da Caixa (+X)
      expect(y).toBe(0) // plano superior da Mesa
      expect(Math.abs(x)).toBeLessThanOrEqual(LARGURA_MESA / 2)
      expect(Math.abs(z)).toBeLessThanOrEqual(LARGURA_MESA / 2)
    }
    // fileira simétrica em z em torno do centro
    expect(pos[0][2]).toBeCloseTo(-pos[3][2])
    expect(pos[1][2]).toBeCloseTo(-pos[2][2])
  })

  // ── Invariantes do mock ──

  it('mock tem 4 peões de cores distintas, exatamente 1 posicionado na (3,3)', () => {
    const mock = criarEstadoExibicaoMock()
    expect(mock.peoes).toHaveLength(4)
    expect(new Set(mock.peoes.map((p) => p.cor)).size).toBe(4)
    const posicionados = mock.peoes.filter((p) => p.celula !== null)
    expect(posicionados).toHaveLength(1)
    expect(posicionados[0].cor).toBe('branco')
    expect(posicionados[0].celula).toEqual({ linha: 3, coluna: 3 })
    // o peão posicionado está sobre uma peça existente (a Inicial do mock)
    const pecaSobPeao = encontrarPecaNaCelula(mock.posicionadas, posicionados[0].celula!)
    expect(pecaSobPeao?.tipo).toBe('inicial')
  })

  it('mock respeita máx. 1 peão por célula/peça', () => {
    const mock = criarEstadoExibicaoMock()
    const celulas = mock.peoes
      .filter((p) => p.celula !== null)
      .map((p) => `${p.celula!.linha}:${p.celula!.coluna}`)
    expect(new Set(celulas).size).toBe(celulas.length)
  })

  it('cenário do mock: peão branco na inicial destaca a reta vizinha conectada', () => {
    const mock = criarEstadoExibicaoMock()
    const destinos = destinosConectadosDoPeao(mock.posicionadas, mock.peoes, 'peao-1-branco')
    expect(destinos.map((p) => p.pecaId)).toEqual(['posicionada-reta-2'])
  })
})
