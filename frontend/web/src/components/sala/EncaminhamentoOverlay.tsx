import { useEffect, useRef } from 'react'
import { buildGameRedirectHref, REDIRECT_DELAY_MS } from '../../api/encaminhamento'
import { DotsDeCarregamento } from '../loading/DotsDeCarregamento'
import type { EstadoDoEncaminhamento } from '../../hooks/useSalaWebSocket'

interface Props {
  encaminhamento: EstadoDoEncaminhamento
  href?: string | null
  codigoDeSala?: string | null
}

export function EncaminhamentoOverlay({ encaminhamento, href: hrefProp, codigoDeSala }: Props) {
  const { fase, alvo } = encaminhamento
  const timeoutRef = useRef<number | null>(null)

  const visivel = fase === 'preparando' || (fase === 'disponivel' && alvo !== null)
  const href =
    hrefProp !== undefined
      ? hrefProp
      : alvo !== null
        ? buildGameRedirectHref(alvo.serverId, alvo.partidaId, codigoDeSala ?? null)
        : null

  useEffect(() => {
    if (fase === 'disponivel' && href !== null) {
      const id = window.setTimeout(() => {
        // Redireciona para /partida via assign (reload); cancelável em cleanup ou quando fase sai de disponivel.
        window.location.assign(href)
      }, REDIRECT_DELAY_MS)
      timeoutRef.current = id
      return () => {
        window.clearTimeout(id)
        timeoutRef.current = null
      }
    }
    // Saiu de disponivel ou sem alvo — cancela redirect pendente
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    return undefined
  }, [fase, href])

  if (!visivel) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      // Dialog sem nome acessível proposital: o anúncio vai só na região status
      // "Carregando partida" para não duplicar o live-region (spec #386).
      data-testid="encaminhamento-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
    >
      <div
        data-testid="encaminhamento-carregando"
        role="status"
        aria-label="Carregando partida"
        className="encaminhamento-carregando"
      >
        <DotsDeCarregamento nomeAcessivel="Carregando partida" />
      </div>
    </div>
  )
}
