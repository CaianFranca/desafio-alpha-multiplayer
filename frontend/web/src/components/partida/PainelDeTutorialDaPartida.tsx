/**
 * Container do Tutorial da Partida (issue #434, bloqueante 1 da review #401).
 *
 * Dono do estado do tutorial (`aberto` + slide atual) isolado da
 * `PartidaPage`: navegar no carrossel re-renderiza SÓ esta subárvore — a
 * página (e `estadoExibicao`/`AmbienteDeJogo`) não re-renderiza, então a cena
 * Three.js nunca re-sincroniza ao trocar de slide (mesma solução do chat).
 *
 * A abertura é reportada via `aoMudarAbertura`, que só escreve em ref na
 * página (sem setState, além do espelho do `inert`) — o gate de teclado da
 * cena lê a ref no instante do evento. A abertura automática (uma vez por
 * aba) vive na página: ela chama o handle imperativo `abrir` quando a
 * Partida entra em andamento e a flag de sessão ainda não foi marcada.
 */

import { useCallback, useEffect, useImperativeHandle, useState } from 'react'
import type { Ref } from 'react'
import { TutorialDaPartida } from './TutorialDaPartida'

export interface PainelDeTutorialDaPartidaHandle {
  abrir: () => void
  fechar: () => void
}

interface PainelDeTutorialDaPartidaProps {
  bloqueiaCena: boolean
  compacto?: boolean | null
  /** Só escreve em ref na página (sem setState) — gate do teclado lê no evento. */
  aoMudarAbertura?: (aberto: boolean) => void
  ref?: Ref<PainelDeTutorialDaPartidaHandle>
}

export function PainelDeTutorialDaPartida({
  bloqueiaCena,
  compacto = null,
  aoMudarAbertura,
  ref,
}: PainelDeTutorialDaPartidaProps) {
  const [aberto, setAberto] = useState(false)
  const [indice, setIndice] = useState(0)
  // Callbacks estáveis: a troca de slide re-renderiza o container sem
  // re-armar o foco/atalhos do diálogo (o effect do filho só roda em
  // abrir/fechar ou na virada andamento↔resultado).
  const abrir = useCallback(() => setAberto(true), [])
  const fechar = useCallback(() => setAberto(false), [])

  useImperativeHandle(
    ref,
    () => ({
      abrir,
      fechar,
    }),
    [abrir, fechar],
  )

  useEffect(() => {
    aoMudarAbertura?.(aberto)
  }, [aberto, aoMudarAbertura])

  return (
    <TutorialDaPartida
      aberto={aberto}
      indice={indice}
      aoFechar={fechar}
      aoIrPara={setIndice}
      bloqueiaCena={bloqueiaCena}
      compacto={compacto}
    />
  )
}
