import { useEffect, useRef } from 'react'

/**
 * Overlay bloqueante que pede para virar o aparelho.
 * Visível apenas em celular com tela em retrato vertical;
 * fica acima de moldura/flash e bloqueia interações subjacentes
 * sem desmontar o modelo/WS. É um `alertdialog` modal com foco
 * inicial: teclado e leitor de tela ficam contidos enquanto o
 * container do jogo está `inert`.
 */
export function OverlayModoPaisagem() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div
      ref={ref}
      data-testid="overlay-modo-paisagem"
      role="alertdialog"
      aria-modal="true"
      aria-label="Vire o aparelho para jogar"
      tabIndex={-1}
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-zinc-900/80 px-6 text-center"
    >
      <div className="flex flex-col items-center gap-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/40 text-accent"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="7" y="2" width="10" height="14" rx="1.5" />
            <path d="M9 18h6" />
            <path d="M16 8l3-1v6l-3-1" />
          </svg>
        </span>
        <p className="font-display text-[length:var(--hud-display,1.5rem)] leading-8 font-bold tracking-wide text-white">
          Vire o aparelho para jogar
        </p>
        <p className="max-w-xs text-[length:var(--hud-corpo,0.875rem)] leading-relaxed text-zinc-400">
          Esta experiência foi pensada para o modo paisagem no celular.
        </p>
      </div>
    </div>
  )
}
