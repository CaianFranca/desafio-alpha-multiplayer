import { useEffect, useState } from 'react'
import { LIMIAR_ASPECTO_LARGO_BAIXO } from '../game/ambiente/cameraLimites'

/**
 * Heurística paisagem-celular compacta (issue #230, 800x360): paisagem curta
 * de aspecto largo-baixo (≥2) com altura ≤500 — mantém local/turno/sistema
 * integrais e só compacta o resto. Puro e testável, sem ler window.
 * Usado pelo HUD e por PartidaPage (mesmo breakpoint, sem sobrepor alvos).
 */
export function deveUsarHudCompacto(largura: number, altura: number): boolean {
  if (!Number.isFinite(largura) || !Number.isFinite(altura)) return false
  if (largura <= 0 || altura <= 0) return false
  if (largura <= altura) return false
  if (altura > 500) return false
  return largura / altura >= LIMIAR_ASPECTO_LARGO_BAIXO
}

/** Lê o viewport atual (jsdom-safe): fallback 1024x768 fora do browser. */
function lerViewport(): { largura: number; altura: number } {
  if (typeof window === 'undefined') return { largura: 1024, altura: 768 }
  return { largura: window.innerWidth, altura: window.innerHeight }
}

/**
 * Hook do modo compacto paisagem-celular (#230): `compacto` prop vence;
 * sem prop deriva do viewport e reage a resize/orientationchange
 * (giro paisagem↔retrato sem recarregar). Extrai a duplicação que vivia
 * em HudDaPartida + PartidaPage (request changes #367).
 */
export function useViewportCompacto(compacto?: boolean | null): boolean {
  const [viewport, setViewport] = useState(lerViewport)
  useEffect(() => {
    if (compacto !== null && compacto !== undefined) return
    function atualizar(): void {
      setViewport(lerViewport())
    }
    window.addEventListener('resize', atualizar)
    window.addEventListener('orientationchange', atualizar)
    return () => {
      window.removeEventListener('resize', atualizar)
      window.removeEventListener('orientationchange', atualizar)
    }
  }, [compacto])
  if (compacto !== null && compacto !== undefined) return compacto
  return deveUsarHudCompacto(viewport.largura, viewport.altura)
}
