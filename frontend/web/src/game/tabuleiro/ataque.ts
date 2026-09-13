/**
 * Coreografia do ataque dos monstros (issue #385) — 100% pura.
 *
 * Deriva do `ATAQUE_RESOLVIDO` + modelo PRÉ-despacho a fila sequencial de
 * itens (um por atacante, na ordem de `atacantes`): gesto de disparo antes da
 * reação em cadeia. O Vulto ondula por camadas de distância (Manhattan da
 * célula do monstro, todas as direções em paralelo dentro da camada); o
 * Espectro reage junto nas adjacentes (sem stagger).
 *
 * Reação por peça do alcance: sem peão pula (sem sair da célula); com peão
 * treme junto sem pular; protegido recebe só escudo (sem tremor nem
 * debilitação — a onda percorre a peça normalmente); sem peça, sem reação.
 * `pecasNoAlcance` é observacional/opcional (issue #384): payload legado sem
 * o campo ativa o fallback (sem onda, sem quebra) — sons, fila e bloqueio
 * funcionam igual. Nenhum julgamento de regra no cliente.
 */

import type { AtaqueResolvidoWireEvento } from '@flicker/shared'
import { chaveCelula, type Celula } from './contrato'
import {
  DURACAO_BASE_ATAQUE_MS,
  DURACAO_ATAQUE_POR_ATACANTE_MS,
  DURACAO_ONDA_VULTO_CAMADA_MS,
} from './animacao'

/** Reação visual de uma peça do alcance — só revela, nunca julga. */
export type ReacaoDePecaNoAtaque = 'pulo' | 'tremor' | 'escudo'

export interface PecaReagindoNoAtaque {
  readonly pecaId: string
  readonly reacao: ReacaoDePecaNoAtaque
  /** Camada de distância (Manhattan) da peça do monstro — eixo da onda. */
  readonly camada: number
  /**
   * Atraso da onda até esta peça: Vulto = camada × token (direções em
   * paralelo dentro da camada); Espectro = 0 (adjacentes juntas).
   */
  readonly atrasoMs: number
}

/** Um atacante da fila — ordem de `atacantes` preservada. */
export interface ItemCoreografadoDoAtaque {
  readonly pecaId: string
  readonly tipo: 'vulto' | 'espectro'
  readonly pecasNoAlcance: readonly string[]
  readonly reacoes: readonly PecaReagindoNoAtaque[]
  /** Há atingido deste atacante na chegada → tremida. */
  readonly temAtingido: boolean
  /** Há protegido deste atacante na chegada → defesa (sem tremor). */
  readonly temProtegido: boolean
}

/**
 * Subconjunto do modelo PRÉ-despacho necessário à coreografia (somente
 * leitura): dono de cada peão, posição dos peões e células das peças.
 */
export interface ContextoDaCoreografiaDoAtaque {
  readonly peaoPorJogador: Readonly<Record<string, string>>
  readonly peoes: readonly { readonly peaoId: string; readonly celula: Celula | null }[]
  readonly posicionadas: readonly { readonly pecaId: string; readonly celula: Celula }[]
}

function distanciaManhattan(a: Celula, b: Celula): number {
  return Math.abs(a.linha - b.linha) + Math.abs(a.coluna - b.coluna)
}

/**
 * Duração total da fila com N atacantes (lag deliberado, issue #385):
 * base + N × slot — ~1,3s com 1 monstro, ~1,9s com 2. Zero sem atacantes.
 */
export function duracaoDaFilaDeAtaque(quantidadeDeAtacantes: number): number {
  if (quantidadeDeAtacantes <= 0) return 0
  return DURACAO_BASE_ATAQUE_MS + quantidadeDeAtacantes * DURACAO_ATAQUE_POR_ATACANTE_MS
}

/**
 * Coreografa o ataque em fila sequencial por atacante (ordem de `atacantes`
 * preservada). Estado do jogo aplica na hora no reducer; isto só revela.
 */
export function coreografarAtaque(
  evento: Pick<
    AtaqueResolvidoWireEvento,
    'atacantes' | 'peoesAtingidos' | 'protegidos'
  >,
  contexto: ContextoDaCoreografiaDoAtaque,
): ItemCoreografadoDoAtaque[] {
  const atingidos = new Set(evento.peoesAtingidos)
  const peoesProtegidos = new Set<string>()
  for (const jogadorId of evento.protegidos) {
    const peaoId = contexto.peaoPorJogador[jogadorId]
    if (peaoId !== undefined) peoesProtegidos.add(peaoId)
  }
  const celulaPorPeca = new Map<string, Celula>()
  for (const p of contexto.posicionadas) celulaPorPeca.set(p.pecaId, p.celula)

  return evento.atacantes.map((atacante) => {
    // Fallback legado (rolling deploy / replay sem #384): sem o campo não há
    // onda — o item ainda soa (monstro) e ocupa seu slot na fila.
    const pecasNoAlcance = atacante.pecasNoAlcance ?? []
    const peoesNoAlcance = new Set(atacante.peoesNoAlcance)
    let temAtingido = false
    let temProtegido = false
    for (const peaoId of peoesNoAlcance) {
      if (atingidos.has(peaoId)) temAtingido = true
      if (peoesProtegidos.has(peaoId)) temProtegido = true
    }
    const celulaDoMonstro = celulaPorPeca.get(atacante.pecaId) ?? null
    const reacoes = pecasNoAlcance.map((pecaId, indice) => {
      const celula = celulaPorPeca.get(pecaId) ?? null
      const chave = celula !== null ? chaveCelula(celula) : null
      const peoesNaPeca =
        chave !== null
          ? contexto.peoes.filter((p) => p.celula !== null && chaveCelula(p.celula) === chave)
          : []
      const protegidoAqui = peoesNaPeca.some((p) => peoesProtegidos.has(p.peaoId))
      const reacao: ReacaoDePecaNoAtaque =
        protegidoAqui ? 'escudo' : peoesNaPeca.length > 0 ? 'tremor' : 'pulo'
      // Camada real (Manhattan) quando as duas células são conhecidas;
      // fallback à ordem canônica do engine quando não (sem quebra).
      const camada =
        celulaDoMonstro !== null && celula !== null
          ? distanciaManhattan(celulaDoMonstro, celula)
          : indice
      return {
        pecaId,
        reacao,
        camada,
        atrasoMs: atacante.tipo === 'vulto' ? camada * DURACAO_ONDA_VULTO_CAMADA_MS : 0,
      }
    })
    return {
      pecaId: atacante.pecaId,
      tipo: atacante.tipo,
      pecasNoAlcance,
      reacoes,
      temAtingido,
      temProtegido,
    }
  })
}
