import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CodigoDeSala,
  Sala,
  SalaEventoDoServidor,
  SalaComandoDoCliente,
} from '@flicker/shared'
import { normalizarCodigoDeSala } from '../utils/codigoDeSala'

export interface AvisoDoLobby {
  id: string
  mensagem: string
  tipo: string
  criadoEm: number
}

export interface MensagemDeChatDoLobby {
  id: string
  apelido: string
  conteudo: string
  enviadoEm: string
}

export interface JogadorBloqueado {
  jogadorId: string
  apelido: string
}

export interface UseSalaWebSocketReturn {
  sala: Sala | null
  avisos: AvisoDoLobby[]
  mensagensDeChat: MensagemDeChatDoLobby[]
  jogadoresBloqueados: JogadorBloqueado[]
  conectado: boolean
  erro: string | null
  enviar: (comando: SalaComandoDoCliente) => void
  criarSala: () => void
  entrarNaSala: (codigoDeSala: CodigoDeSala) => void
  alternarProntidao: () => void
  sairDaSala: () => void
  enviarMensagemDeChat: (conteudo: string) => void
  expulsarMembro: (membroId: string) => void
  desbloquearJogador: (jogadorId: string) => void
  encerrarSala: () => void
  iniciarPartida: () => void
}

// Fallback dev — evita magic strings; ver também frontend/vite.config.ts LOBBY_SERVER_PORT
const DEV_FRONTEND_PORT_SUBSTRING = '5173'
const DEFAULT_LOBBY_WS_PORT = '3001'

// Mantém apenas os avisos mais recentes para não crescer infinitamente
// e quebrar o layout (janela deslizante).
const AVISOS_MAX = 20

// Mantém apenas as mensagens de chat mais recentes (histórico do servidor +
// mensagens ao vivo) com teto de memória.
const MENSAGENS_DE_CHAT_MAX = 200

// Fallback quando o apelido do expulso não está na sala anterior:
// jogadorId truncado para exibição curta.
function apelidoDeFallback(jogadorId: string): string {
  return `Jogador ${jogadorId.slice(0, 8)}`
}

/**
 * Resolve URL do WebSocket do lobby.
 * Prioridade: 1) VITE_WS_URL (canônico, prod/preview) 2) fallback dev-only:
 * se host contém 5173 (Vite dev), usa hostname:3001 (DEFAULT_LOBBY_WS_PORT,
 * mesma env de frontend/vite.config.ts). Em prod, defina VITE_WS_URL.
 */
function resolverWsUrl(): string {
  if (typeof window === 'undefined') return `ws://localhost:${DEFAULT_LOBBY_WS_PORT}`
  const envUrl = (import.meta.env as Record<string, string | undefined>).VITE_WS_URL
  if (typeof envUrl === 'string' && envUrl.length > 0) return envUrl
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  if (host.includes(DEV_FRONTEND_PORT_SUBSTRING)) {
    return `${protocol}//${window.location.hostname}:${DEFAULT_LOBBY_WS_PORT}`
  }
  return `${protocol}//${host}`
}

function mensagemDeAviso(evento: SalaEventoDoServidor, salaAnterior: Sala | null): string | null {
  switch (evento.type) {
    case 'SALA_ATUALIZADA':
      if (evento.sala.estado === 'encaminhada' && salaAnterior?.estado !== 'encaminhada') {
        return 'Sala encaminhada para a partida'
      }
      return null
    case 'MEMBRO_ENTROU':
      return `${evento.membro.apelido} entrou na sala`
    case 'MEMBRO_SAIU': {
      const apelido = salaAnterior?.membros.find((m) => m.id === evento.membroId)?.apelido ?? 'Membro'
      return `${apelido} saiu da sala`
    }
    case 'MEMBRO_EXPULSO': {
      const apelido = salaAnterior?.membros.find((m) => m.id === evento.membroId)?.apelido ?? 'Membro'
      return `${apelido} foi expulso`
    }
    case 'MEMBRO_DESCONECTADO': {
      const apelido = salaAnterior?.membros.find((m) => m.id === evento.membroId)?.apelido ?? 'Membro'
      return `${apelido} desconectado (${evento.presenca})`
    }
    case 'ANFITRIAO_SUBSTITUIDO': {
      const anterior = salaAnterior?.membros.find((m) => m.id === evento.anfitriaoAnteriorId)
      const atual = evento.sala.membros.find((m) => m.id === evento.anfitriaoId)
      const nomeAtual = atual?.apelido ?? 'novo Anfitrião'
      const nomeAnterior = anterior?.apelido ?? 'Anfitrião anterior'
      return `Anfitrião substituído: ${nomeAnterior} → ${nomeAtual}`
    }
    case 'PRONTIDAO_ATUALIZADA': {
      const membro = evento.sala.membros.find((m) => m.id === evento.membroId)
      if (membro) return `${membro.apelido} ${evento.prontidao ? 'está pronto' : 'não está mais pronto'}`
      return null
    }
    default:
      return null
  }
}

