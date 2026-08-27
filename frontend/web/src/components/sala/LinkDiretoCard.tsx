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
          <span aria-hidden>{copiado ? '✓' : '🔗'}</span>
        </button>
      </div>
      {copiado && <span className="text-xs text-green-400">Copiado!</span>}
    </div>
  )
}
