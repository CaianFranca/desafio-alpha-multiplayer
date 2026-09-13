import { useEffect, useRef } from 'react'
import { buildGameRedirectHref } from '../../api/encaminhamento'
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
      }, 1500)
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
      data-testid="encaminhamento-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
    >
      <div
        data-testid="encaminhamento-carregando"
        role="status"
        aria-label="Carregando partida"
        className="flex items-center justify-center"
      >
        <span
          aria-hidden="true"
          className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white"
        />
        <span className="sr-only">Carregando partida</span>
      </div>
    </div>
  )
}
