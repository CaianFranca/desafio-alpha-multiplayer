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
 * Handlers de hover que aplicam o cursor CSS no body. `pointer`/`default` são
 * os únicos valores emitidos pelo domínio (ver `cursorParaCelula`).
 */
export function handlersDeCursor(
  cursor: 'default' | 'pointer',
): {
  onPointerOver: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut: (e: ThreeEvent<PointerEvent>) => void
} {
  const aplicar = (estilo: string) => {
    if (typeof document !== 'undefined') {
      document.body.style.cursor = estilo
    }
  }
  return {
    onPointerOver: () => {
      if (cursor === 'pointer') aplicar('pointer')
    },
    onPointerOut: () => aplicar(''),
  }
}
