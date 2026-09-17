interface Props {
  rotulo: string
  copiado: boolean
  aoClicar: () => void
}

export function BotaoCopiar({ rotulo, copiado, aoClicar }: Props) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-label={`Copiar ${rotulo}`}
      className="border border-white/20 w-8 h-8 flex items-center justify-center text-white/70 cursor-pointer hover:text-white hover:border-white/40 transition-colors shrink-0"
    >
      <span aria-hidden>
        {copiado ? (
          '✓'
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        )}
      </span>
    </button>
  )
}