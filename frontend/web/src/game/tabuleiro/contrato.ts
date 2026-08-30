/**
 * Contrato puro de geometria do tabuleiro (issue #83).
 *
 * Usa a origem do ambiente ([0,0,0] no centro do plano superior da Mesa,
 * ver `game/ambiente/contrato.ts`) e é 100% puro: sem three.js/DOM.
 * Centraliza dimensões, mapeamento célula↔mundo e posições do tabuleiro e
 * da reserva sobre a Mesa.
 */

import { LARGURA_MESA } from '../ambiente/contrato'

export const LADO_DA_GRADE = 7

/** Lado de uma célula em unidades de mundo (quadrada). */
export const TAMANHO_CELULA = 1.6

export const LARGURA_TABULEIRO = LADO_DA_GRADE * TAMANHO_CELULA
export const PROFUNDIDADE_TABULEIRO = LADO_DA_GRADE * TAMANHO_CELULA

/** Altura acima do plano da Mesa para evitar z-fighting. */
export const ALTURA_TABULEIRO = 0.02
export const ALTURA_RESERVA = 0.02

/** Tabuleiro centralizado sobre a Mesa. */
export const POSICAO_TABULEIRO: readonly [number, number, number] = [
  0,
  ALTURA_TABULEIRO,
  0,
]

/** Reserva lateral: offset +X a partir do centro. */
export const OFFSET_RESERVA_X = 8.0
export const POSICAO_RESERVA: readonly [number, number, number] = [
  OFFSET_RESERVA_X,
  ALTURA_RESERVA,
  0,
]

/** Layout da reserva em grade local. */
export const COLUNAS_RESERVA = 2
export const ESPACAMENTO_RESERVA = 1.7

export const CELULA_INSET = TAMANHO_CELULA * 0.98
export const ESPESSURA_BORDA = 0.04
export const BORDA_OFFSET = 0.02
export const BORDA_Y = 0.01
export const COR_BORDA_CELULA = '#f2e0b6'
export const CELULA_Y_BASE = 0.012
export const CELULA_Y_BORDA = 0.018
export const PECA_Y = 0.02
export type PecaId = string

// ── Tipos de domínio visual (espelha engine/shared) ──

export type TipoDaPeca = 'inicial' | 'reta' | 'T' | 'cruz'
export type Orientacao = 0 | 90 | 180 | 270
export type BordaCardinal = 'norte' | 'leste' | 'sul' | 'oeste'

export interface Celula {
  readonly linha: number
  readonly coluna: number
}

export interface PecaDaReserva {
  readonly pecaId: PecaId
  readonly tipo: TipoDaPeca
  readonly orientacao: Orientacao
}

export interface PecaPosicionada {
  readonly pecaId: PecaId
  readonly tipo: TipoDaPeca
  readonly orientacao: Orientacao
  readonly celula: Celula
}

// ── Peões (issue #90 — ST-10) ──

export type PeaoId = string

/** Cores canônicas espelham `CorDoPeao` do engine (branco|vermelho|azul|amarelo). */
export type CorDoPeao = 'branco' | 'vermelho' | 'azul' | 'amarelo'

/**
 * Peão na projeção de exibição: `celula` é a célula da peça sobre a qual o
 * peão está posicionado; `null` significa sobre a Mesa (fora do tabuleiro).
 */
export interface PeaoDaExibicao {
  readonly peaoId: PeaoId
  readonly cor: CorDoPeao
  readonly celula: Celula | null
}

export interface EstadoExibicaoTabuleiro {
  readonly reserva: readonly PecaDaReserva[]
  readonly posicionadas: readonly PecaPosicionada[]
  readonly peoes: readonly PeaoDaExibicao[]
}

/** 4 Peões, um por cor; ordem espelha `CORES_DOS_PEOES` do engine. */
export const QUANTIDADE_PEOES = 4

