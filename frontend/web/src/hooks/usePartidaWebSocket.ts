/**
 * Socket do canal da Partida (issue #85).
 *
 * Rede própria, desacoplada do socket do lobby (`useSalaWebSocket`): abre o
 * WebSocket de jogo em `/ws/game/<serverId>?partida-id=<partidaId>` e roteia
 * os comandos de tabuleiro (SELECIONAR/GIRAR/POSICIONAR/FINALIZAR) pelo canal.
 *
 * Padrão de `useSalaWebSocket`: reconexão simples (1s), fila de comandos
 * pendentes até o `open`, cleanup no unmount. Trata apenas `ADMISSAO_ACEITA`
 * (sinaliza que a partida ficou disponível) e eventos da partida
 * (`EventoDoCanalDaPartida` via callback — tabuleiro, peões/ciclo, turnos
 * (ST-11) e iluminação/limpeza da issue #151); mensagens desconhecidas são
 * ignoradas (o socket pode receber PING/PONG ou eventos fora do escopo da
 * ST-09/10/11 sem quebrar o cliente).
 */

import { useCallback, useEffect, useRef } from 'react'
import type {
  AdmissaoAceitaEvento,
  PartidaComandoDoCliente,
  TabuleiroComandoDoCliente,
  TabuleiroEventoDoServidor,
  PeaoEventoDoServidor,
  PosicaoConfirmadaEvento,
  TurnoEncerradoEvento,
  TurnoIniciadoEvento,
  CelulasIluminadasWireEvento,
  LimpezaAplicadaWireEvento,
} from '@flicker/shared'
import { buildGameWsUrl } from '../api/encaminhamento'

/**
 * Eventos que o canal da Partida entrega à página (issue #118): tabuleiro
 * (ST-09), peões (ST-10), os três eventos de turno (ST-11) e iluminação/
 * limpeza (issue #151) agora roteados.
 */
export type EventoDoCanalDaPartida =
  | TabuleiroEventoDoServidor
  | PeaoEventoDoServidor
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento
  | CelulasIluminadasWireEvento
  | LimpezaAplicadaWireEvento

export interface UsePartidaWebSocketReturn {
  conectar: () => void
  desconectar: () => void
  /**
   * Envia comando pelo canal (fila até o open). Aceita comandos de tabuleiro
   * (legacy, sem jogadorId) e comandos de peão (com jogadorId injetado).
   */
  enviar: (comando: TabuleiroComandoDoCliente | PartidaComandoDoCliente) => void
}

interface UsePartidaWebSocketOptions {
  serverId: string | null
  partidaId: string | null
  /**
   * Recebe cada evento do canal da partida em ordem de chegada do broadcast:
   * tabuleiro (ST-09), peões/ciclo (ST-10), turnos (ST-11) e iluminação/
   * limpeza (issue #151).
   */
  onEvento: (evento: EventoDoCanalDaPartida) => void
  onAdmissao: (evento: AdmissaoAceitaEvento) => void
  /** Chamado quando a conexão falha (WebSocket não pôde abrir). */
  onFalhaDeConexao: () => void
}

/**
 * Retorna um objeto estável de controle da conexão. Os callbacks são
 * mantidos em refs para que o efeito de conexão não seja recriado a cada
 * re-render do chamador (padrão leve inspirado em `useSalaWebSocket`, que
 * tampouco fecha o socket diante de callbacks instáveis).
 */
