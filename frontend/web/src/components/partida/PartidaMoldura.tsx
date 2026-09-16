import { useEffect, useRef } from 'react'
import { getBordaMolduraPxViaEstilo } from '../../game/ambiente/cameraLimites'

interface PartidaMolduraProps {
  onBordaChange?: (bordaPx: number) => void
}

export function PartidaMoldura({ onBordaChange }: PartidaMolduraProps) {
  const bordaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = bordaRef.current
    if (!el || !onBordaChange) return

    function medir(): void {
      if (!el || !onBordaChange) return
      const v = getComputedStyle(el).borderTopWidth
      const px = getBordaMolduraPxViaEstilo(v)
      onBordaChange(px)
    }

    medir()

    const ro = new ResizeObserver(() => medir())
    ro.observe(el)

    function onResize(): void {
      medir()
    }
    window.addEventListener('resize', onResize)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [onBordaChange])

  return (
    <div
      data-testid="partida-moldura"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20"
    >
      {/* Moldura visual removida (tela cheia limpa): o medidor segue ativo e
          reporta 0px, então a câmera/névoa usam a área visível integral. */}
      <div ref={bordaRef} className="absolute inset-0 border-0" />
    </div>
  )
}
