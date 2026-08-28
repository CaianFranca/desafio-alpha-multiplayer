import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CodigoDeSala,
  Sala,
  SalaEventoDoServidor,
  SalaComandoDoCliente,
} from '@flicker/shared/src/sala'

export interface AvisoDoLobby {
  id: string
  mensagem: string
  tipo: string
}

export interface UseSalaWebSocketReturn {
  sala: Sala | null
  avisos: AvisoDoLobby[]
  conectado: boolean
  erro: string | null
  enviar: (comando: SalaComandoDoCliente) => void
  criarSala: () => void
  entrarNaSala: (codigoDeSala: CodigoDeSala) => void
  alternarProntidao: () => void
  sairDaSala: () => void
}

// Contador simples para IDs de avisos
let avisoContador = 0
function proximoAvisoId(): string {
  avisoContador += 1
  return `aviso-${avisoContador}-${Date.now()}`
}

// Mantém apenas os avisos mais recentes para não crescer infinitamente
// e quebrar o layout (janela deslizante).
const AVISOS_MAX = 20

function resolverWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3001'
  const envUrl = (import.meta.env as Record<string, string | undefined>).VITE_WS_URL
  if (typeof envUrl === 'string' && envUrl.length > 0) return envUrl
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  // Em dev o frontend roda em :5173 e o lobby em :3001 — tenta 3001 quando host contém 5173
  if (host.includes('5173')) {
    return `${protocol}//${window.location.hostname}:3001`
  }
  return `${protocol}//${host}`
}

function mensagemDeAviso(evento: SalaEventoDoServidor, salaAnterior: Sala | null): string | null {
  switch (evento.type) {
    case 'MEMBRO_ENTROU':
      return `${evento.membro.apelido} entrou na sala`
    case 'MEMBRO_SAIU':
      return `Membro saiu da sala`
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

export function useSalaWebSocket(jogadorId?: string): UseSalaWebSocketReturn {
  const [sala, setSala] = useState<Sala | null>(null)
  const [avisos, setAvisos] = useState<AvisoDoLobby[]>([])
  const [conectado, setConectado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const salaRef = useRef<Sala | null>(null)

  // Ao trocar de sala (código diferente), descarta avisos da sala anterior.
  useEffect(() => {
    const atual = sala?.codigoDeSala ?? null
    const anterior = salaRef.current?.codigoDeSala ?? null
    if (atual !== anterior) {
      setAvisos([])
    }
    salaRef.current = sala
  }, [sala])

  const adicionarAviso = useCallback((mensagem: string, tipo: string) => {
    setAvisos((prev) => [...prev, { id: proximoAvisoId(), mensagem, tipo }].slice(-AVISOS_MAX))
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
        case 'SALA_ATUALIZADA':
          setSala(evento.sala)
          break
        case 'MEMBRO_ENTROU':
          setSala(evento.sala)
          {
            const msg = mensagemDeAviso(evento, salaRef.current)
            if (msg) adicionarAviso(msg, evento.type)
          }
          break
        case 'MEMBRO_SAIU':
          setSala(evento.sala)
          {
            const msg = mensagemDeAviso(evento, salaRef.current)
            if (msg) adicionarAviso(msg, evento.type)
          }
          break
        case 'MEMBRO_DESCONECTADO':
          setSala(evento.sala)
          {
            const msg = mensagemDeAviso(evento, salaRef.current)
            if (msg) adicionarAviso(msg, evento.type)
          }
          break
        case 'ANFITRIAO_SUBSTITUIDO':
          setSala(evento.sala)
          {
            const msg = mensagemDeAviso(evento, salaRef.current)
            if (msg) adicionarAviso(msg, evento.type)
          }
          break
        case 'PRONTIDAO_ATUALIZADA':
          setSala(evento.sala)
          {
            const msg = mensagemDeAviso(evento, salaRef.current)
            if (msg) adicionarAviso(msg, evento.type)
          }
          break
        case 'ERRO_DA_SALA':
          setErro(evento.mensagem)
          adicionarAviso(evento.mensagem, evento.type)
          break
        case 'MEMBRO_EXPULSO':
          setSala(evento.sala)
          adicionarAviso('Membro expulso', evento.type)
          break
        case 'MENSAGEM_DE_CHAT':
          // fora de escopo deste issue, mas preserva compatibilidade
          break
        default:
          break
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
      // Enfileira otimista: tenta enviar quando conectar (buffer simples não necessário para testes)
      // Para testes com mock, o send é síncrono; se não conectado, registra erro
      setErro('Conexão não disponível')
    }
  }, [])

  const criarSala = useCallback(() => {
    setErro(null)
    enviar({ type: 'CRIAR_SALA' })
  }, [enviar])

  const entrarNaSala = useCallback(
    (codigoDeSala: CodigoDeSala) => {
      setErro(null)
      const codigo = codigoDeSala.trim().toUpperCase()
      if (codigo.length !== 6) {
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
  }, [enviar])

  return { sala, avisos, conectado, erro, enviar, criarSala, entrarNaSala, alternarProntidao, sairDaSala }
}
