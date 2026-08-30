import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Sala, SalaEventoDoServidor, ServerMessage } from '@flicker/shared'
import { mensagemDeErroDoEncaminhamento } from '../api/encaminhamento'

export type FaseDoEncaminhamento = 'ocioso' | 'preparando' | 'disponivel' | 'recusada' | 'falhou'

export interface AlvoDaPartidaState {
  partidaId: string
  serverId: string
}

export interface EstadoDoEncaminhamento {
  fase: FaseDoEncaminhamento
  alvo: AlvoDaPartidaState | null
  codigo: string | null
  motivo: string | null
  mensagem: string | null
}

function estadoInicial(): EstadoDoEncaminhamento {
  return { fase: 'ocioso', alvo: null, codigo: null, motivo: null, mensagem: null }
}

export interface UseSalaResult {
  sala: Sala | null
  encaminhamento: EstadoDoEncaminhamento
  wsConectado: boolean
  /** Limpa aviso de recusa/falha e volta ao estado normal da Sala. */
  limparAviso: () => void
  /** URL do WS do lobby (para debug/teste). */
  wsUrl: string
}

function wsUrlDoLobby(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // Em dev o Vite faz proxy de /ws; em prod vem do NGINX.
  return `${protocol}//${window.location.host}/ws/lobby`
}

function isEncaminhamentoEvento(
  msg: ServerMessage,
): msg is Extract<ServerMessage, { type: 'PARTIDA_PREPARANDO' | 'PARTIDA_DISPONIVEL' | 'PARTIDA_RECUSADA' | 'PARTIDA_FALHOU' }> {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    (msg.type === 'PARTIDA_PREPARANDO' ||
      msg.type === 'PARTIDA_DISPONIVEL' ||
      msg.type === 'PARTIDA_RECUSADA' ||
      msg.type === 'PARTIDA_FALHOU')
  )
}

function aplicarEvento(
  prev: EstadoDoEncaminhamento,
  msg: ServerMessage,
): EstadoDoEncaminhamento | null {
  switch (msg.type) {
    case 'PARTIDA_PREPARANDO':
      return { fase: 'preparando', alvo: null, codigo: null, motivo: null, mensagem: null }
    case 'PARTIDA_DISPONIVEL':
      return {
        fase: 'disponivel',
        alvo: { partidaId: msg.partidaId, serverId: msg.serverId },
        codigo: null,
        motivo: null,
        mensagem: null,
      }
    case 'PARTIDA_RECUSADA': {
      const mensagem = mensagemDeErroDoEncaminhamento(msg.codigo, msg.motivo)
      return { fase: 'recusada', alvo: null, codigo: msg.codigo, motivo: msg.motivo, mensagem }
    }
    case 'PARTIDA_FALHOU': {
      const mensagem = mensagemDeErroDoEncaminhamento(msg.codigo, msg.motivo)
      return { fase: 'falhou', alvo: null, codigo: msg.codigo, motivo: msg.motivo, mensagem }
    }
    default:
      return null
  }
}

/**
 * Hook único da Sala (issue #45): abre o WS do lobby, mantém `sala`
 * atualizada via SALA_ATUALIZADA e reage aos 4 eventos de Encaminhamento.
 * Também detecta no snapshot (SALA_ATUALIZADA com encaminhamento) que a
 * Sala já está encaminhada — caminho do reconector.
 */
export function useSala(): UseSalaResult {
  const wsUrl = useMemo(() => wsUrlDoLobby(), [])
  const [sala, setSala] = useState<Sala | null>(null)
  const [encaminhamento, setEncaminhamento] = useState<EstadoDoEncaminhamento>(() => estadoInicial())
  const [wsConectado, setWsConectado] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  // Snapshot → encaminhada: renderiza alvo direto para quem reconectou.
  const sincronizarEncaminhamentoDoSnapshot = useCallback((novaSala: Sala) => {
    const alvo = novaSala.encaminhamento
    const ehEncaminhada = novaSala.estado === 'encaminhada' || (alvo !== null && alvo !== undefined)
    if (ehEncaminhada && alvo !== null && alvo !== undefined) {
      setEncaminhamento({
        fase: 'disponivel',
        alvo: { partidaId: alvo.partidaId, serverId: alvo.serverId },
        codigo: null,
        motivo: null,
        mensagem: null,
      })
    }
  }, [])

  const limparAviso = useCallback(() => {
    setEncaminhamento((prev) => {
      if (prev.fase === 'recusada' || prev.fase === 'falhou') return estadoInicial()
      return prev
    })
  }, [])

  useEffect(() => {
    let ativo = true
    let ws: WebSocket | null = null
    let tentativas = 0

    function conectar() {
      if (!ativo) return
      try {
        ws = new WebSocket(wsUrl)
        wsRef.current = ws
      } catch (e) {
        void e
        return
      }

      ws.onopen = () => {
        tentativas = 0
        if (ativo) setWsConectado(true)
      }

      ws.onclose = () => {
        if (ativo) setWsConectado(false)
        // Reconexão simples para resiliência de rede (não cobre reconexão de Membro — isso é janela de 60s do backend).
        if (ativo && tentativas < 5) {
          tentativas += 1
          setTimeout(conectar, 1000 * tentativas)
        }
      }

      // onerror é seguido de onclose — tratamento centralizado lá (sem handler explícito).

      ws.onmessage = (event: MessageEvent) => {
        if (!ativo) return
        let parsed: unknown
        try {
          parsed = JSON.parse(String(event.data))
        } catch (e) {
          void e
          return
        }
        if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) return
        const msg = parsed as ServerMessage

        // Primeiro, atualizar Sala quando houver.
        if ((msg as SalaEventoDoServidor).type === 'SALA_ATUALIZADA') {
          const salaAtualizada = (msg as { sala: Sala }).sala
          setSala(salaAtualizada)
          sincronizarEncaminhamentoDoSnapshot(salaAtualizada)
          return
        }
        // Demais eventos de Sala que carregam snapshot (MEMBRO_*, etc.) também atualizam.
        const maybeSala = (msg as unknown as { sala?: Sala }).sala
        if (maybeSala !== undefined && typeof maybeSala === 'object' && maybeSala !== null && 'id' in maybeSala) {
          setSala(maybeSala as Sala)
          sincronizarEncaminhamentoDoSnapshot(maybeSala as Sala)
        }

        if (isEncaminhamentoEvento(msg)) {
          setEncaminhamento((prev) => aplicarEvento(prev, msg) ?? prev)
        }
      }
    }

    conectar()

    return () => {
      ativo = false
      if (ws !== null) {
        try {
          ws.close()
        } catch (e) {
          void e
        }
      }
      wsRef.current = null
    }
  }, [wsUrl, sincronizarEncaminhamentoDoSnapshot])

  return { sala, encaminhamento, wsConectado, limparAviso, wsUrl }
}
