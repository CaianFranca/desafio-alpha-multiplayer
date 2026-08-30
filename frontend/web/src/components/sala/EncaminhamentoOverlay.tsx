import { useEffect, useRef } from 'react'
import { buildGameRedirectHref, buildGameWsUrl } from '../../api/encaminhamento'
import type { EstadoDoEncaminhamento } from '../../hooks/useSalaWebSocket'

interface Props {
  encaminhamento: EstadoDoEncaminhamento
  wsAlvo?: string | null
  href?: string | null
}

export function EncaminhamentoOverlay({ encaminhamento, wsAlvo: wsAlvoProp, href: hrefProp }: Props) {
  const { fase, alvo } = encaminhamento
  const timeoutRef = useRef<number | null>(null)

  const visivel = fase === 'preparando' || (fase === 'disponivel' && alvo !== null)
  const wsAlvo = wsAlvoProp !== undefined ? wsAlvoProp : alvo !== null ? buildGameWsUrl(alvo.serverId, alvo.partidaId) : null
  const href = hrefProp !== undefined ? hrefProp : alvo !== null ? buildGameRedirectHref(alvo.serverId, alvo.partidaId) : null

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
      aria-labelledby="encaminhamento-titulo"
      aria-live="polite"
      data-testid="encaminhamento-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
    >
      <div className="max-w-lg w-full rounded-2xl bg-white p-8 text-center shadow-xl">
        {fase === 'preparando' && (
          <>
            <p className="text-xs font-bold tracking-[.16em] uppercase text-[var(--color-accent)]">Encaminhamento</p>
            <h2 id="encaminhamento-titulo" className="mt-2 text-2xl font-bold">
              Preparando partida...
            </h2>
            <p className="mt-3 text-sm text-[var(--color-muted)]">A sala está sendo encaminhada para o servidor de jogo. Aguarde todos os membros.</p>
            <div role="status" aria-label="Preparando partida" className="mt-6 flex justify-center">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[var(--color-accent)]" />
            </div>
          </>
        )}
        {fase === 'disponivel' && alvo !== null && wsAlvo !== null && href !== null && (
          <>
            <p className="text-xs font-bold tracking-[.16em] uppercase text-emerald-600">Partida disponível</p>
            <h2 id="encaminhamento-titulo" className="mt-2 text-2xl font-bold">
              Partida disponível!
            </h2>
            <p className="mt-3 text-sm text-[var(--color-muted)]">Redirecionando para o servidor de jogo...</p>
            <div className="mt-6 rounded-lg bg-gray-50 p-3 text-left">
              <p className="text-xs font-semibold text-gray-600">Alvo do redirect</p>
              <p data-testid="alvo-do-redirect" className="mt-1 break-all font-mono text-xs text-gray-800">
                {wsAlvo}
              </p>
            </div>
            <a
              href={href}
              data-testid="ir-para-partida"
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-[var(--color-accent)] px-6 py-3 text-sm font-bold text-white hover:opacity-90"
            >
              Ir para a partida
            </a>
            <p className="mt-3 text-xs text-[var(--color-muted)]">Você será redirecionado automaticamente em instantes.</p>
          </>
        )}
      </div>
    </div>
  )
}
