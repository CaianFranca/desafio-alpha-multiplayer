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
      <div
        ref={bordaRef}
        className="absolute inset-0 border-4 border-amber-500/20 md:border-8 lg:border-[12px]"
      />
      <div className="absolute left-0 top-0 h-8 w-8 border-l-4 border-t-4 border-amber-500/40 md:h-12 md:w-12" />
      <div className="absolute right-0 top-0 h-8 w-8 border-r-4 border-t-4 border-amber-500/40 md:h-12 md:w-12" />
      <div className="absolute bottom-0 left-0 h-8 w-8 border-b-4 border-l-4 border-amber-500/40 md:h-12 md:w-12" />
      <div className="absolute bottom-0 right-0 h-8 w-8 border-b-4 border-r-4 border-amber-500/40 md:h-12 md:w-12" />
    </div>
  )
}