export function usePartidaWebSocket({
  serverId,
  partidaId,
  onEvento,
  onAdmissao,
  onFalhaDeConexao,
}: UsePartidaWebSocketOptions): UsePartidaWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  // Comandos enfileirados enquanto o socket ainda não está aberto (handshake).
  const comandosPendentesRef = useRef<(TabuleiroComandoDoCliente | PartidaComandoDoCliente)[]>([])
  // Booleano de montado para impedir setState/reconexão após unmount.
  const montadoRef = useRef(true)
  // Refs dos callbacks: estáveis por instância, sem recriar o efeito.
  const onEventoRef = useRef(onEvento)
  const onAdmissaoRef = useRef(onAdmissao)
  const onFalhaDeConexaoRef = useRef(onFalhaDeConexao)
  useEffect(() => {
    onEventoRef.current = onEvento
    onAdmissaoRef.current = onAdmissao
    onFalhaDeConexaoRef.current = onFalhaDeConexao
  }, [onEvento, onAdmissao, onFalhaDeConexao])

  const encerrarConexao = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    const ws = wsRef.current
    if (ws) {
      // Evita reconexão no unmount.
      ws.onclose = null
      try {
        ws.close()
      } catch {
        // ignora
      }
      wsRef.current = null
    }
  }, [])

  const conectar = useCallback(() => {
    // Sem alvo (URL sem serverId/partidaId), não há canal para abrir — a
    // conexão fica inerte (a página exibirá tela de falha pelo caminho DEV/não-DEV).
    if (!serverId || !partidaId) return
    if (typeof window === 'undefined') return
    const url = buildGameWsUrl(serverId, partidaId)
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      onFalhaDeConexaoRef.current()
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      if (!montadoRef.current) return
      // Drena comandos enfileirados enquanto o socket conectava.
      const pendentes = comandosPendentesRef.current
      comandosPendentesRef.current = []
      for (const comando of pendentes) {
        ws.send(JSON.stringify(comando))
      }
    }

    ws.onmessage = (event: MessageEvent) => {
      let data: unknown
      try {
        data = JSON.parse(event.data as string)
      } catch {
        return
      }
      if (typeof data !== 'object' || data === null || !('type' in data)) return

      switch ((data as { type: string }).type) {
        case 'ADMISSAO_ACEITA':
          onAdmissaoRef.current(data as AdmissaoAceitaEvento)
          return
        case 'PECA_SELECIONADA':
        case 'PECA_DESELECIONADA':
        case 'PECA_GIRADA':
        case 'PECA_POSICIONADA':
        case 'MANIPULACAO_FINALIZADA':
        case 'ERRO_DO_TABULEIRO':
        case 'PEAO_SELECIONADO':
        case 'RECEBIMENTO_GERADO':
        case 'PEAO_POSICIONADO':
        case 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO':
        case 'PEAO_MOVIDO':
        case 'PEAO_PERMANECEU':
        case 'CELULAS_ILUMINADAS':
        case 'LIMPEZA_APLICADA':
        case 'TURNO_INICIADO':
        case 'TURNO_ENCERRADO':
        case 'POSICAO_CONFIRMADA':
          // O grupo de cases acima é intencionalmente vazio (fall-through):
          // todos roteiam ao modelo no mesmo padrão (o motor é autoridade;
          // o cliente apenas espelha).
          onEventoRef.current(data as EventoDoCanalDaPartida)
          return
        default:
          // Evento desconhecido (ex.: PING/PONG, snapshot ST-14): ignora.
          return
      }
    }

    ws.onclose = () => {
      if (!montadoRef.current) return
      wsRef.current = null
      // Reconexão simples após 1s se ainda montado.
      if (reconnectTimerRef.current === null) {
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null
          // eslint-disable-next-line react-hooks/immutability -- reconexão recursiva segura em runtime
          conectar()
        }, 1000)
      }
    }

    ws.onerror = () => {
      if (!montadoRef.current) return
      // Falha de conexão não deve reconectar sozinha — exibe tela de falha
      // até retry manual (PartidaPage.tentarNovamenteComConexao). Suprime o
      // agendamento do onclose subsequente.
      ws.onclose = null
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      onFalhaDeConexaoRef.current()
    }
  }, [serverId, partidaId])

  useEffect(() => {
    montadoRef.current = true
    conectar()
    return () => {
      montadoRef.current = false
      encerrarConexao()
    }
  }, [conectar, encerrarConexao])

  const desconectar = useCallback(() => {
    comandosPendentesRef.current = []
    encerrarConexao()
  }, [encerrarConexao])

  const enviar = useCallback((comando: TabuleiroComandoDoCliente | PartidaComandoDoCliente) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(comando))
    } else {
      // Socket ainda conectando (handshake/reconexão): enfileira para enviar
      // no próximo open, evitando perder o comando silenciosamente.
      comandosPendentesRef.current = [...comandosPendentesRef.current, comando]
    }
  }, [])

  return { conectar, desconectar, enviar }
}