export const CORES_DOS_PEOES: readonly CorDoPeao[] = [
  'branco',
  'vermelho',
  'azul',
  'amarelo',
]

/** Hex placeholder por cor (arte final substitui o placeholder, não os ids). */
export const HEX_COR_PEAO: Record<CorDoPeao, string> = {
  branco: '#f2efe6',
  vermelho: '#c0392b',
  azul: '#2e6bd6',
  amarelo: '#f1c40f',
}

/**
 * Y local (no grupo da célula) da base do peão sobre a peça. Deriva da
 * geometria do PecaPlaceholder: PECA_Y (0.02) + centro da caixa (0.08) +
 * meia espessura (0.06) = topo da peça em 0.16.
 */
export const PEAO_Y = PECA_Y + 0.14

/**
 * Fileira dos peões não posicionados sobre a Mesa: lado oposto à reserva
 * (-X; reserva fica em +X). Altura y = 0 (plano superior da Mesa).
 */
export const OFFSET_FILEIRA_PEOES_X = -8.0
export const ESPACAMENTO_PEAO_MESA = ESPACAMENTO_RESERVA

// ── Composição inicial da reserva (4 + 6 + 6 + 6 = 22) ──

const COMPOSICAO_RESERVA: readonly { tipo: TipoDaPeca; quantidade: number }[] = [
  { tipo: 'inicial', quantidade: 4 },
  { tipo: 'reta', quantidade: 6 },
  { tipo: 'T', quantidade: 6 },
  { tipo: 'cruz', quantidade: 6 },
]

export const TOTAL_RESERVA = COMPOSICAO_RESERVA.reduce((s, e) => s + e.quantidade, 0)

export function criarReservaInicial(): PecaDaReserva[] {
  const reserva: PecaDaReserva[] = []
  for (const entrada of COMPOSICAO_RESERVA) {
    for (let i = 1; i <= entrada.quantidade; i++) {
      reserva.push({
        pecaId: `${entrada.tipo.toLowerCase()}-${i}`,
        tipo: entrada.tipo,
        orientacao: 0,
      })
    }
  }
  return reserva
}

export function chaveCelula(celula: Celula): string {
  return `${celula.linha}:${celula.coluna}`
}

export function dimensaoReserva(linhas: number): { largura: number; profundidade: number } {
  return {
    largura: COLUNAS_RESERVA * ESPACAMENTO_RESERVA + 0.4,
    profundidade: linhas * ESPACAMENTO_RESERVA + 0.4,
  }
}



// ── Bordas abertas por tipo/orientação (visual do placeholder) ──

const BORDAS_BASE: Record<TipoDaPeca, readonly BordaCardinal[]> = {
  inicial: ['norte', 'leste'],
  reta: ['norte', 'sul'],
  T: ['norte', 'leste', 'oeste'],
  cruz: ['norte', 'leste', 'sul', 'oeste'],
}

const ORDEM_CANONICA: readonly BordaCardinal[] = ['norte', 'leste', 'sul', 'oeste']

const ROTACAO_HORARIA: Record<BordaCardinal, BordaCardinal> = {
  norte: 'leste',
  leste: 'sul',
  sul: 'oeste',
  oeste: 'norte',
}

export function bordasAbertas(peca: Pick<PecaDaReserva, 'tipo' | 'orientacao'>): BordaCardinal[] {
  let bordas = BORDAS_BASE[peca.tipo] as BordaCardinal[]
  const passos = (peca.orientacao / 90) % 4
  for (let i = 0; i < passos; i++) {
    bordas = bordas.map((b) => ROTACAO_HORARIA[b])
  }
  return ORDEM_CANONICA.filter((b) => bordas.includes(b))
}

// ── Mapeamento célula ↔ mundo ──

