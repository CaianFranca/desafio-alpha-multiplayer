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
  TabuleiroEventoDoServidor,
  PeaoEventoDoServidor,
  PosicaoConfirmadaEvento,
  TurnoEncerradoEvento,
  TurnoIniciadoEvento,
  CelulasIluminadasWireEvento,
  LimpezaAplicadaWireEvento,
  PartidaIniciadaEvento,
  EstadoDaPartidaEvento,
  PecaSorteadaEvento,
  VagaDaPecaRecebidaEscolhidaEvento,
  PartidaTerminadaWireEvento,
  AtaqueResolvidoWireEvento,
  ResgateRealizadoWireEvento,
  DesistenciaRegistradaWireEvento,
} from '@flicker/shared'
import { buildGameWsUrl } from '../api/encaminhamento'
import {
  aoAtivarModo,
  aoDesativarModo,
  coletar,
  estaModoAtivo,
  resumirPayload,
} from '../utils/coletorDeDepuracao'

/**
 * Eventos que o canal da Partida entrega à página (issue #156): tabuleiro
 * (ST-09), peões (ST-10), os três eventos de turno (ST-11), iluminação/
 * limpeza (issue #151), snapshot (PARTIDA_INICIADA/ESTADO_DA_PARTIDA),
 * monstros/estados (ST-15, issue #174 — ATAQUE_RESOLVIDO/RESGATE_REALIZADO)
 * e desistência (issue #290 — DESISTENCIA_REGISTRADA)
 * agora roteados exclusivamente pelo contrato de Partida.
 */
export type EventoDoCanalDaPartida =
  | TabuleiroEventoDoServidor
  | PeaoEventoDoServidor
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento
  | CelulasIluminadasWireEvento
  | LimpezaAplicadaWireEvento
  | PecaSorteadaEvento
  | VagaDaPecaRecebidaEscolhidaEvento
  | PartidaIniciadaEvento
  | EstadoDaPartidaEvento
  | PartidaTerminadaWireEvento
  | AtaqueResolvidoWireEvento
  | ResgateRealizadoWireEvento
  | DesistenciaRegistradaWireEvento

export interface UsePartidaWebSocketReturn {
  conectar: () => void
  desconectar: () => void
  /**
   * Envia comando pelo canal (fila até o open). Apenas PartidaComandoDoCliente
   * com jogadorId — legado Tabuleiro/Peao sem jogadorId removido (#156).
   * Devolve 'enviado' (socket OPEN) ou 'enfileirado' (handshake/reconexão) —
   * a desistência (issue #290, R2) usa o retorno para aguardar o OPEN antes
   * de desconectar.
   */
  enviar: (comando: PartidaComandoDoCliente) => 'enviado' | 'enfileirado'
  /**
   * Aguarda a conexão abrir até o teto (R2). Resolve `true` imediato se já
   * OPEN, `true` no próximo `open`, `false` no timeout. Usado só pela
   * desistência — o jogo normal segue enfileirando sem esperar.
   */
  aguardarConexao: (timeoutMs?: number) => Promise<boolean>
}

