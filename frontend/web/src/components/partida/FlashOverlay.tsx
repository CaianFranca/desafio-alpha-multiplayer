/**
 * Overlay de flash visual (issue #85).
 *
 * Div DOM `pointer-events-none` sobre a cena: preenche a tela com a cor/hex e
 * duração de `FeedbackDeFlash` (branco para seleção/aprovação, vermelho para
 * rejeição) e se remove após o tempo via `onClear` (timers com cleanup).
 *
 * Componente controlado: exibe o flash vindo do pai e agenda a remoção; novos
 * flashes reiniciam o timer (derivado via `key` no pai, se desejado), mantendo
 * o mais recente como o relevante.
 */

import { useEffect } from 'react'
import type { FlashFeedback } from '../../game/tabuleiro/interacao'

interface FlashOverlayProps {
  flash: FlashFeedback | null
  /** Chamado quando o flash atual expira (remove do pai). */
  onClear: () => void
}

export function FlashOverlay({ flash, onClear }: FlashOverlayProps) {
  useEffect(() => {
    if (flash === null) return
    const timer = window.setTimeout(onClear, flash.duracaoMs)
    return () => clearTimeout(timer)
  }, [flash, onClear])

  if (flash === null) return null

  return (
    <div
      data-testid="flash-overlay"
      data-cor={flash.cor}
      data-motivo={flash.motivo}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-40"
      style={{ backgroundColor: flash.hex }}
    />
  )
}
