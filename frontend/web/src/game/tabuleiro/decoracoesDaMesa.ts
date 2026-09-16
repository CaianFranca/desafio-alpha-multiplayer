/**
 * Decorações da Mesa (objetos 3D puramente visuais, sem regra).
 *
 * Seam puro: `vela | algemas → URL` dos GLBs commitados em
 * `web/public/assets/3d-models/` (servido sob
 * `import.meta.env.BASE_URL + assets/3d-models/…`, empacotado no `dist` via
 * `publicDir` — ver `frontend/vite.config.ts`). Sem three.js/DOM: só URLs,
 * posições e o ajuste fino de normalização — testável em jsdom.
 *
 * A cena é projeção idempotente: as decorações nunca interceptam clique,
 * nunca entram no wire e nunca alteram o contrato do tabuleiro/Caixa.
 * Orientação/escala/posição finas ficam para feedback humano via screenshot:
 * `AJUSTES_DAS_DECORACOES` + `POSICOES_DAS_DECORACOES` são os pontos únicos
 * de ajuste, sem tocar no contrato nem no componente.
 */

import { LARGURA_MESA, PROFUNDIDADE_MESA } from '../ambiente/contrato'
import {
  LARGURA_TABULEIRO,
  PROFUNDIDADE_TABULEIRO,
  OFFSET_FILEIRA_PEOES_X,
  POSICAO_CAIXA,
} from './contrato'

export type NomeDaDecoracao = 'vela' | 'algemas'

function baseAssets(): string {
  const base = import.meta.env.BASE_URL ?? '/'
  return base.endsWith('/') ? base : `${base}/`
}

function modelo(nomeDoArquivo: string): string {
  return `${baseAssets()}assets/3d-models/${nomeDoArquivo}`
}

/** URLs dos GLBs decorativos (um por objeto de cena). */
export const MODELOS_DAS_DECORACOES: Record<NomeDaDecoracao, string> = {
  vela: modelo('vela.glb'),
  algemas: modelo('algemas.glb'),
}

/** Decorações com visual próprio (ordem de montagem na cena). */
export const NOMES_DAS_DECORACOES: readonly NomeDaDecoracao[] = [
  'vela',
  'algemas',
]

/** Resolve a URL do GLB de uma decoração da Mesa. */
export function modeloDaDecoracao(nome: NomeDaDecoracao): string {
  return MODELOS_DAS_DECORACOES[nome]
}

/**
 * Ajuste fino pós-normalização, por decoração — ponto único para o feedback
 * humano de orientação/escala (via screenshot):
 * - `escala`: multiplicador sobre a escala uniforme que cabe o modelo na
 *   pegada (`LARGURA/PROFUNDIDADE_DECORACAO`).
 * - `rotacaoY`: giro em radianos aplicado DEPOIS da normalização (não muda a
 *   pegada calculada; só a apresentação).
 */
export interface AjusteDaDecoracao {
  readonly escala: number
  readonly rotacaoY: number
}

export const AJUSTES_DAS_DECORACOES: Record<
  NomeDaDecoracao,
  AjusteDaDecoracao
> = {
  // Vela contida junto à Caixa: cabe na pegada de 1.2×1.2 sem excedente.
  // Calibrar via screenshot (posição primeiro, tamanho depois).
  vela: { escala: 3, rotacaoY: 3.6 },
  // Algemas no canto inferior esquerdo: ponto de partida contido (×1, sem
  // giro) para calibrar via screenshot.
  algemas: { escala: 3, rotacaoY: 1 },
}

/** Pegada de normalização da vela sobre a Mesa (contida, sem excedente). */
export const VELA_LARGURA = 1.2
export const VELA_PROFUNDIDADE = 1.2

/** Pegada de normalização das algemas sobre a Mesa (contida, sem excedente). */
export const ALGEMAS_LARGURA = 1.6
export const ALGEMAS_PROFUNDIDADE = 1.6

/**
 * Posição da base da vela sobre a Mesa (centro da pegada, y = 0 no plano
 * superior): a noroeste da Caixa (`POSICAO_CAIXA = [8.0, 0.02, -5.0]` —
 * noroeste = x menor, z menor), fora do tabuleiro central (11.2×11.2) e
 * dentro da Mesa 20×20.
 */
export const POSICAO_VELA: readonly [number, number, number] = [4.79, 0, -7.4]

/**
 * Posição da base das algemas sobre a Mesa (centro da pegada, y = 0 no plano
 * superior): canto inferior esquerdo da tela (−x, +z — a câmera olha de +z
 * para a origem), fora do tabuleiro central e longe da fileira de peões
 * (x = −8, faixa central em z).
 */
export const POSICAO_ALGEMAS: readonly [number, number, number] = [
  -7.0,
  0,
  7.2,
]

/** Posições das decorações (base em y = 0, plano superior da Mesa). */
export const POSICOES_DAS_DECORACOES: Record<
  NomeDaDecoracao,
  readonly [number, number, number]
> = {
  vela: POSICAO_VELA,
  algemas: POSICAO_ALGEMAS,
}

