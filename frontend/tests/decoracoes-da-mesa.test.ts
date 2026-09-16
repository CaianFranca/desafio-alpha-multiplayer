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
  POSICAO_ALGEMAS,
  POSICAO_LIVRO,
  POSICAO_LIVRO_EMPILHADO,
  POSICAO_VELA,
  POSICAO_VELA_LESTE,
  POSICAO_VELA_SUDOESTE,
  escalaEfetivaDaDecoracao,
  luzDaChama,
  modeloDaDecoracao,
  validarPosicaoDaVela,
  validarPosicaoDasAlgemas,
  validarPosicaoDasVelasPequenas,
  validarPosicaoDoLivro,
} from '../web/src/game/tabuleiro/decoracoesDaMesa'
import { POSICAO_CAIXA } from '../web/src/game/tabuleiro/contrato'

describe('decorações da Mesa', () => {
  it('velas, algemas e livros resolvem URLs sob assets/3d-models/*.glb', () => {
    expect([...NOMES_DAS_DECORACOES].sort()).toEqual([
      'algemas',
      'livro',
      'livroEmpilhado',
      'vela',
      'velaLeste',
      'velaSudoeste',
    ])
    expect(Object.keys(MODELOS_DAS_DECORACOES).sort()).toEqual([
      'algemas',
      'livro',
      'livroEmpilhado',
      'vela',
      'velaLeste',
      'velaSudoeste',
    ])
    for (const nome of NOMES_DAS_DECORACOES) {
      const url = modeloDaDecoracao(nome)
      expect(url).toBe(MODELOS_DAS_DECORACOES[nome])
      expect(url).toContain('assets/3d-models/')
      expect(url.endsWith('.glb')).toBe(true)
    }
    expect(MODELOS_DAS_DECORACOES.vela).toContain('vela.glb')
    expect(MODELOS_DAS_DECORACOES.algemas).toContain('algemas.glb')
    expect(MODELOS_DAS_DECORACOES.livro).toContain('livro.glb')
    expect(modeloDaDecoracao('livroEmpilhado')).toBe(
      modeloDaDecoracao('livro'),
    )
    expect(MODELOS_DAS_DECORACOES.velaSudoeste).toContain('vela-pequena.glb')
    expect(modeloDaDecoracao('velaLeste')).toBe(
      modeloDaDecoracao('velaSudoeste'),
    )
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
    expect(luz!.intensidade).toBe(18)
    expect(luz!.distancia).toBe(10)
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

  it('algemas no canto inferior esquerdo, fora do tabuleiro e sem chama', () => {
    expect(validarPosicaoDasAlgemas()).toBeNull()
    const [x, y, z] = POSICAO_ALGEMAS
    expect(y).toBe(0)
    expect(x).toBeLessThan(0)
    expect(z).toBeGreaterThan(0)
    expect(luzDaChama('algemas')).toBeNull()
  })

  it('algemas calibradas via screenshot (×3, giro 1)', () => {
    expect(AJUSTES_DAS_DECORACOES.algemas.escala).toBe(3)
    expect(AJUSTES_DAS_DECORACOES.algemas.rotacaoY).toBe(1)
  })

  it('livro sobre a pilha de páginas do canto superior esquerdo', () => {
    expect(validarPosicaoDoLivro()).toBeNull()
    const [x, y, z] = POSICAO_LIVRO
    // Acima do plano (repousa sobre as folhas) e no quadrante NO.
    expect(y).toBeGreaterThan(0)
    expect(x).toBeLessThan(0)
    expect(z).toBeLessThan(0)
    expect(luzDaChama('livro')).toBeNull()
  })

  it('livro calibrado via screenshot (×2.2, giro -0.5)', () => {
    expect(AJUSTES_DAS_DECORACOES.livro.escala).toBe(2.2)
    expect(AJUSTES_DAS_DECORACOES.livro.rotacaoY).toBe(-0.5)
  })

  it('livro empilhado segue o primeiro, só com o giro diferente', () => {
    expect(validarPosicaoDoLivro()).toBeNull()
    // Mesma escala, mesma base, acima — só o giro muda um pouco.
    expect(AJUSTES_DAS_DECORACOES.livroEmpilhado.escala).toBe(
      AJUSTES_DAS_DECORACOES.livro.escala,
    )
    expect(POSICAO_LIVRO_EMPILHADO[0]).toBe(POSICAO_LIVRO[0])
    expect(POSICAO_LIVRO_EMPILHADO[2]).toBe(POSICAO_LIVRO[2])
    expect(POSICAO_LIVRO_EMPILHADO[1]).toBeGreaterThan(POSICAO_LIVRO[1])
    expect(AJUSTES_DAS_DECORACOES.livroEmpilhado.rotacaoY).not.toBe(
      AJUSTES_DAS_DECORACOES.livro.rotacaoY,
    )
    expect(luzDaChama('livroEmpilhado')).toBeNull()
  })

  it('velas pequenas com a mesma chama da vela pré-existente', () => {
    expect(validarPosicaoDasVelasPequenas()).toBeNull()
    const [sx, sy, sz] = POSICAO_VELA_SUDOESTE
    const [lx, , lz] = POSICAO_LIVRO
    expect(sx).toBeLessThan(lx)
    expect(sz).toBeGreaterThan(lz)
    expect(sy).toBe(0)
    const [ex, ey, ez] = POSICAO_VELA_LESTE
    expect(ez).toBeLessThan(0)
    expect(ex).toBeGreaterThan(-3.5)
    expect(ex).toBeLessThan(POSICAO_VELA[0])
    expect(ey).toBe(0)
    // Mesma config, por referência: um ajuste afina as três chamas.
    expect(luzDaChama('velaSudoeste')).toBe(luzDaChama('vela'))
    expect(luzDaChama('velaLeste')).toBe(luzDaChama('vela'))
    expect(luzDaChama('velaSudoeste')).not.toBeNull()
  })

  it('velas pequenas nascem contidas (×1, sem giro) para calibrar depois', () => {
    expect(AJUSTES_DAS_DECORACOES.velaSudoeste.escala).toBe(1)
    expect(AJUSTES_DAS_DECORACOES.velaSudoeste.rotacaoY).toBe(0)
    expect(AJUSTES_DAS_DECORACOES.velaLeste.escala).toBe(1)
    expect(AJUSTES_DAS_DECORACOES.velaLeste.rotacaoY).toBe(0)
  })
})
