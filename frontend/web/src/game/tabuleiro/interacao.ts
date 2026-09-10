/**
 * Interação pura do Tabuleiro (issue #84 — ST-09).
 *
 * Módulo 100% puro: mapeia cliques simples → comandos wire (UPPER_SNAKE em
 * `@flicker/shared`). Sem Three.js, sem DOM, sem estado interno — todo estado
 * vem do chamador (extraído do store/WS). O feedback de erro/rejeição vive no
 * ponto de som de recusa da Partida (`components/partida/somDeRecusa.ts`,
 * issue #228) — este módulo não emite feedback visual nem sonoro.
 *
 * Contrato wire ↔ domínio documentado em `packages/shared/src/tabuleiro.ts`:
 *   shared SELECIONAR_PECA  ↔ engine selecionar_peca
 *   shared GIRAR_PECA       ↔ engine girar_peca
 *   shared POSICIONAR_PECA  ↔ engine posicionar_peca
 *   shared FINALIZAR_MANIPULACAO ↔ engine finalizar_manipulacao
 *
 * Células ocupadas não reagem ao cursor nem ao clique; arrasto permanece
 * reservado à câmera via `atingiuLimiar()` (LIMIAR_ARRASTO_PX = 6).
 * Ver `game/ambiente/cameraLimites.ts` e `hooks/useCameraInterativa.ts`.
 */

import { atingiuLimiar } from '../ambiente/cameraLimites'
import { chaveCelula } from './contrato'
import type { Celula } from './contrato'
import type { TabuleiroComandoDoCliente } from '@flicker/shared'

// ── Estado mínimo para mapear interações ──
// Espelha EstadoDoTabuleiro do engine mas desacoplado (só o necessário para
// a interação da ST-09; Peões/Recebidas da ST-10 não participam).

export interface EstadoInteracaoTabuleiro {
  /** Peças Iniciais na mesa aguardando encaixe (issue #143). */
  readonly iniciais: readonly { readonly pecaId: string }[]
  readonly posicionadas: readonly { readonly pecaId: string; readonly celula: Celula }[]
  readonly pecaSelecionadaId: string | null
  readonly pecaEmManipulacaoId: string | null
}

// ── Sentido de rotação ──

export type SentidoDeRotacao = 'horario' | 'anti_horario'

// ── Helpers de ocupação / cursor ──

export function ehCelulaOcupada(
  posicionadas: readonly { readonly celula: Celula }[],
  celula: Celula,
): boolean {
  const chave = chaveCelula(celula)
  return posicionadas.some((p) => chaveCelula(p.celula) === chave)
}

/**
 * Cursor para célula: ocupada nunca reage; vazia só reage se há seleção.
 * Sem seleção ativa, células não reagem ao cursor (spec ST-09).
 */
export function cursorParaCelula(
  ocupada: boolean,
  pecaSelecionadaId: string | null,
): 'default' | 'pointer' {
  if (ocupada) return 'default'
  if (pecaSelecionadaId === null) return 'default'
  return 'pointer'
}

/** Pointer se for a peça em manipulação (finalizável por clique). */
export function cursorParaPecaPosicionada(
  pecaEmManipulacaoId: string | null,
  pecaId: string,
): 'default' | 'pointer' {
  return pecaEmManipulacaoId === pecaId ? 'pointer' : 'default'
}

/**
 * Delegação pura ao limiar da câmera (adaptativo por pointerType, ver cameraLimites.ts).
 *
 * NOTA — proteção real de ghost-click NÃO vive aqui: este helper é 100% puro
 * e não tem chamador em produção. A supressão efetiva do clique após arrasto
 * vive em `hooks/useCameraInterativa.ts` (`suprimirCliqueAposArrastoRef` +
 * `atingiuLimiar` adaptativo por `tipoPorPointerIdRef` + `onClickCapture`).
 * Use este helper apenas para testes unitários do limiar.
 */
export function deveSuprimirCliquePorArrasto(dx: number, dy: number, pointerType?: string): boolean {
  return atingiuLimiar(dx, dy, pointerType)
}

// ── Mapeamento clique → comando ──

/**
 * Clique em célula da grade.
 * - Célula ocupada → null (sem reação ao cursor nem ao clique).
 * - Célula vazia sem seleção → null.
 * - Célula vazia com seleção → POSICIONAR_PECA.
 */
export function mapearCliqueNaCelula(
  estado: EstadoInteracaoTabuleiro,
  celula: Celula,
): TabuleiroComandoDoCliente | null {
  if (ehCelulaOcupada(estado.posicionadas, celula)) return null
  const selecionada = estado.pecaSelecionadaId
  if (selecionada === null) return null
  return { type: 'POSICIONAR_PECA', pecaId: selecionada, celula }
}

/**
 * Clique na própria peça já posicionada.
 * - Se há manipulação aberta para essa peça → finaliza (via SELECIONAR_PECA,
 *   que o engine interpreta como fecharManipulacao quando
 *   pecaEmManipulacaoId === pecaId). Retorna comando de finalização.
 * - Caso contrário → null (sem efeito, evita sobrepor).
 *
 * A Finalização também ocorre por nova seleção ou novo posicionamento, mas
 * esses fluxos já são cobertos por mapearCliqueNaPecaDaMesa (interacaoPeoes)
 * / mapearCliqueNaCelula.
 */
export function mapearCliqueNaPecaPosicionada(
  estado: EstadoInteracaoTabuleiro,
  pecaId: string,
): TabuleiroComandoDoCliente | null {
  if (estado.pecaEmManipulacaoId === pecaId) {
    // Usa SELECIONAR_PECA para fechar manipulação (engine: selecionar_peca
    // com id em manipulação → fecharManipulacao). Wire também aceita
    // FINALIZAR_MANIPULACAO; SELECIONAR_PECA é o canônico da ST-09.
    return { type: 'SELECIONAR_PECA', pecaId }
  }
  return null
}

/**
 * Comando de rotação em passos de 90° nos dois sentidos.
 * Mapeia até a Finalização; após finalização o servidor rejeita com
 * MANIPULACAO_ENCERRADA (o ponto de som da Partida anuncia a recusa).
 */
export function mapearGiro(
  pecaId: string,
  sentido: SentidoDeRotacao,
): TabuleiroComandoDoCliente {
  return { type: 'GIRAR_PECA', pecaId, sentido }
}

/**
 * Emite FINALIZAR_MANIPULACAO explícito (alternativa a clicar na peça).
 * Usado por atalho/tecla dedicada, se houver.
 */
export function mapearFinalizarManipulacao(): TabuleiroComandoDoCliente {
  return { type: 'FINALIZAR_MANIPULACAO' }
}
