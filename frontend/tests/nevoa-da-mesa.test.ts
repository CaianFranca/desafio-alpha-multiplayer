/**
 * Névoa da Mesa: só comportamento externo observável.
 *
 * Pouca névoa sobre o tampo (quadriculado legível, buraco sobre o 7×7) e
 * densa ao redor da Mesa, abraçando a borda — como na referência.
 */

import {
  COR_NEVOA,
  MANCHAS_DA_NEVOA,
  MEIO_BURACO_NEVOA,
  validarNevoaDaMesa,
} from '../web/src/game/tabuleiro/nevoaDaMesa'
import { LARGURA_TABULEIRO } from '../web/src/game/tabuleiro/contrato'

describe('névoa da Mesa', () => {
  it('layout válido: topo contido com buraco, lados ao redor', () => {
    expect(validarNevoaDaMesa()).toBeNull()
    expect(MEIO_BURACO_NEVOA).toBeGreaterThanOrEqual(
      LARGURA_TABULEIRO / 2 + 0.3,
    )
    expect(COR_NEVOA).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('pouca névoa em cima: só 2 lâminas fracas no tampo', () => {
    const noTopo = MANCHAS_DA_NEVOA.filter((mancha) => mancha.comBuraco)
    expect(noTopo.length).toBe(2)
    for (const mancha of noTopo) {
      expect(mancha.opacidade).toBeLessThanOrEqual(0.3)
      expect(mancha.y).toBeGreaterThan(0)
    }
  })

  it('névoa dos lados: 4 manchas fora da pegada, sem sobreposição', () => {
    const nosLados = MANCHAS_DA_NEVOA.filter((mancha) => !mancha.comBuraco)
    expect(nosLados.length).toBe(4)
    for (const mancha of nosLados) {
      expect(mancha.opacidade).toBeGreaterThanOrEqual(0.3)
      expect(mancha.y).toBeLessThanOrEqual(0.5)
    }
    // Vizinhas não se sobrepõem em área (o cruzamento desenharia um vinco):
    // só encostam em quina.
    for (let i = 0; i < nosLados.length; i++) {
      for (let j = i + 1; j < nosLados.length; j++) {
        const a = nosLados[i]
        const b = nosLados[j]
        const sobrepoeX =
          Math.abs(a.centro[0] - b.centro[0]) <
          a.largura / 2 + b.largura / 2 - 0.01
        const sobrepoeZ =
          Math.abs(a.centro[1] - b.centro[1]) <
          a.profundidade / 2 + b.profundidade / 2 - 0.01
        expect(sobrepoeX && sobrepoeZ).toBe(false)
      }
    }
    // N/S/L/O ao redor (um por quadrante lateral).
    expect(
      nosLados.some((m) => m.centro[1] < 0 && Math.abs(m.centro[0]) < 1),
    ).toBe(true)
    expect(
      nosLados.some((m) => m.centro[1] > 0 && Math.abs(m.centro[0]) < 1),
    ).toBe(true)
    expect(
      nosLados.some((m) => m.centro[0] > 0 && Math.abs(m.centro[1]) < 1),
    ).toBe(true)
    expect(
      nosLados.some((m) => m.centro[0] < 0 && Math.abs(m.centro[1]) < 1),
    ).toBe(true)
  })

  it('alturas todas distintas: sem faces coplanares entre manchas', () => {
    const alturas = MANCHAS_DA_NEVOA.map((mancha) => mancha.y)
    expect(new Set(alturas).size).toBe(MANCHAS_DA_NEVOA.length)
  })
})