/**
 * Ponto de luz da chama, por decoração (só a vela tem): `pointLight` quente
 * e contido no topo do modelo — simula o brilho da chama sem lavar a cena.
 * Ponto único de calibragem via screenshot:
 * - `cor`: amarelo quente da chama.
 * - `intensidade`: perceptível na base da vela e na Caixa vizinha
 *   (unidades físicas do three atual, decaimento 2 — a poça de luz cai
 *   com o quadrado da distância).
 * - `distancia`: corte do alcance — cobre a base da vela e a Caixa (~4
 *   unidades), sem atravessar a cena.
 * - `folgaAcimaDoTopo`: altura da lâmpada acima do topo do bounding box
 *   normalizado (o topo deriva da escala — acompanha `AJUSTES` sozinho).
 * - `sombra`: sombra projetada (`null` = luz sem sombra).
 */
export interface LuzDaChama {
  readonly cor: string
  readonly intensidade: number
  readonly distancia: number
  readonly decaimento: number
  readonly folgaAcimaDoTopo: number
  readonly sombra: SombraDaChama | null
}

/**
 * Sombra projetada do ponto de luz (`pointLight.shadow`, cube map): a chama
 * passa a reagir aos elementos ao redor — Caixa, peças e peões projetam
 * sombra sob a luz da vela. Sem passes extras além do re-render sob demanda.
 * - `tamanhoDoMapa`: resolução por face do cubo (qualidade × custo — cada
 *   re-render desenha a cena 6 vezes para este mapa).
 * - `near`: a chama/pavio colados na lâmpada não projetam (sem artefato).
 * - `far`: alcance da sombra — acompanha `distancia` da luz.
 * - `bias`: conservador contra acne, no padrão da direcional da cena.
 */
export interface SombraDaChama {
  readonly tamanhoDoMapa: number
  readonly near: number
  readonly far: number
  readonly bias: number
}

export const LUZ_DA_CHAMA_POR_DECORACAO: Record<
  NomeDaDecoracao,
  LuzDaChama | null
> = {
  vela: {
    cor: '#ffc46b',
    intensidade: 18,
    distancia: 10,
    decaimento: 1,
    folgaAcimaDoTopo: 0.2,
    sombra: {
      tamanhoDoMapa: 1024,
      near: 0.3,
      far: 15,
      bias: -0.004,
    },
  },
  // Sem chama: sem ponto de luz.
  algemas: null,
}

/** Config do ponto de luz da chama (`null` = decoração sem chama). */
export function luzDaChama(nome: NomeDaDecoracao): LuzDaChama | null {
  return LUZ_DA_CHAMA_POR_DECORACAO[nome]
}

/**
 * Escala efetiva pós-ajuste (mesma semântica de `escalaEfetivaDoModelo` da
 * Caixa): multiplicador sobre a escala de encaixe `Math.min` da pegada, sem
 * clamp — o excedente seria intencional, mas a vela nasce contida (×1).
 *
 * Pura (sem three.js/DOM): `tamanho` é a dimensão do `Box3` do clone antes
 * da escala; a rotação Y afeta só a apresentação, não a escala.
 */
export function escalaEfetivaDaDecoracao(
  largura: number,
  profundidade: number,
  tamanho: { readonly x: number; readonly y: number; readonly z: number },
  ajuste: AjusteDaDecoracao,
): number {
  const base = Math.min(
    largura / (tamanho.x || 1),
    profundidade / (tamanho.z || 1),
  )
  return base * ajuste.escala
}

/** Invariante de layout: vela dentro da Mesa, fora do tabuleiro, a NO da Caixa. */
export function validarPosicaoDaVela(): string | null {  const [x, , z] = POSICAO_VELA
  if (
    Math.abs(x) > LARGURA_MESA / 2 ||
    Math.abs(z) > PROFUNDIDADE_MESA / 2
  ) {
    return 'Vela deve ficar dentro da Mesa'
  }
  if (
    Math.abs(x) < LARGURA_TABULEIRO / 2 &&
    Math.abs(z) < PROFUNDIDADE_TABULEIRO / 2
  ) {
    return 'Vela deve ficar fora do tabuleiro'
  }
  const [caixaX, , caixaZ] = POSICAO_CAIXA
  if (!(x < caixaX && z < caixaZ)) {
    return 'Vela deve ficar a noroeste da Caixa'
  }
  return null
}

/** Invariante de layout: algemas no canto inferior esquerdo, livres. */
export function validarPosicaoDasAlgemas(): string | null {
  const [x, , z] = POSICAO_ALGEMAS
  if (
    Math.abs(x) > LARGURA_MESA / 2 ||
    Math.abs(z) > PROFUNDIDADE_MESA / 2
  ) {
    return 'Algemas devem ficar dentro da Mesa'
  }
  if (
    Math.abs(x) < LARGURA_TABULEIRO / 2 &&
    Math.abs(z) < PROFUNDIDADE_TABULEIRO / 2
  ) {
    return 'Algemas devem ficar fora do tabuleiro'
  }
  // Canto inferior esquerdo da tela: −x (esquerda), +z (frente/câmera).
  if (!(x < 0 && z > 0)) {
    return 'Algemas devem ficar no canto inferior esquerdo'
  }
  // Longe da fileira de peões (x = −8, faixa central em z): perto em x SÓ
  // vale com z bem afastado do centro.
  if (Math.abs(x - OFFSET_FILEIRA_PEOES_X) < 2 && Math.abs(z) < 4.5) {
    return 'Algemas devem ficar longe da fileira de peões'
  }
  return null
}
