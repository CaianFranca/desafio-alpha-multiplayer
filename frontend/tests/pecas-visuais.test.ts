/**
 * Visuais das peças (issues #275/#276/#277, spec #273).
 *
 * Só comportamento externo observável, nunca detalhe interno de material ou
 * asset: cada um dos 10 tipos resolve um par map/normal distinto, os caminhos
 * se distinguem sem depender de cor, o motivo gira com a orientação e as
 * dimensões do contrato seguem quadradas.
 */

import {
  LADO_DA_GRADE,
  LARGURA_TABULEIRO,
  PEAO_Y,
  PECA_Y,
  PROFUNDIDADE_TABULEIRO,
  TAMANHO_CELULA,
} from '../web/src/game/tabuleiro/contrato'
import type { TipoDaPeca } from '../web/src/game/tabuleiro/contrato'
import {
  TEXTURAS_DAS_PECAS,
  TIPOS_COM_TEXTURA,
  rotacaoDoMotivo,
  texturaDaPeca,
} from '../web/src/game/tabuleiro/texturasDasPecas'

const TODOS_OS_TIPOS: readonly TipoDaPeca[] = [
  'inicial',
  'reta',
  'T',
  'cruz',
  'gerador',
  'sala_do_diretor',
  'sala_medica',
  'portao_de_saida',
  'vulto',
  'espectro',
]

describe('visuais das peças', () => {
  it('cobre os 10 tipos com par map/normal distinto por tipo', () => {
    expect([...TIPOS_COM_TEXTURA].sort()).toEqual([...TODOS_OS_TIPOS].sort())
    expect(Object.keys(TEXTURAS_DAS_PECAS).sort()).toEqual([
      ...TODOS_OS_TIPOS,
    ].sort())
    for (const tipo of TODOS_OS_TIPOS) {
      const par = texturaDaPeca(tipo)
      expect(par.map).toContain('assets/textures/')
      expect(par.map.endsWith('.jpg')).toBe(true)
      expect(par.normalMap).toContain('assets/textures/')
      expect(par.normalMap.endsWith('.jpg')).toBe(true)
      expect(par.normalMap).not.toBe(par.map)
    }
    // 20 arquivos distintos: 10 maps + 10 normals, sem colisão entre tipos.
    const maps = TODOS_OS_TIPOS.map((t) => texturaDaPeca(t).map)
    const normals = TODOS_OS_TIPOS.map((t) => texturaDaPeca(t).normalMap)
    expect(new Set(maps).size).toBe(TODOS_OS_TIPOS.length)
    expect(new Set(normals).size).toBe(TODOS_OS_TIPOS.length)
    expect(new Set([...maps, ...normals]).size).toBe(
      TODOS_OS_TIPOS.length * 2,
    )
  })

  it('peças de caminho distinguíveis sem depender de cor (map próprio)', () => {
    const caminhos = TODOS_OS_TIPOS.map((t) => texturaDaPeca(t).map)
    // Inicial, reta, T e cruz não compartilham o map entre si.
    const caminhosBase = ['inicial', 'reta', 'T', 'cruz'] as const
    const mapsBase = caminhosBase.map((t) => texturaDaPeca(t).map)
    expect(new Set(mapsBase).size).toBe(caminhosBase.length)
    expect(new Set(caminhos).size).toBe(TODOS_OS_TIPOS.length)
  })

  it('motivo gira com a orientação (4 ângulos distintos, 0 na origem)', () => {
    expect(rotacaoDoMotivo(0)).toBe(0)
    const angulos = [0, 90, 180, 270].map(
      (o) => rotacaoDoMotivo(o as 0 | 90 | 180 | 270),
    )
    expect(new Set(angulos).size).toBe(4)
    // 90° equivalem a meio π em módulo (sentido horário visto de cima).
    expect(Math.abs(rotacaoDoMotivo(90))).toBeCloseTo(Math.PI / 2)
    expect(Math.abs(rotacaoDoMotivo(180))).toBeCloseTo(Math.PI)
  })

  it('dimensões do contrato inalteradas: peças seguem quadradas', () => {
    expect(TAMANHO_CELULA).toBeGreaterThan(0)
    expect(LARGURA_TABULEIRO).toBe(LADO_DA_GRADE * TAMANHO_CELULA)
    expect(PROFUNDIDADE_TABULEIRO).toBe(LADO_DA_GRADE * TAMANHO_CELULA)
    expect(LARGURA_TABULEIRO).toBe(PROFUNDIDADE_TABULEIRO)
    // Derivação peça→peão intacta (PECA_Y + 0.14 = topo da peça).
    expect(PEAO_Y).toBeCloseTo(PECA_Y + 0.14)
  })
})
