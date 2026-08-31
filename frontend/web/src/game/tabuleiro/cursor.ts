/**
 * Cursor do ponteiro sobre a cena (issue #85).
 *
 * O @react-three/fiber v9 não expõe o prop `cursor` no type de mesh; o padrão
 * type-safe é alternar `document.body.style.cursor` em `onPointerOver`/
 * `onPointerOut`. O valor vem de `cursorParaCelula`/estado de interação e é
 * convertido em handlers de hover R3F.
 */

import type { ThreeEvent } from '@react-three/fiber'

/**
 * Agregação global de hovers com pointer para evitar corridas entre meshes:
 * só limpa o cursor do body quando o último mesh pointer disparar pointerOut.
 */
let hoversPointerAtivos = 0

/** Reseta cursor global — usado em cleanup de desmonte com hover ativo. */
export function resetarCursorGlobal(): void {
  hoversPointerAtivos = 0
  if (typeof document !== 'undefined') {
    document.body.style.cursor = ''
  }
}

function aplicarCursor(estilo: string): void {
  if (typeof document !== 'undefined') {
    document.body.style.cursor = estilo
  }
}

/**
 * Handlers de hover que aplicam o cursor CSS no body. `pointer`/`default` são
 * os únicos valores emitidos pelo domínio (ver `cursorParaCelula`).
 */
export function handlersDeCursor(
  cursor: 'default' | 'pointer',
): {
  onPointerOver: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut: (e: ThreeEvent<PointerEvent>) => void
  onPointerLeave: (e: ThreeEvent<PointerEvent>) => void
} {
  const onOut = () => {
    if (cursor === 'pointer') {
      hoversPointerAtivos = Math.max(0, hoversPointerAtivos - 1)
      if (hoversPointerAtivos === 0) {
        aplicarCursor('')
      }
    }
  }

  return {
    onPointerOver: () => {
      if (cursor === 'pointer') {
        hoversPointerAtivos++
        aplicarCursor('pointer')
      }
    },
    onPointerOut: onOut,
    onPointerLeave: onOut,
  }
}
