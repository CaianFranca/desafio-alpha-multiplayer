import { useCopiar } from '../../hooks/useCopiar'

interface Props {
  link: string
}

export function LinkDiretoCard({ link }: Props) {
  const { copiado, copiar } = useCopiar()

  // Exibe truncado como no mock .../sala/ABC123
  const exibicao = (() => {
    try {
      const url = new URL(link, window.location.origin)
      return `...${url.pathname}`
    } catch {
      return link.length > 18 ? `...${link.slice(-16)}` : link
    }
  })()

  return (
    <div className="border border-white/10 bg-[#1e1e1e] p-5 flex flex-col gap-2">
      <p className="text-[10px] tracking-[0.18em] uppercase text-white/60">Link Direto</p>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-white/90 truncate" title={link} aria-label="Link Direto">
          {exibicao}
        </p>
        <button
          type="button"
          onClick={() => void copiar(link)}
          aria-label="Copiar Link Direto"
          className="border border-white/20 w-8 h-8 flex items-center justify-center text-white/70 hover:text-white hover:border-white/40 transition-colors shrink-0"
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
      </div>
      {copiado && <span className="text-xs text-green-400">Copiado!</span>}
    </div>
  )
}
