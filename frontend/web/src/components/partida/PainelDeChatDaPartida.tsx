/**
 * Container do chat da Partida (bloqueante 1 da review #401).
 *
 * Dono do estado do chat (`useChatDaPartida`) isolado da `PartidaPage`: cada
 * mensagem live, recusa e tique do cooldown re-renderiza SÓ esta subárvore —
 * a página (e `estadoExibicao`/`AmbienteDeJogo`) não re-renderiza, então
 * rajadas de bot não re-sincronizam a cena Three.js.
 *
 * Eventos entram por handle imperativo (`receberMensagem`, `receberRecusa`,
 * `receberHistorico`): a página mantém as 3 refs de roteamento do socket e
 * delega a este handle na chegada do evento (callback do canal estável, sem
 * re-subscrição). A abertura é reportada via `aoMudarAbertura`, que só escreve
 * em ref na página (sem setState) — o gate de teclado da cena lê a ref no
 * instante do evento.
 */

import { useEffect, useImperativeHandle } from 'react'
import type { Ref } from 'react'
import type {
  ErroDoTabuleiroEvento,
  MensagemDeChatDaPartidaEvento,
  PartidaComandoDoCliente,
} from '@flicker/shared'
import { useChatDaPartida } from '../../hooks/useChatDaPartida'
import type { PercepcaoDeJogador } from '../../game/tabuleiro/reducao'
import { ChatDaPartida } from './ChatDaPartida'

export interface PainelDeChatDaPartidaHandle {
  receberMensagem: (evento: MensagemDeChatDaPartidaEvento) => void
  receberRecusa: (evento: ErroDoTabuleiroEvento) => void
  receberHistorico: (
    historico: readonly MensagemDeChatDaPartidaEvento[] | undefined | null,
  ) => void
}

interface PainelDeChatDaPartidaProps {
  partidaId: string | null
  jogadorId: string | null
  estaConectado: () => boolean
  enviar: (comando: PartidaComandoDoCliente) => 'enviado' | 'enfileirado'
  descartarPendentesPorTipo: (tipo: PartidaComandoDoCliente['type']) => void
  jogadorPorId: Readonly<Record<string, PercepcaoDeJogador>>
  bloqueiaCena: boolean
  compacto?: boolean | null
  /** Só escreve em ref na página (sem setState) — gate do teclado lê no evento. */
  aoMudarAbertura?: (aberto: boolean) => void
  ref?: Ref<PainelDeChatDaPartidaHandle>
}

export function PainelDeChatDaPartida({
  partidaId,
  jogadorId,
  estaConectado,
  enviar,
  descartarPendentesPorTipo,
  jogadorPorId,
  bloqueiaCena,
  compacto = null,
  aoMudarAbertura,
  ref,
}: PainelDeChatDaPartidaProps) {
  const {
    mensagens,
    naoLidas,
    aberto,
    emCooldown,
    recusa,
    anuncio,
    abrir,
    fechar,
    enviar: enviarMensagem,
    aoEventoDeChat,
    aoErroDeChat,
    hidratarHistorico,
  } = useChatDaPartida({
    partidaId,
    jogadorId,
    estaConectado,
    enviar,
    descartarPendentesPorTipo,
  })

  useImperativeHandle(
    ref,
    () => ({
      receberMensagem: (evento) => aoEventoDeChat(evento),
      receberRecusa: (evento) => aoErroDeChat(evento),
      receberHistorico: (historico) => hidratarHistorico(historico),
    }),
    [aoEventoDeChat, aoErroDeChat, hidratarHistorico],
  )

  useEffect(() => {
    aoMudarAbertura?.(aberto)
  }, [aberto, aoMudarAbertura])

  return (
    <ChatDaPartida
      mensagens={mensagens}
      naoLidas={naoLidas}
      aberto={aberto}
      emCooldown={emCooldown}
      recusa={recusa}
      anuncio={anuncio}
      jogadorPorId={jogadorPorId}
      jogadorLocalId={jogadorId}
      aoAbrir={abrir}
      aoFechar={fechar}
      aoEnviar={enviarMensagem}
      bloqueiaCena={bloqueiaCena}
      compacto={compacto}
    />
  )
}
