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

// ── Documentos largados na Mesa (páginas 3D via textura, sem GLB) ─────────
// Uma página é uma lâmina fina com a textura no topo (+y); as dimensões
// seguem a proporção exata dos arquivos (medida nos assets):
// - `documento.jpg`: 1295×816 (horizontal) → 7.0 × 4.42 (dobro do vertical).
// - `documento-vertical.jpg`: 880×1206 (vertical) → 2.55 × 3.5.

export type TipoDocumento = 'vertical' | 'horizontal'

function textura(nomeDoArquivo: string): string {
  return `${baseAssets()}assets/textures/${nomeDoArquivo}`
}

/** Texturas das páginas (topo da lâmina, em sRGB fiel ao arquivo). */
export const TEXTURAS_DOS_DOCUMENTOS: Record<TipoDocumento, string> = {
  vertical: textura('documento-vertical.jpg'),
  horizontal: textura('documento.jpg'),
}

/** Documentos com montagem própria (ordem de montagem na cena). */
export const TIPOS_DE_DOCUMENTO: readonly TipoDocumento[] = [
  'vertical',
  'horizontal',
]

/** Resolve a URL da textura de um documento. */
export function texturaDoDocumento(tipo: TipoDocumento): string {
  return TEXTURAS_DOS_DOCUMENTOS[tipo]
}

/** Proporção largura/profundidade da página (espelha o arquivo de textura). */
export const PROPORCAO_DOS_DOCUMENTOS: Record<TipoDocumento, number> = {
  vertical: 880 / 1206,
  horizontal: 1295 / 816,
}

/** Dimensões da lâmina sobre a Mesa (horizontal em dobro: 7.0 de lado). */
export const DIMENSOES_DOS_DOCUMENTOS: Record<
  TipoDocumento,
  { readonly largura: number; readonly profundidade: number }
> = {
  vertical: { largura: 2.55, profundidade: 3.5 },
  horizontal: { largura: 5.0, profundidade: 3.5 },
}

/** Espessura da folha (lâmina fina assentada no plano da Mesa). */
export const ESPESSURA_DO_DOCUMENTO = 0.01

/** Tom das bordas/corte do papel (topo recebe a textura). */
export const COR_BORDA_DO_PAPEL = '#b8b0a0'

/**
 * Páginas espalhadas pela Mesa (ponto único de calibragem via screenshot):
 * cada instância tem tipo, centro e giro próprios — a página "largada" não
 * alinha com os eixos. O `y` empilha folhas sobrepostas (pilha no canto
 * superior esquerdo) sem z-fighting: base em y = 0 só no `y` mínimo.
 */
export interface InstanciaDeDocumento {
  readonly tipo: TipoDocumento
  readonly posicao: readonly [number, number, number]
  readonly rotacaoY: number
}

export const INSTANCIAS_DOS_DOCUMENTOS: readonly InstanciaDeDocumento[] = [
  // Canto superior esquerdo (−x, −z): pilha de 3 verticais.
  // Alturas todas distintas (passo 0.004): folhas sobrepostas nunca têm
  // faces coplanares — sem z-fighting. O passo supera a precisão do depth
  // buffer nessa distância (~0.0002) sem flutuação visível.
  { tipo: 'vertical', posicao: [-7.4, 0.01, -7.2], rotacaoY: 0.35 },
  { tipo: 'vertical', posicao: [-5.1, 0.014, -7.7], rotacaoY: -0.2 },
  { tipo: 'vertical', posicao: [-7.6, 0.018, -5.9], rotacaoY: 0.55 },
  // Sob as algemas: bordas espiando por baixo do modelo.
  { tipo: 'vertical', posicao: [-5.8, 0.022, 8], rotacaoY: 0.2 },
  // Horizontais em dobro (7.0 de lado): só cabem nas faixas norte/sul no
  // sentido do comprimento, giro 0 — a borda escorrega ~0.03 para baixo da
  // borda do tabuleiro (efeito intencional, ver tolerância no validador).
  { tipo: 'horizontal', posicao: [-7, 0.026, 7.78], rotacaoY: -1 },
  { tipo: 'horizontal', posicao: [4.5, 0.03, 9.2], rotacaoY: -0.5 },
  { tipo: 'vertical', posicao: [8.5, 0.034, 7.6], rotacaoY: -0.15 },
]

/**
 * Invariante de layout: páginas dentro da Mesa e fora do tabuleiro.
 *
 * Usa a caixa girada real de cada instância (extensão dos eixos após o
 * `rotacaoY`), não uma margem única: folhas grandes em giro 0 usam a
 * pegada exata. Tolera até 0.05 de escorregão para baixo da borda do
 * tabuleiro (efeito intencional das folhas grandes — a borda some sob a
 * base das peças, como papel enfiado sob o tabuleiro).
 */
export function validarPosicaoDosDocumentos(): string | null {
  const TOLERANCIA_ESCORREGAO = 0.05
  for (const [indice, instancia] of INSTANCIAS_DOS_DOCUMENTOS.entries()) {
    const [x, y, z] = instancia.posicao
    const { largura, profundidade } = DIMENSOES_DOS_DOCUMENTOS[instancia.tipo]
    const cosseno = Math.abs(Math.cos(instancia.rotacaoY))
    const seno = Math.abs(Math.sin(instancia.rotacaoY))
    const meiaExtensaoX = (largura * cosseno + profundidade * seno) / 2
    const meiaExtensaoZ = (largura * seno + profundidade * cosseno) / 2
    if (
      Math.abs(x) + meiaExtensaoX > LARGURA_MESA / 2 ||
      Math.abs(z) + meiaExtensaoZ > PROFUNDIDADE_MESA / 2
    ) {
      return `Documento ${indice} deve ficar dentro da Mesa`
    }
    if (
      Math.abs(x) - meiaExtensaoX < LARGURA_TABULEIRO / 2 - TOLERANCIA_ESCORREGAO &&
      Math.abs(z) - meiaExtensaoZ < PROFUNDIDADE_TABULEIRO / 2 - TOLERANCIA_ESCORREGAO
    ) {
      return `Documento ${indice} deve ficar fora do tabuleiro`
    }
    if (y < ESPESSURA_DO_DOCUMENTO / 2) {
      return `Documento ${indice} deve ficar sobre o plano da Mesa`
    }
    if (!Number.isFinite(instancia.rotacaoY)) {
      return `Documento ${indice} deve ter giro válido`
    }
  }
  return null
}
