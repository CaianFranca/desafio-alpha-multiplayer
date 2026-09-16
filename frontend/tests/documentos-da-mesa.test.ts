/**
 * Documentos largados na Mesa: só comportamento externo observável.
 *
 * As páginas resolvem texturas sob `assets/textures/*.jpg` com as dimensões
 * na proporção exata dos arquivos, espalhadas pelo tampo (pilha no canto
 * superior esquerdo, sob as algemas e separadas no canto inferior direito),
 * assentadas no plano da Mesa e fora do tabuleiro central.
 */

import {
  DIMENSOES_DO_CARTAO,
  DIMENSOES_DOS_DOCUMENTOS,
  INSTANCIAS_DOS_DOCUMENTOS,
  PARAMETROS_DO_CARTAO,
  POSICAO_ALGEMAS,
  POSICAO_DO_CARTAO,
  PROPORCAO_DO_CARTAO,
  PROPORCAO_DOS_DOCUMENTOS,
  ROTACAO_DO_CARTAO,
  TEXTURA_DO_CARTAO,
  TEXTURAS_DOS_DOCUMENTOS,
  TIPOS_DE_DOCUMENTO,
  texturaDoDocumento,
  validarPosicaoDoCartao,
  validarPosicaoDosDocumentos,
} from '../web/src/game/tabuleiro/decoracoesDaMesa'

describe('documentos largados na Mesa', () => {
  it('vertical e horizontal resolvem texturas sob assets/textures/*.jpg', () => {
    expect([...TIPOS_DE_DOCUMENTO].sort()).toEqual([
      'horizontal',
      'vertical',
    ])
    expect(Object.keys(TEXTURAS_DOS_DOCUMENTOS).sort()).toEqual([
      'horizontal',
      'vertical',
    ])
    for (const tipo of TIPOS_DE_DOCUMENTO) {
      const url = texturaDoDocumento(tipo)
      expect(url).toBe(TEXTURAS_DOS_DOCUMENTOS[tipo])
      expect(url).toContain('assets/textures/')
      expect(url.endsWith('.jpg')).toBe(true)
    }
    expect(TEXTURAS_DOS_DOCUMENTOS.vertical).toContain(
      'documento-vertical.jpg',
    )
    expect(TEXTURAS_DOS_DOCUMENTOS.horizontal).toContain('documento.jpg')
  })

  it('dimensões da lâmina espelham a proporção do arquivo de textura', () => {
    // Proporções medidas nos assets: vertical 880×1206, horizontal 1295×816.
    expect(PROPORCAO_DOS_DOCUMENTOS.vertical).toBeCloseTo(880 / 1206)
    expect(PROPORCAO_DOS_DOCUMENTOS.horizontal).toBeCloseTo(1295 / 816)
    for (const tipo of TIPOS_DE_DOCUMENTO) {
      const { largura, profundidade } = DIMENSOES_DOS_DOCUMENTOS[tipo]
      expect(largura / profundidade).toBeCloseTo(
        PROPORCAO_DOS_DOCUMENTOS[tipo],
        2,
      )
    }
  })

  it('horizontal maior que o vertical no lado maior', () => {
    // O lado maior do horizontal supera o do vertical; o menor de cada um
    // segue a proporção do próprio arquivo (aspectos diferentes).
    const ladoMaior = (d: { largura: number; profundidade: number }) =>
      Math.max(d.largura, d.profundidade)
    expect(ladoMaior(DIMENSOES_DOS_DOCUMENTOS.horizontal)).toBeGreaterThan(
      ladoMaior(DIMENSOES_DOS_DOCUMENTOS.vertical),
    )
  })

  it('páginas espalhadas: pilha no NO, sob as algemas e faixas N/S', () => {
    expect(validarPosicaoDosDocumentos()).toBeNull()
    // 3 no canto superior esquerdo (−x, −z).
    const noNoroeste = INSTANCIAS_DOS_DOCUMENTOS.filter(
      (instancia) => instancia.posicao[0] < 0 && instancia.posicao[2] < 0,
    )
    expect(noNoroeste.length).toBeGreaterThanOrEqual(3)
    // Ao menos 1 sob as algemas (perto do centro delas).
    const sobAsAlgemas = INSTANCIAS_DOS_DOCUMENTOS.filter((instancia) => {
      const [x, , z] = instancia.posicao
      const [ax, , az] = POSICAO_ALGEMAS
      return Math.hypot(x - ax, z - az) < 3
    })
    expect(sobAsAlgemas.length).toBeGreaterThanOrEqual(1)
    // Horizontais maiores na diagonal do sul (sudoeste + sudeste).
    const horizontais = INSTANCIAS_DOS_DOCUMENTOS.filter(
      (instancia) => instancia.tipo === 'horizontal',
    )
    expect(horizontais.length).toBe(2)
    for (const instancia of horizontais) {
      expect(instancia.posicao[2]).toBeGreaterThan(0)
      expect(instancia.rotacaoY).toBe(-0.2)
    }
    expect(
      horizontais.some((instancia) => instancia.posicao[0] < 0),
    ).toBe(true)
    expect(
      horizontais.some((instancia) => instancia.posicao[0] > 0),
    ).toBe(true)
    // Os dois tipos de página aparecem na Mesa.
    const tipos = new Set(
      INSTANCIAS_DOS_DOCUMENTOS.map((instancia) => instancia.tipo),
    )
    expect(tipos.has('vertical')).toBe(true)
    expect(tipos.has('horizontal')).toBe(true)
  })

  it('cada instância tem posição sobre a Mesa e giro válido', () => {
    expect(INSTANCIAS_DOS_DOCUMENTOS.length).toBeGreaterThanOrEqual(7)
    for (const instancia of INSTANCIAS_DOS_DOCUMENTOS) {
      const [, y] = instancia.posicao
      expect(y).toBeGreaterThanOrEqual(0.01)
      expect(Number.isFinite(instancia.rotacaoY)).toBe(true)
    }
    // Alturas todas distintas: folhas sobrepostas nunca têm faces coplanares
    // (sem z-fighting).
    const alturas = INSTANCIAS_DOS_DOCUMENTOS.map(
      (instancia) => instancia.posicao[1],
    )
    expect(new Set(alturas).size).toBe(INSTANCIAS_DOS_DOCUMENTOS.length)
  })

  it('cartão de acesso resolve cartao.jpg na proporção do arquivo', () => {
    // Proporção medida no asset: 648×391.
    expect(PROPORCAO_DO_CARTAO).toBeCloseTo(648 / 391)
    expect(TEXTURA_DO_CARTAO).toContain('assets/textures/')
    expect(TEXTURA_DO_CARTAO).toContain('cartao.jpg')
    expect(DIMENSOES_DO_CARTAO.largura / DIMENSOES_DO_CARTAO.profundidade).toBeCloseTo(
      PROPORCAO_DO_CARTAO,
      2,
    )
    expect(PARAMETROS_DO_CARTAO.url).toBe(TEXTURA_DO_CARTAO)
    expect(PARAMETROS_DO_CARTAO.rotacaoY).toBe(ROTACAO_DO_CARTAO)
  })

  it('cartão repousa sobre o horizontal do canto inferior direito', () => {
    expect(validarPosicaoDoCartao()).toBeNull()
    const [x, y, z] = POSICAO_DO_CARTAO
    // No quadrante do documento (+x, +z) e acima do plano.
    expect(x).toBeGreaterThan(0)
    expect(z).toBeGreaterThan(0)
    expect(y).toBeGreaterThan(0.035)
    expect(Number.isFinite(ROTACAO_DO_CARTAO)).toBe(true)
  })
})