type EventoDeSalaComSala = Extract<SalaEventoDoServidor, { sala: Sala }>
const EVENTOS_DE_SALA = new Set<SalaEventoDoServidor['type']>([
  'SALA_ATUALIZADA',
  'MEMBRO_ENTROU',
  'MEMBRO_SAIU',
  'MEMBRO_DESCONECTADO',
  'MEMBRO_EXPULSO',
  'ANFITRIAO_SUBSTITUIDO',
  'PRONTIDAO_ATUALIZADA',
])
function isEventoDeSala(evento: SalaEventoDoServidor): evento is EventoDeSalaComSala {
  return EVENTOS_DE_SALA.has(evento.type)
}

export function useSalaWebSocket(jogadorId?: string): UseSalaWebSocketReturn {
  const [sala, setSala] = useState<Sala | null>(null)
  const [avisos, setAvisos] = useState<AvisoDoLobby[]>([])
  const [mensagensDeChat, setMensagensDeChat] = useState<MensagemDeChatDoLobby[]>([])
  const [jogadoresBloqueados, setJogadoresBloqueados] = useState<JogadorBloqueado[]>([])
  const [conectado, setConectado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const salaRef = useRef<Sala | null>(null)
  // Contador de avisos por instância (evita global mutable)
  const avisoContadorRef = useRef(0)
  // Contador de mensagens de chat por instância (ids estáveis no feed)
  const chatContadorRef = useRef(0)
  // Comandos enfileirados quando o WebSocket ainda não está aberto (handshake).
  const comandosPendentesRef = useRef<SalaComandoDoCliente[]>([])

  // Ao trocar de sala (código diferente), descarta avisos, chat e bloqueados
  // da sala anterior.
  useEffect(() => {
    const atual = sala?.codigoDeSala ?? null
    const anterior = salaRef.current?.codigoDeSala ?? null
    if (atual !== anterior) {
      setAvisos([])
      setMensagensDeChat([])
      setJogadoresBloqueados([])
    }
    salaRef.current = sala
  }, [sala])

  const adicionarAviso = useCallback((mensagem: string, tipo: string) => {
    avisoContadorRef.current += 1
    const id = `aviso-${avisoContadorRef.current}-${Date.now()}`
    setAvisos((prev) => [...prev, { id, mensagem, tipo, criadoEm: Date.now() }].slice(-AVISOS_MAX))
  }, [])

  const conectar = useCallback(() => {
    const url = resolverWsUrl()
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      setErro('Falha ao conectar ao servidor')
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      setConectado(true)
      setErro(null)
      // Drena comandos enfileirados enquanto o socket estava conectando.
      const pendentes = comandosPendentesRef.current
      comandosPendentesRef.current = []
      for (const comando of pendentes) {
        ws.send(JSON.stringify(comando))
      }
    }

    ws.onclose = () => {
      setConectado(false)
      wsRef.current = null
      // Reconexão simples após 1s se ainda montado
      if (reconnectTimerRef.current === null) {
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null
          // eslint-disable-next-line react-hooks/immutability -- chamada recursiva após declaração, segura em runtime
          conectar()
        }, 1000)
      }
    }

    ws.onerror = () => {
      setErro('Erro de conexão')
    }

    ws.onmessage = (event: MessageEvent) => {
      let data: unknown
      try {
        data = JSON.parse(event.data as string)
      } catch {
        return
      }
      if (typeof data !== 'object' || data === null || !('type' in data)) return
      const evento = data as SalaEventoDoServidor
      switch (evento.type) {
        case 'ERRO_DA_SALA':
          setErro(evento.mensagem)
          adicionarAviso(evento.mensagem, evento.type)
          return
        case 'MENSAGEM_DE_CHAT': {
          chatContadorRef.current += 1
          const id = `chat-${chatContadorRef.current}-${Date.now()}`
          const mensagem: MensagemDeChatDoLobby = {
            id,
            apelido: evento.apelido,
            conteudo: evento.conteudo,
            enviadoEm: evento.enviadoEm,
          }
          setMensagensDeChat((prev) => [...prev, mensagem].slice(-MENSAGENS_DE_CHAT_MAX))
          return
        }
        default:
          if (isEventoDeSala(evento)) {
            const salaAnterior = salaRef.current
            setSala(evento.sala)
            if (evento.type === 'MEMBRO_EXPULSO') {
              // Lista local da sessão: o Anfitrião acumula expulsos observados
              // (apelido lido da sala anterior ao evento). Não há protocolo
              // para listar bloqueados — pendência registrada na issue #35.
              const apelido =
                salaAnterior?.membros.find((m) => m.id === evento.membroId)?.apelido ??
                apelidoDeFallback(evento.jogadorId)
              setJogadoresBloqueados((prev) =>
                prev.some((j) => j.jogadorId === evento.jogadorId)
                  ? prev
                  : [...prev, { jogadorId: evento.jogadorId, apelido }],
              )
            }
            if (evento.type === 'MEMBRO_ENTROU') {
              setJogadoresBloqueados((prev) => prev.filter((j) => j.jogadorId !== evento.membro.jogadorId))
            }
            const msg = mensagemDeAviso(evento, salaAnterior)
            if (msg) adicionarAviso(msg, evento.type)
            return
          }
          // Evento desconhecido: não mexe no estado (preserva a sala atual).
          return
      }
    }
  }, [adicionarAviso])

  useEffect(() => {
    conectar()
    return () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const ws = wsRef.current
      if (ws) {
        // Evita reconexão no unmount
        ws.onclose = null
        try {
          ws.close()
        } catch {
          // ignora
        }
        wsRef.current = null
      }
    }
  }, [conectar])

  const enviar = useCallback((comando: SalaComandoDoCliente) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(comando))
    } else {
      // Socket ainda conectando (handshake/reconexão): enfileira para enviar
      // no próximo open, evitando perder o comando silenciosamente.
      comandosPendentesRef.current = [...comandosPendentesRef.current, comando]
    }
  }, [])

  const criarSala = useCallback(() => {
    setErro(null)
    enviar({ type: 'CRIAR_SALA' })
  }, [enviar])

  const entrarNaSala = useCallback(
    (codigoDeSala: CodigoDeSala) => {
      setErro(null)
      const codigo = normalizarCodigoDeSala(codigoDeSala)
      if (!codigo) {
        setErro('Código de Sala inválido')
        return
      }
      enviar({ type: 'ENTRAR_NA_SALA', codigoDeSala: codigo })
    },
    [enviar],
  )

  const alternarProntidao = useCallback(() => {
    // Otimista: inverte localmente a prontidão do membro atual antes de o
    // servidor reconciliar (feedback imediato ao usuário).
    if (jogadorId) {
      setSala((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          membros: prev.membros.map((m) => (m.jogadorId === jogadorId ? { ...m, prontidao: !m.prontidao } : m)),
        }
      })
    }
    enviar({ type: 'ALTERNAR_PRONTIDAO' })
  }, [enviar, jogadorId])

  const sairDaSala = useCallback(() => {
    enviar({ type: 'SAIR_DA_SALA' })
    // Limpeza otimista após comando
    setSala(null)
    // Descarta comandos pendentes de contexto anterior
    comandosPendentesRef.current = []
  }, [enviar])

  const enviarMensagemDeChat = useCallback(
    (conteudo: string) => {
      enviar({ type: 'ENVIAR_MENSAGEM_DE_CHAT', conteudo })
    },
    [enviar],
  )

  const expulsarMembro = useCallback(
    (membroId: string) => {
      enviar({ type: 'EXPULSAR_MEMBRO', membroId })
    },
    [enviar],
  )

  const desbloquearJogador = useCallback(
    (jogadorId: string) => {
      enviar({ type: 'DESBLOQUEAR_JOGADOR', jogadorId })
    },
    [enviar],
  )

  const encerrarSala = useCallback(() => {
    enviar({ type: 'ENCERRAR_SALA' })
  }, [enviar])

  const iniciarPartida = useCallback(() => {
    enviar({ type: 'INICIAR_PARTIDA' })
  }, [enviar])

  return {
    sala,
    avisos,
    mensagensDeChat,
    jogadoresBloqueados,
    conectado,
    erro,
    enviar,
    criarSala,
    entrarNaSala,
    alternarProntidao,
    sairDaSala,
    enviarMensagemDeChat,
    expulsarMembro,
    desbloquearJogador,
    encerrarSala,
    iniciarPartida,
  }
}
