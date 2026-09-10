/**
 * Gatilho do Modo Desenvolvedor (issue #340): 5 cliques em até 3s no `<a>`
 * do logo Ginga do footer. Somente-ativação: cliques extra com o modo ativo
 * não fazem nada (idempotente). O `preventDefault` é aplicado a TODO clique
 * no link: a partir do gesto, o `<a>` do Ginga não navega mais — seu único
 * papel é o gesto escondido.
 */

import { useCallback, useRef } from 'react'
import { ativarModoDoDesenvolvedor, estaModoAtivo } from '../utils/coletorDeDepuracao'

/** Cliques necessários para ativar. */
export const CLIQUES_PARA_ATIVAR = 5
/** Janela máxima entre o primeiro e o quinto clique (ms). */
export const JANELA_DO_GESTO_MS = 3000

export interface GatilhoDoModoDesenvolvedor {
  /** Handler do `onClick` do `<a>` do logo Ginga. */
  lidarComClique: (evento: { preventDefault: () => void }) => void
}

export function useGatilhoDoModoDesenvolvedor(): GatilhoDoModoDesenvolvedor {
  const cliquesRef = useRef(0)
  const inicioRef = useRef<number | null>(null)

  const lidarComClique = useCallback((evento: { preventDefault: () => void }) => {
    // O gesto substitui a navegação: o clique nunca abre o link.
    evento.preventDefault()
    // Idempotência: em modo ativo, cliques extra não fazem nada.
    if (estaModoAtivo()) return
    const agora = Date.now()
    if (inicioRef.current === null || agora - inicioRef.current > JANELA_DO_GESTO_MS) {
      // Fora da janela: reinicia o gesto com este clique.
      cliquesRef.current = 1
      inicioRef.current = agora
      return
    }
    cliquesRef.current += 1
    if (cliquesRef.current >= CLIQUES_PARA_ATIVAR) {
      ativarModoDoDesenvolvedor()
    }
  }, [])

  return { lidarComClique }
}