export function celulaParaMundo(celula: Celula): [number, number, number] {
  const x = (celula.coluna - Math.floor(LADO_DA_GRADE / 2)) * TAMANHO_CELULA
  const z = (celula.linha - Math.floor(LADO_DA_GRADE / 2)) * TAMANHO_CELULA
  return [POSICAO_TABULEIRO[0] + x, POSICAO_TABULEIRO[1], POSICAO_TABULEIRO[2] + z]
}

function normalizarZero(n: number): number {
  return n === 0 ? 0 : n
}

export function mundoParaCelula(
  mundoX: number,
  mundoZ: number,
): Celula | null {
  const colunaRaw = Math.round((mundoX - POSICAO_TABULEIRO[0]) / TAMANHO_CELULA + Math.floor(LADO_DA_GRADE / 2))
  const linhaRaw = Math.round((mundoZ - POSICAO_TABULEIRO[2]) / TAMANHO_CELULA + Math.floor(LADO_DA_GRADE / 2))
  if (Number.isNaN(colunaRaw) || Number.isNaN(linhaRaw)) return null
  const coluna = normalizarZero(colunaRaw)
  const linha = normalizarZero(linhaRaw)
  if (linha < 0 || linha >= LADO_DA_GRADE || coluna < 0 || coluna >= LADO_DA_GRADE) {
    return null
  }
  return { linha, coluna }
}

// ── Reserva: índice → mundo ──

export function reservaIndiceParaLocal(indice: number): [number, number, number] {
  const linhas = Math.ceil(TOTAL_RESERVA / COLUNAS_RESERVA)
  const col = indice % COLUNAS_RESERVA
  const row = Math.floor(indice / COLUNAS_RESERVA)
  const localX = (col - (COLUNAS_RESERVA - 1) / 2) * ESPACAMENTO_RESERVA
  const localZ = (row - (linhas - 1) / 2) * ESPACAMENTO_RESERVA
  return [localX, 0, localZ]
}

export function reservaIndiceParaMundo(indice: number): [number, number, number] {
  const [lx, ly, lz] = reservaIndiceParaLocal(indice)
  return [POSICAO_RESERVA[0] + lx, POSICAO_RESERVA[1] + ly, POSICAO_RESERVA[2] + lz]
}

// ── Helpers de layout ──
export function todasAsCelulas(): Celula[] {
  const out: Celula[] = []
  for (let linha = 0; linha < LADO_DA_GRADE; linha++) {
    for (let coluna = 0; coluna < LADO_DA_GRADE; coluna++) {
      out.push({ linha, coluna })
    }
  }
  return out
}

// Validação de invariante: tabuleiro < Mesa
export function validarDimensoes(): string | null {
  if (LARGURA_TABULEIRO >= LARGURA_MESA || PROFUNDIDADE_TABULEIRO >= LARGURA_MESA) {
    return 'Tabuleiro deve ser menor que a Mesa'
  }
  return null
}

// ── Conexões e seleção de peões (issue #90 — espelho visual do engine) ──
//
// Espelha `vizinhasConectadas` de packages/engine/src/peoes.ts: para cada
// borda aberta da origem, a célula vizinha na direção; a vizinha está
// conectada quando tem a borda oposta aberta. O frontend NÃO importa o
// engine: esta é a projeção de exibição da mesma regra.

const BORDA_OPOSTA: Record<BordaCardinal, BordaCardinal> = {
  norte: 'sul',
  sul: 'norte',
  leste: 'oeste',
  oeste: 'leste',
}

// Deslocamento idêntico ao engine: norte {linha:-1}, leste {coluna:+1},
// sul {linha:+1}, oeste {coluna:-1}.
const DESLOCAMENTO_DA_BORDA: Record<BordaCardinal, Celula> = {
  norte: { linha: -1, coluna: 0 },
  leste: { linha: 0, coluna: 1 },
  sul: { linha: 1, coluna: 0 },
  oeste: { linha: 0, coluna: -1 },
}

