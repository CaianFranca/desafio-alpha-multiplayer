/**
 * Overlay bloqueante que pede para virar o aparelho.
 * Visível apenas em celular portrait; `z-50` acima de moldura/flash,
 * bloqueia interações subjacentes sem desmontar o modelo/WS.
 */
export function OverlayOrientacao() {
  return (
    <div
      data-testid="overlay-orientacao"
      role="alert"
      aria-live="assertive"
      className="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-zinc-900 px-6 text-center"
    >
      {/* Ícone simples de rotação (sem dependência externa) */}
      <span aria-hidden="true" className="text-4xl">
        ⟡
      </span>
      <p className="text-lg font-semibold text-white">Vire o aparelho para jogar</p>
      <p className="max-w-xs text-sm text-zinc-400">
        Esta experiência foi pensada para o modo paisagem no celular.
      </p>
    </div>
  )
}