interface UsePartidaWebSocketOptions {
  serverId: string | null
  partidaId: string | null
  /**
   * Recebe cada evento do canal da partida em ordem de chegada do broadcast:
   * tabuleiro (ST-09), peões/ciclo (ST-10), turnos (ST-11), iluminação/
   * limpeza (issue #151) e monstros/estados (ST-15, issue #174).
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
  const comandosPendentesRef = useRef<PartidaComandoDoCliente[]>([])
  // Esperas de conexão da desistência (R2): resolvidas com `true` a cada open.
  const esperasDeConexaoRef = useRef<Array<(abriu: boolean) => void>>([])
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
      // Desistência (R2): acorda quem aguarda o OPEN.
      const esperas = esperasDeConexaoRef.current
      esperasDeConexaoRef.current = []
      for (const resolver of esperas) {
        try {
          resolver(true)
        } catch {
          // ignora
        }
      }
      // Stream de debug do backend (issue #340): o escopo é a Partida da
      // conexão (o `partida-id` do upgrade); enviado a cada open/reconexão.
      if (estaModoAtivo()) {
        coletar('ws→', 'info', () => resumirPayload({ type: 'ATIVAR_DEBUG' }), 'partida')
        ws.send(JSON.stringify({ type: 'ATIVAR_DEBUG' }))
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

      // Depuração (issue #340): linha espelhada do backend (DEBUG_LOG) vira
      // fonte `backend`; o tráfego comum é capturado como `ws←` com payload
      // truncado. DEBUG_LOG não é tráfego de aplicação — não vai como ws←.
      const tipoDaMensagem = (data as { type?: unknown }).type
      if (tipoDaMensagem === 'DEBUG_LOG') {
        const evento = data as unknown as { nivel: 'info' | 'warn' | 'error'; contexto?: string; mensagem: string }
        coletar('backend', evento.nivel, evento.mensagem, evento.contexto ?? 'partida')
        return
      }
      coletar('ws←', 'info', () => resumirPayload(data), 'partida')

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
        case 'PEAO_DESELECIONADO':
        case 'RECEBIMENTO_GERADO':
        case 'PEAO_POSICIONADO':
        case 'PEAO_MOVIDO':
        case 'PEAO_PERMANECEU':
        case 'CELULAS_ILUMINADAS':
        case 'LIMPEZA_APLICADA':
        case 'PECA_SORTEADA':
        case 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO':
        case 'TURNO_INICIADO':
        case 'TURNO_ENCERRADO':
        case 'POSICAO_CONFIRMADA':
        case 'PARTIDA_INICIADA':
        case 'ESTADO_DA_PARTIDA':
        case 'PARTIDA_TERMINADA':
        case 'ATAQUE_RESOLVIDO':
        case 'RESGATE_REALIZADO':
        case 'DESISTENCIA_REGISTRADA':
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
    // Ativação em sessão corrente (issue #340): envia o controle no instante
    // da ativação (ou enfileira se o socket ainda conecta). Uma única
    // assinatura por montagem, lendo o socket vigente via ref.
    const desinscreverAtivacao = aoAtivarModo(() => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        coletar('ws→', 'info', () => resumirPayload({ type: 'ATIVAR_DEBUG' }), 'partida')
        ws.send(JSON.stringify({ type: 'ATIVAR_DEBUG' }))
      } else if (ws) {
        comandosPendentesRef.current = [...comandosPendentesRef.current, { type: 'ATIVAR_DEBUG' }]
      }
    })
    // Desativação em sessão corrente (issue #340): espelha o ATIVAR_DEBUG no
    // instante do Desligar (ou enfileira se o socket ainda conecta).
    const desinscreverDesativacao = aoDesativarModo(() => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        coletar('ws→', 'info', () => resumirPayload({ type: 'DESATIVAR_DEBUG' }), 'partida')
        ws.send(JSON.stringify({ type: 'DESATIVAR_DEBUG' }))
      } else if (ws) {
        comandosPendentesRef.current = [...comandosPendentesRef.current, { type: 'DESATIVAR_DEBUG' }]
      }
    })
    conectar()
    return () => {
      desinscreverAtivacao()
      desinscreverDesativacao()
      montadoRef.current = false
      const esperas = esperasDeConexaoRef.current
      esperasDeConexaoRef.current = []
      for (const resolver of esperas) {
        try {
          resolver(false)
        } catch {
          // ignora
        }
      }
      encerrarConexao()
    }
  }, [conectar, encerrarConexao])

  const desconectar = useCallback(() => {
    // Preserva DESISTIR_DA_PARTIDA enfileirado (#290, R2): no timeout do
    // aguardarConexao a página navega mesmo assim, mas o comando continua
    // válido para a próxima abertura do socket em vez de ser descartado em
    // silêncio. Demais comandos de contexto anterior são descartados.
    comandosPendentesRef.current = comandosPendentesRef.current.filter(
      (comando) => comando.type === 'DESISTIR_DA_PARTIDA',
    )
    encerrarConexao()
  }, [encerrarConexao])

  const enviar = useCallback((comando: PartidaComandoDoCliente): 'enviado' | 'enfileirado' => {
    // Captura de saída no stream de depuração (issue #340): fonte `ws→`,
    // contexto `partida`, payload truncado.
    coletar('ws→', 'info', () => resumirPayload(comando), 'partida')
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(comando))
      return 'enviado'
    }
    // Socket ainda conectando (handshake/reconexão): enfileira para enviar
    // no próximo open, evitando perder o comando silenciosamente.
    comandosPendentesRef.current = [...comandosPendentesRef.current, comando]
    return 'enfileirado'
  }, [])

  const aguardarConexao = useCallback((timeoutMs = 2000): Promise<boolean> => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(true)
    return new Promise<boolean>((resolver) => {
      const timer = window.setTimeout(() => {
        const pendentes = esperasDeConexaoRef.current
        const indice = pendentes.indexOf(resolverFinal)
        if (indice >= 0) pendentes.splice(indice, 1)
        resolver(false)
      }, timeoutMs)
      const resolverFinal = (abriu: boolean) => {
        window.clearTimeout(timer)
        resolver(abriu)
      }
      esperasDeConexaoRef.current = [...esperasDeConexaoRef.current, resolverFinal]
    })
  }, [])

  return { conectar, desconectar, enviar, aguardarConexao }
}
