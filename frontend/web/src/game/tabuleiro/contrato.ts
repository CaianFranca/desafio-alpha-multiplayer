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

// ── Tipos de domínio visual (espelha engine/shared) ──

export type TipoDaPeca = 'inicial' | 'reta' | 'T' | 'cruz'
export type Orientacao = 0 | 90 | 180 | 270
export type BordaCardinal = 'norte' | 'leste' | 'sul' | 'oeste'

export interface Celula {
  readonly linha: number
  readonly coluna: number
}

export interface PecaDaReserva {
  readonly pecaId: string
  readonly tipo: TipoDaPeca
  readonly orientacao: Orientacao
}

export interface PecaPosicionada {
  readonly pecaId: string
  readonly tipo: TipoDaPeca
  readonly orientacao: Orientacao
  readonly celula: Celula
}

export interface EstadoExibicaoTabuleiro {
  readonly reserva: readonly PecaDaReserva[]
  readonly posicionadas: readonly PecaPosicionada[]
}

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

/**
 * Mock de exibição para `disponivel`: caminho básico de 5 peças
 * contíguas com orientações que fazem os caminhos se tocarem —
 * Inicial L + Reta H + Cruz + Reta V + T, formando encaixe visível.
 */
export function criarEstadoExibicaoMock(): EstadoExibicaoTabuleiro {
  const reserva = criarReservaInicial()
  const posicionadas: PecaPosicionada[] = [
    {
      pecaId: 'posicionada-inicial-1',
      tipo: 'inicial',
      orientacao: 0,
      celula: { linha: 3, coluna: 3 },
    },
    {
      pecaId: 'posicionada-reta-2',
      tipo: 'reta',
      orientacao: 90,
      celula: { linha: 3, coluna: 4 },
    },
    {
      pecaId: 'posicionada-cruz-3',
      tipo: 'cruz',
      orientacao: 0,
      celula: { linha: 3, coluna: 5 },
    },
    {
      pecaId: 'posicionada-reta-4',
      tipo: 'reta',
      orientacao: 0,
      celula: { linha: 4, coluna: 5 },
    },
    {
      pecaId: 'posicionada-t-5',
      tipo: 'T',
      orientacao: 180,
      celula: { linha: 2, coluna: 5 },
    },
  ]
  return { reserva, posicionadas }
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

export function mundoParaCelula(
  mundoX: number,
  mundoZ: number,
): Celula | null {
  const colunaRaw = Math.round((mundoX - POSICAO_TABULEIRO[0]) / TAMANHO_CELULA + Math.floor(LADO_DA_GRADE / 2))
  const linhaRaw = Math.round((mundoZ - POSICAO_TABULEIRO[2]) / TAMANHO_CELULA + Math.floor(LADO_DA_GRADE / 2))
  if (Number.isNaN(colunaRaw) || Number.isNaN(linhaRaw)) return null
  const coluna = colunaRaw === 0 ? 0 : colunaRaw
  const linha = linhaRaw === 0 ? 0 : linhaRaw
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
