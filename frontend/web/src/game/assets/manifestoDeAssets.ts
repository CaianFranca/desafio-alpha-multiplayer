/**
 * Manifesto de assets da Partida (preload total antes da revelação).
 *
 * Agrega num ponto único TODAS as URLs que a cena 3D e os pontos de som
 * baixam — antes espalhadas pelos componentes (`useLoader` por montagem) e
 * pelos pontos de áudio (`new Audio` no momento do toque). O preload
 * (`preloadDeAssets.ts`) percorre estas listas; o gate da `PartidaPage` só
 * revela o jogo quando tudo assentou (baixado ou falhado — falha abre com
 * fallback, nunca trava).
 *
 * REGRA DE OURO — forma das chamadas: os grupos abaixo espelham EXATAMENTE
 * as chamadas `useLoader` dos componentes (mesmo loader + mesma forma do
 * input: avulso, par ou tripla), porque a chave de cache do R3F
 * (suspend-react) é `[loader, ...urls]`. Mudar a ordem/forma aqui sem mudar
 * lá (ou vice-versa) quebra o cache e causa download duplo:
 * - tripla `[map, normalMap, emissiveMap]` = `PecaPlaceholder.tsx` (CorpoTexturizado);
 * - par `[map, normalMap]` = `Celula.tsx` (useTexturasDaParede);
 * - avulsos de textura = Mesa (`AmbienteCena.tsx`), plano da célula
 *   (`Celula.tsx`) e albedo da cesta (`Caixa.tsx`, mesma URL do obscuro);
 * - GLBs avulsos = `Caixa.tsx` (caixa/cesta) e `MonstroAvatar.tsx`;
 * - pares `[acesa, apagada]` por slot = `PeaoAvatar.tsx`.
 *
 * Seam puro: só URLs e agrupamento, sem three.js/DOM/fetch — testável em
 * jsdom. As fontes de verdade continuam nos módulos de origem (este arquivo
 * só agrega); adicionar um asset novo à cena = adicionar a URL no módulo de
 * origem E neste manifesto.
 */

import mesaTopoUrl from './mesa_topo.jpg'
import {
  TEXTURA_OBSCURO_DA_GRADE,
  TEXTURAS_DAS_PECAS,
  TIPOS_COM_TEXTURA,
} from '../tabuleiro/texturasDasPecas'
import { TEXTURA_DO_TABULEIRO } from '../tabuleiro/texturasDoTabuleiro'
import { AVATARES_POR_SLOT } from '../tabuleiro/avatares'
import { MODELOS_DE_MONSTRO } from '../tabuleiro/monstros'
import {
  MODELOS_DA_CAIXA,
  NOMES_DOS_MODELOS_DA_CAIXA,
} from '../tabuleiro/modelosDaCaixa'
import {
  CAMINHO_SOM_CARTA,
  CAMINHO_SOM_SLIDE_CAIXA,
  CAMINHO_SOM_SOMBRIO_LIMPEZA,
  CAMINHO_TOQUE_ENIGMATICO,
} from '../tabuleiro/animacao'
import {
  SOM_CAMINHO_BAQUE_PEAO,
  SOM_CAMINHO_CLIQUE_PEAO,
} from '../tabuleiro/vooDoPeao'
import { CAMINHO_SOM_DE_RECUSA } from '../../components/partida/somDeRecusa'

/** Textura do topo da Mesa (mesma URL do bundler usada em `AmbienteCena`). */
export const URL_DA_MESA: string = mesaTopoUrl

/**
 * Triplas `[map, normalMap, emissiveMap]` dos 10 tipos de peça, na mesma
 * ordem de `useLoader` do `CorpoTexturizado` (`PecaPlaceholder.tsx`).
 */
export const TRIPLAS_DE_TEXTURA_DAS_PECAS: ReadonlyArray<
  readonly [string, string, string]
> = TIPOS_COM_TEXTURA.map((tipo) => {
  const texturas = TEXTURAS_DAS_PECAS[tipo]
  return [texturas.map, texturas.normalMap, texturas.emissiveMap] as const
})

/**
 * Par `[map, normalMap]` das paredes do grid, na mesma ordem de `useLoader`
 * do `useTexturasDaParede` (`Celula.tsx`).
 */
export const PAR_DE_TEXTURA_DO_TABULEIRO: readonly [string, string] = [
  TEXTURA_DO_TABULEIRO.map,
  TEXTURA_DO_TABULEIRO.normalMap,
]

/**
 * Texturas avulsas (`useLoader` single): topo da Mesa + fundo `obscuro` da
 * grade. O `obscuro` é a MESMA URL do albedo da cesta (`Caixa.tsx`) — uma
 * entrada só cobre os dois usos (mesma chave de cache).
 */
export const TEXTURAS_AVULSAS: readonly string[] = [
  URL_DA_MESA,
  TEXTURA_OBSCURO_DA_GRADE,
]

/** GLBs avulsos (`useLoader` single): caixa + cesta + os 2 monstros. */
export const GLBS_AVULSOS: readonly string[] = [
  ...NOMES_DOS_MODELOS_DA_CAIXA.map((nome) => MODELOS_DA_CAIXA[nome]),
  ...Object.values(MODELOS_DE_MONSTRO),
]

/**
 * Pares `[acesa, apagada]` dos 4 slots de peão, na mesma ordem de `useLoader`
 * do `PeaoAvatar.tsx` (ordem de slot crescente = ordem de entrada).
 */
export const PARES_DE_AVATARES_POR_SLOT: ReadonlyArray<
  readonly [string, string]
> = [...AVATARES_POR_SLOT.entries()]
  .sort(([slotA], [slotB]) => slotA - slotB)
  .map(([, config]) => [config.urlAcesa, config.urlApagada] as const)

/**
 * Sons da partida (duto `/media/`): carta do giro, toque enigmático do
 * movimento, som sombrio da limpeza, slide da caixa, clique/baque do peão e
 * som de recusa. Sem duplicatas. (Um caminho pode não ter arquivo commitado
 * — ex.: slide da caixa — e assenta como falha silenciosa no aquecimento.)
 */
export const SONS_DA_PARTIDA: readonly string[] = [
  ...new Set([
    CAMINHO_SOM_CARTA,
    CAMINHO_TOQUE_ENIGMATICO,
    CAMINHO_SOM_SOMBRIO_LIMPEZA,
    CAMINHO_SOM_SLIDE_CAIXA,
    SOM_CAMINHO_CLIQUE_PEAO,
    SOM_CAMINHO_BAQUE_PEAO,
    CAMINHO_SOM_DE_RECUSA,
  ]),
]