export function estaDentroDaGrade(celula: Celula): boolean {
  return (
    Number.isInteger(celula.linha) &&
    Number.isInteger(celula.coluna) &&
    celula.linha >= 0 &&
    celula.linha < LADO_DA_GRADE &&
    celula.coluna >= 0 &&
    celula.coluna < LADO_DA_GRADE
  )
}

export function encontrarPecaNaCelula(
  posicionadas: readonly PecaPosicionada[],
  celula: Celula,
): PecaPosicionada | null {
  const chave = chaveCelula(celula)
  return posicionadas.find((p) => chaveCelula(p.celula) === chave) ?? null
}

/** Vizinhas conectadas à peça de origem (ordem canônica norte→leste→sul→oeste). */
export function vizinhasConectadas(
  posicionadas: readonly PecaPosicionada[],
  origem: PecaPosicionada,
): PecaPosicionada[] {
  const conectadas: PecaPosicionada[] = []
  for (const borda of bordasAbertas(origem)) {
    const delta = DESLOCAMENTO_DA_BORDA[borda]
    const celulaVizinha: Celula = {
      linha: origem.celula.linha + delta.linha,
      coluna: origem.celula.coluna + delta.coluna,
    }
    if (!estaDentroDaGrade(celulaVizinha)) continue
    const vizinha = encontrarPecaNaCelula(posicionadas, celulaVizinha)
    if (!vizinha || !bordasAbertas(vizinha).includes(BORDA_OPOSTA[borda])) {
      continue
    }
    conectadas.push(vizinha)
  }
  return conectadas
}

/** Estado de seleção do peão na cena (estado visual local, não regra). */
export interface SelecaoDePeao {
  readonly peaoId: PeaoId
  readonly celula: Celula
  readonly pecaId: PecaId
}

/**
 * Resolve a seleção de um peão clicado: `null` quando o peão não existe ou
 * está sobre a Mesa (sem peça sob ele) — seleção de peão não posicionado não
 * gera conexões destacadas.
 */
export function selecionarPeaoNaExibicao(
  estado: Pick<EstadoExibicaoTabuleiro, 'posicionadas' | 'peoes'>,
  peaoId: PeaoId,
): SelecaoDePeao | null {
  const peao = estado.peoes.find((p) => p.peaoId === peaoId)
  if (!peao || peao.celula === null) return null
  const peca = encontrarPecaNaCelula(estado.posicionadas, peao.celula)
  if (!peca) return null
  return { peaoId: peao.peaoId, celula: peao.celula, pecaId: peca.pecaId }
}

/**
 * Destinos válidos do peão selecionado: vizinhas conectadas cuja célula não
 * está ocupada por outro peão (máx. 1 peão por peça). Espelha a aceitação de
 * `mover_peao` do engine (conectada + sem PECA_JA_TEM_PEAO).
 */
export function destinosConectadosDoPeao(
  posicionadas: readonly PecaPosicionada[],
  peoes: readonly PeaoDaExibicao[],
  peaoId: PeaoId,
): PecaPosicionada[] {
  const peao = peoes.find((p) => p.peaoId === peaoId)
  if (!peao || peao.celula === null) return []
  const origem = encontrarPecaNaCelula(posicionadas, peao.celula)
  if (!origem) return []
  const ocupadasPorOutroPeao = new Set(
    peoes.flatMap((p) =>
      p.peaoId !== peaoId && p.celula !== null ? [chaveCelula(p.celula)] : [],
    ),
  )
  return vizinhasConectadas(posicionadas, origem).filter(
    (p) => !ocupadasPorOutroPeao.has(chaveCelula(p.celula)),
  )
}

/** Posição mundo da fileira de peões sobre a Mesa (índice = posição em `peoes`). */
export function peaoMesaParaMundo(indice: number): [number, number, number] {
  const z = (indice - (QUANTIDADE_PEOES - 1) / 2) * ESPACAMENTO_PEAO_MESA
  return [OFFSET_FILEIRA_PEOES_X, 0, z]
}
