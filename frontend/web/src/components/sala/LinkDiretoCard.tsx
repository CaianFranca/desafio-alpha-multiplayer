import { useCopiar } from '../../hooks/useCopiar'
import { BotaoCopiar } from './BotaoCopiar'

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
        <BotaoCopiar rotulo="Link Direto" copiado={copiado} aoClicar={() => void copiar(link)} />
      </div>
      {copiado && <span className="text-xs text-green-400">Copiado!</span>}
    </div>
  )
}
