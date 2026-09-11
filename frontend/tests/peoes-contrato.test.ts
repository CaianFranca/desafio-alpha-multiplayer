import {
  CORES_DOS_PEOES,
  HEX_COR_PEAO,
  LADO_DA_GRADE,
  PEAO_Y,
  QUANTIDADE_PEOES,
  destinosConectadosDoPeao,
  encontrarPecaNaCelula,
  estaDentroDaGrade,
  normalizarCelula,
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

  it('borda aberta na borda da grade envolve sem explodir (issue #260)', () => {
    // reta(0,3)@0 abre norte → envolve para (6,3), vazia; sul→(1,3) conecta
    const pos = [peca('reta', 'reta', 0, 0, 3), peca('outra', 'cruz', 0, 1, 3)]
    const conectadas = vizinhasConectadas(pos, pos[0])
    expect(conectadas.map((p) => p.pecaId)).toEqual(['outra'])
  })

  it('conexão toroidal: norte de (0,3) alcança peça com sul aberto em (6,3) (issue #260)', () => {
    const pos = [
      peca('inicial', 'inicial', 0, 0, 3),
      peca('reta', 'reta', 0, 6, 3),
    ]
    expect(vizinhasConectadas(pos, pos[0]).map((p) => p.pecaId)).toEqual(['reta'])
    expect(vizinhasConectadas(pos, pos[1]).map((p) => p.pecaId)).toEqual(['inicial'])
  })

  it('normalizarCelula envolve coordenadas para a grade 7x7 (issue #260)', () => {
    expect(normalizarCelula({ linha: -1, coluna: 7 })).toEqual({ linha: 6, coluna: 0 })
    expect(normalizarCelula({ linha: 3, coluna: 3 })).toEqual({ linha: 3, coluna: 3 })
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
    expect(
      destinosConectadosDoPeao(mock.posicionadas, mock.peoes, 'peao-2-vermelho').map(
        (d) => d.peca.pecaId,
      ),
    ).toEqual([])
    expect(selecionarPeaoNaExibicao(mock, 'peao-inexistente')).toBeNull()
  })

  it('peão posicionado em célula sem peça não resolve seleção', () => {
    const estado = comPeoes([peca('a', 'reta', 0, 0, 0)], [
      { peaoId: 'p1', cor: 'azul', celula: { linha: 5, coluna: 5 } },
    ])
    expect(selecionarPeaoNaExibicao(estado, 'p1')).toBeNull()
  })

  // ── Destinos: espelho da ocupação do engine (F1 #145-exp) ──
  //
  // Regra espelhada de `mover_peao` (engine):
  //   - teto comum 1 / Portão 4 (peoes.ts:555-561, partida.ts:1490);
  //   - +1 teto quando a peça abriga peão AFETADO (partida.ts:1479-1492);
  //   - Monstros nunca aceitam peão (partida.ts:583-585, peoes.ts:531-536).

  it('peça comum ocupada por peão NÃO-afetado é bloqueada (teto 1 — partida.ts:1490)', () => {
    const pos = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('reta', 'reta', 90, 3, 4),
    ]
    const doisPeoes: EstadoExibicaoTabuleiro['peoes'] = [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 3, coluna: 3 } },
      { peaoId: 'p2', cor: 'vermelho', celula: { linha: 3, coluna: 4 } },
    ]
    // conectada, mas ocupada por p2 não-afetado → teto 1 atingido, sem destino.
    expect(
      destinosConectadosDoPeao(pos, doisPeoes, 'p1').map((d) => d.peca.pecaId),
    ).toEqual([])
    // sem p2, a reta é destino de movimento normal.
    const umPeao: EstadoExibicaoTabuleiro['peoes'] = [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 3, coluna: 3 } },
    ]
    expect(destinosConectadosDoPeao(pos, umPeao, 'p1')).toEqual([
      { peca: pos[1], tipo: 'movimento' },
    ])
  })

  it('peça ocupada por peão AFETADO vira destino de RESGATE (+1 teto — partida.ts:1491)', () => {
    const pos = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('reta', 'reta', 90, 3, 4),
    ]
    const doisPeoes: EstadoExibicaoTabuleiro['peoes'] = [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 3, coluna: 3 } },
      { peaoId: 'p2', cor: 'vermelho', celula: { linha: 3, coluna: 4 } },
    ]
    // p2 afetado (Baixa Iluminação ∨ Amedrontado — projeção do chamador):
    // teto 2, 1 ocupante → aceito como resgate (comando segue MOVER_PEAO).
    expect(destinosConectadosDoPeao(pos, doisPeoes, 'p1', new Set(['p2']))).toEqual([
      { peca: pos[1], tipo: 'resgate' },
    ])
  })

  it('Portão aceita do 2º ao 4º peão; ocupantes no teto 4 bloqueiam nova entrada (espelha engine/termino.test.ts:770)', () => {
    const pos = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('portao', 'portao_de_saida', 0, 3, 4),
    ]
    const noPortao = (quantidade: number): EstadoExibicaoTabuleiro['peoes'] => [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 3, coluna: 3 } },
      ...Array.from({ length: quantidade }, (_, i) => ({
        // ids sintéticos além dos 4 canônicos: a função espelha a REGRA de
        // teto, não o roster; o engine com 4 peões torna o 5º inalcançável
        // (peoes.ts:549-554).
        peaoId: `px${i}`,
        cor: 'azul' as const,
        celula: { linha: 3, coluna: 4 },
      })),
    ]
    // 1, 2 e 3 ocupantes → o 2º-4º peões entram como movimento.
    for (const ocupantes of [1, 2, 3]) {
      expect(destinosConectadosDoPeao(pos, noPortao(ocupantes), 'p1')).toEqual([
        { peca: pos[1], tipo: 'movimento' },
      ])
    }
    // 4 ocupantes → teto atingido, sem destino.
    expect(destinosConectadosDoPeao(pos, noPortao(4), 'p1')).toEqual([])
  })

  it('Portão usa o N do roster, não peoes.length (modo misto pré-fiação: 4 peões, N=2 → teto 2)', () => {
    const pos = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('portao', 'portao_de_saida', 0, 3, 4),
    ]
    const peoes: EstadoExibicaoTabuleiro['peoes'] = [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 3, coluna: 3 } },
      { peaoId: 'p2', cor: 'vermelho', celula: { linha: 3, coluna: 4 } },
      { peaoId: 'p3', cor: 'azul', celula: { linha: 3, coluna: 4 } },
      { peaoId: 'px', cor: 'amarelo', celula: null },
    ]
    // 2 ocupantes no Portão com N=2 → teto atingido, sem destino (por
    // peoes.length o teto seria 4 e a entrada passaria).
    expect(destinosConectadosDoPeao(pos, peoes, 'p1', new Set(), 2)).toEqual([])
    // Sem o N explícito, a derivação legada por peoes.length é preservada.
    expect(destinosConectadosDoPeao(pos, peoes, 'p1')).toEqual([
      { peca: pos[1], tipo: 'movimento' },
    ])
  })

  it('Portão com afetado eleva o teto a 5 (espelho exato de tetoOcupacao — partida.ts:1489-1492)', () => {
    const pos = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('portao', 'portao_de_saida', 0, 3, 4),
    ]
    const quatroNoPortao: EstadoExibicaoTabuleiro['peoes'] = [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 3, coluna: 3 } },
      { peaoId: 'p2', cor: 'vermelho', celula: { linha: 3, coluna: 4 } },
      { peaoId: 'p3', cor: 'azul', celula: { linha: 3, coluna: 4 } },
      { peaoId: 'p4', cor: 'amarelo', celula: { linha: 3, coluna: 4 } },
      { peaoId: 'px', cor: 'azul', celula: { linha: 3, coluna: 4 } },
    ]
    // sem afetado: 4 ocupantes já bloqueavam; com p2 afetado: teto 5 → entra
    // e o pouso é de resgate.
    expect(
      destinosConectadosDoPeao(pos, quatroNoPortao, 'p1', new Set(['p2'])),
    ).toEqual([{ peca: pos[1], tipo: 'resgate' }])
  })

  it('Monstros posicionados nunca são destino (vulto/espectro — partida.ts:583-585)', () => {
    const comVulto = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('vulto-1', 'vulto', 90, 3, 4),
    ]
    const umPeao: EstadoExibicaoTabuleiro['peoes'] = [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 3, coluna: 3 } },
    ]
    expect(destinosConectadosDoPeao(comVulto, umPeao, 'p1')).toEqual([])
    const comEspectro = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('espectro-1', 'espectro', 90, 3, 4),
    ]
    expect(destinosConectadosDoPeao(comEspectro, umPeao, 'p1')).toEqual([])
  })

  // ── Zona da origem (issue do movimento encadeado): o Peão só pousa na
  // Peça do início do turno ou em vizinha diretamente conectada a ela —
  // ida-e-volta de 1 salto até a Confirmação. Espelho de partida.ts.
  it('com a Peça do início do turno, destinos fora da zona somem (2º salto barrado)', () => {
    const pos = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('reta-1', 'reta', 0, 2, 3),
      peca('reta-2', 'reta', 0, 1, 3),
    ]
    // p1 já deu o 1º salto (está sobre a reta-1): a origem do turno é a
    // inicial; a reta-2 é vizinha conectada da reta-1, mas FORA da zona
    // {inicial} ∪ vizinhas(inicial).
    const peoes: EstadoExibicaoTabuleiro['peoes'] = [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 2, coluna: 3 } },
    ]
    expect(
      destinosConectadosDoPeao(pos, peoes, 'p1', new Set(), undefined, 'inicial'),
    ).toEqual([{ peca: pos[0], tipo: 'movimento' }])
  })

  it('sem zona (null/ausente) mantém o comportamento legado de todas as conectadas', () => {
    const pos = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('reta-1', 'reta', 0, 2, 3),
      peca('reta-2', 'reta', 0, 1, 3),
    ]
    const peoes: EstadoExibicaoTabuleiro['peoes'] = [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 2, coluna: 3 } },
    ]
    // null (Peão na Mesa do Primeiro Turno / entre turnos) e ausente (legado)
    // ficam sem filtro: inicial e reta-2 são destinos (ordem de varredura da
    // grade: linha-menor primeiro).
    expect(
      destinosConectadosDoPeao(pos, peoes, 'p1', new Set(), undefined, null),
    ).toEqual([
      { peca: pos[2], tipo: 'movimento' },
      { peca: pos[0], tipo: 'movimento' },
    ])
    expect(destinosConectadosDoPeao(pos, peoes, 'p1')).toEqual([
      { peca: pos[2], tipo: 'movimento' },
      { peca: pos[0], tipo: 'movimento' },
    ])
  })

  it('Peça do início removida da mesa degrada para as conectadas (fail-open do engine)', () => {
    const pos = [
      peca('inicial', 'inicial', 0, 3, 3),
      peca('reta-1', 'reta', 0, 2, 3),
      peca('reta-2', 'reta', 0, 1, 3),
    ]
    const peoes: EstadoExibicaoTabuleiro['peoes'] = [
      { peaoId: 'p1', cor: 'branco', celula: { linha: 2, coluna: 3 } },
    ]
    // 'removida' não está em posicionadas (ex.: Limpeza a tirou da mesa):
    // sem origem conhecida não há zona a impor — igual ao fail-open do motor.
    expect(
      destinosConectadosDoPeao(pos, peoes, 'p1', new Set(), undefined, 'removida'),
    ).toEqual([
      { peca: pos[2], tipo: 'movimento' },
      { peca: pos[0], tipo: 'movimento' },
    ])
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
    expect(destinos.map((d) => d.peca.pecaId)).toEqual(['posicionada-reta-2'])
  })
})
