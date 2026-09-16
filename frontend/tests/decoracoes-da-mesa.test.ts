/**
 * Decorações da Mesa: só comportamento externo observável.
 *
 * A vela resolve URL sob `assets/3d-models/vela.glb`, fica a noroeste da
 * Caixa, fora do tabuleiro central e dentro da Mesa 20×20.
 */

import {
  AJUSTES_DAS_DECORACOES,
  MODELOS_DAS_DECORACOES,
  NOMES_DAS_DECORACOES,
  POSICAO_VELA,
  escalaEfetivaDaDecoracao,
  luzDaChama,
  modeloDaDecoracao,
  validarPosicaoDaVela,
} from '../web/src/game/tabuleiro/decoracoesDaMesa'
import { POSICAO_CAIXA } from '../web/src/game/tabuleiro/contrato'

describe('decorações da Mesa', () => {
  it('vela resolve URL sob assets/3d-models/vela.glb', () => {
    expect([...NOMES_DAS_DECORACOES]).toEqual(['vela'])
    const url = modeloDaDecoracao('vela')
    expect(url).toBe(MODELOS_DAS_DECORACOES.vela)
    expect(url).toContain('assets/3d-models/')
    expect(url).toContain('vela.glb')
  })

  it('vela a noroeste da Caixa, fora do tabuleiro e dentro da Mesa', () => {
    expect(validarPosicaoDaVela()).toBeNull()
    const [x, y, z] = POSICAO_VELA
    expect(y).toBe(0)
    expect(x).toBeLessThan(POSICAO_CAIXA[0])
    expect(z).toBeLessThan(POSICAO_CAIXA[2])
  })

  it('ajuste calibrado via screenshot (×3, giro 3.6)', () => {
    // Valores do dono via calibragem visual — alterar quebra a composição
    // aprovada da mesa (mesmo padrão dos tamanhos obrigatórios da Caixa).
    expect(AJUSTES_DAS_DECORACOES.vela.escala).toBe(3)
    expect(AJUSTES_DAS_DECORACOES.vela.rotacaoY).toBe(3.6)
  })

  it('escala efetiva aplica o multiplicador sobre o encaixe', () => {
    const escala = escalaEfetivaDaDecoracao(
      1.2,
      1.2,
      { x: 1, y: 1, z: 1 },
      AJUSTES_DAS_DECORACOES.vela,
    )
    expect(escala).toBeCloseTo(1.2 * 3)
  })

  it('vela tem ponto de luz amarelo acima do topo (chama)', () => {
    const luz = luzDaChama('vela')
    expect(luz).not.toBeNull()
    // Amarelo quente da chama, forte o bastante para marcar a base da vela
    // e a Caixa vizinha, com alcance cortado — e a lâmpada acima do topo
    // do modelo (nunca dentro dele).
    expect(luz!.cor.toLowerCase()).toMatch(/^#ff/)
    expect(luz!.intensidade).toBe(15)
    expect(luz!.distancia).toBe(15)
    expect(luz!.decaimento).toBe(1)
    expect(luz!.folgaAcimaDoTopo).toBeGreaterThan(0)
  })

  it('chama da vela projeta sombra dos elementos ao redor', () => {
    const sombra = luzDaChama('vela')!.sombra
    expect(sombra).not.toBeNull()
    // Cube map com resolução e alcance calibráveis; a sombra cobre todo o
    // alcance da luz e nasce fora da chama (sem auto-artefato).
    expect(sombra!.tamanhoDoMapa).toBeGreaterThanOrEqual(512)
    expect(sombra!.near).toBeGreaterThan(0)
    expect(sombra!.far).toBeGreaterThanOrEqual(luzDaChama('vela')!.distancia)
    expect(sombra!.bias).toBeLessThan(0)
  })
})
