// Manifesto de assets da Partida: o preload total só funciona se cada grupo
// espelhar as fontes de verdade (mesmo loader + mesma forma do input das
// chamadas `useLoader`, pois a chave de cache do R3F é `[loader, ...urls]`).
// Estes testes travam o contrato: adicionar um asset à cena sem registrar
// aqui quebra o teste correspondente.
import { describe, expect, it } from 'vitest'
import {
  GLBS_AVULSOS,
  PARES_DE_AVATARES_POR_SLOT,
  PAR_DE_TEXTURA_DO_TABULEIRO,
  SONS_DA_PARTIDA,
  TEXTURAS_AVULSAS,
  TRIPLAS_DE_TEXTURA_DAS_PECAS,
  URL_DA_MESA,
} from '../web/src/game/assets/manifestoDeAssets'
import {
  TEXTURA_OBSCURO_DA_GRADE,
  TEXTURAS_DAS_PECAS,
  TIPOS_COM_TEXTURA,
} from '../web/src/game/tabuleiro/texturasDasPecas'
import { TEXTURA_DO_TABULEIRO } from '../web/src/game/tabuleiro/texturasDoTabuleiro'
import { AVATARES_POR_SLOT } from '../web/src/game/tabuleiro/avatares'
import { MODELOS_DE_MONSTRO } from '../web/src/game/tabuleiro/monstros'
import {
  MODELOS_DA_CAIXA,
  NOMES_DOS_MODELOS_DA_CAIXA,
} from '../web/src/game/tabuleiro/modelosDaCaixa'
import {
  CAMINHO_SOM_CARTA,
  CAMINHO_SOM_SLIDE_CAIXA,
  CAMINHO_SOM_SOMBRIO_LIMPEZA,
  CAMINHO_TOQUE_ENIGMATICO,
} from '../web/src/game/tabuleiro/animacao'
import {
  SOM_CAMINHO_BAQUE_PEAO,
  SOM_CAMINHO_CLIQUE_PEAO,
} from '../web/src/game/tabuleiro/vooDoPeao'
import { CAMINHO_SOM_DE_RECUSA } from '../web/src/components/partida/somDeRecusa'

describe('manifesto de assets da Partida (preload total)', () => {
  it('triplas cobrem os 10 tipos na ordem do useLoader do CorpoTexturizado', () => {
    expect(TRIPLAS_DE_TEXTURA_DAS_PECAS).toHaveLength(10)
    expect(TRIPLAS_DE_TEXTURA_DAS_PECAS).toEqual(
      TIPOS_COM_TEXTURA.map((tipo) => {
        const texturas = TEXTURAS_DAS_PECAS[tipo]
        return [texturas.map, texturas.normalMap, texturas.emissiveMap]
      }),
    )
  })

  it('par do tabuleiro espelha o useLoader das paredes da célula', () => {
    expect(PAR_DE_TEXTURA_DO_TABULEIRO).toEqual([
      TEXTURA_DO_TABULEIRO.map,
      TEXTURA_DO_TABULEIRO.normalMap,
    ])
  })

  it('avulsas têm a Mesa (bundler) + o obscuro da grade', () => {
    expect(typeof URL_DA_MESA).toBe('string')
    expect(URL_DA_MESA).toContain('mesa_topo')
    expect(TEXTURAS_AVULSAS).toEqual([URL_DA_MESA, TEXTURA_OBSCURO_DA_GRADE])
  })

  it('GLBs avulsos cobrem caixa, cesta e os 2 monstros', () => {
    expect(GLBS_AVULSOS).toEqual([
      ...NOMES_DOS_MODELOS_DA_CAIXA.map((nome) => MODELOS_DA_CAIXA[nome]),
      ...Object.values(MODELOS_DE_MONSTRO),
    ])
    expect(GLBS_AVULSOS).toHaveLength(4)
  })

  it('pares de avatares cobrem os 4 slots na ordem do useLoader do PeaoAvatar', () => {
    expect(PARES_DE_AVATARES_POR_SLOT).toHaveLength(4)
    expect(PARES_DE_AVATARES_POR_SLOT).toEqual(
      [0, 1, 2, 3].map((slot) => {
        const config = AVATARES_POR_SLOT.get(slot)
        return [config?.urlAcesa, config?.urlApagada]
      }),
    )
  })

  it('sons cobrem os 7 caminhos dos pontos de áudio, sem duplicatas', () => {
    expect([...SONS_DA_PARTIDA].sort()).toEqual(
      [
        CAMINHO_SOM_CARTA,
        CAMINHO_TOQUE_ENIGMATICO,
        CAMINHO_SOM_SOMBRIO_LIMPEZA,
        CAMINHO_SOM_SLIDE_CAIXA,
        SOM_CAMINHO_CLIQUE_PEAO,
        SOM_CAMINHO_BAQUE_PEAO,
        CAMINHO_SOM_DE_RECUSA,
      ].sort(),
    )
    expect(new Set(SONS_DA_PARTIDA).size).toBe(SONS_DA_PARTIDA.length)
  })

  it('nenhuma URL 3D se repete entre grupos (cada download é único)', () => {
    const todas3D = [
      ...TEXTURAS_AVULSAS,
      ...TRIPLAS_DE_TEXTURA_DAS_PECAS.flat(),
      ...PAR_DE_TEXTURA_DO_TABULEIRO,
      ...GLBS_AVULSOS,
      ...PARES_DE_AVATARES_POR_SLOT.flat(),
    ]
    // 2 avulsas + 30 das peças + 2 do tabuleiro + 4 GLBs + 8 dos peões.
    expect(todas3D).toHaveLength(46)
    expect(new Set(todas3D).size).toBe(todas3D.length)
  })
})
