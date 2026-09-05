/**
 * Pendentes otimistas anti-duplo-place (issue #249).
 *
 * O servidor é a autoridade inclusive para desselecionar; o cliente nunca
 * reenvia o mesmo alvo enquanto o comando estiver em voo. O conjunto vive no
 * chamador React (PartidaPage) e é consumido em ack/erro/snapshot
 * contraditório — nunca permite duplo envio do mesmo alvo.
 *
 * Alvos cobertos: POSICIONAR_PECA / POSICIONAR_PEAO / DESELECIONAR_PEAO.
 * Demais comandos (seleção, giro, vaga, mover/permanecer) seguem sem gate —
 * o domínio já os trata como idempotentes ou rejeita com erro próprio.
 */

import type { Celula } from '@flicker/shared'

interface FormaDeComando {
  readonly type: string
  readonly pecaId?: string
  readonly peaoId?: string
  readonly celula?: Celula
}

/** Chave estável do alvo em voo, ou null quando o comando não tem gate. */
export function chaveDeComandoPendente(comando: FormaDeComando): string | null {
  if (comando.type === 'POSICIONAR_PECA' && typeof comando.pecaId === 'string' && comando.celula) {
    return `POSICIONAR_PECA:${comando.pecaId}:${comando.celula.linha}:${comando.celula.coluna}`
  }
  if (comando.type === 'POSICIONAR_PEAO' && typeof comando.peaoId === 'string' && comando.celula) {
    return `POSICIONAR_PEAO:${comando.peaoId}:${comando.celula.linha}:${comando.celula.coluna}`
  }
  if (comando.type === 'DESELECIONAR_PEAO' && typeof comando.peaoId === 'string') {
    return `DESELECIONAR_PEAO:${comando.peaoId}`
  }
  return null
}

interface FormaDeAck {
  readonly type: string
  readonly pecaId?: string
  readonly peaoId?: string
}

/**
 * Remove do conjunto as chaves confirmadas pelo ack. Retorna true quando ao
 * menos uma chave foi consumida (o chamador pode ignorar o valor — o efeito
 * é a mutação do Set).
 */
export function consumirAck(pendentes: Set<string>, evento: FormaDeAck): boolean {
  if (evento.type === 'PECA_POSICIONADA' && typeof evento.pecaId === 'string') {
    const prefixo = `POSICIONAR_PECA:${evento.pecaId}:`
    let consumiu = false
    for (const chave of [...pendentes]) {
      if (chave.startsWith(prefixo)) {
        pendentes.delete(chave)
        consumiu = true
      }
    }
    return consumiu
  }
  if (evento.type === 'PEAO_POSICIONADO' && typeof evento.peaoId === 'string') {
    const prefixo = `POSICIONAR_PEAO:${evento.peaoId}:`
    let consumiu = false
    for (const chave of [...pendentes]) {
      if (chave.startsWith(prefixo)) {
        pendentes.delete(chave)
        consumiu = true
      }
    }
    return consumiu
  }
  if (evento.type === 'PEAO_DESELECIONADO' && typeof evento.peaoId === 'string') {
    return pendentes.delete(`DESELECIONAR_PEAO:${evento.peaoId}`)
  }
  return false
}
