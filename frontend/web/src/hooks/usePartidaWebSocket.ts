/**
 * Socket do canal da Partida (issue #85).
 *
 * Rede própria, desacoplada do socket do lobby (`useSalaWebSocket`): abre o
 * WebSocket de jogo em `/ws/game/<serverId>?partida-id=<partidaId>` e roteia
 * os comandos de tabuleiro (SELECIONAR/GIRAR/POSICIONAR/FINALIZAR) pelo canal.
 *
 * Padrão de `useSalaWebSocket`: reconexão simples (1s), fila de comandos
 * pendentes até o `open`, cleanup no unmount. Exceção (issue #329): o
 * fechamento de não-início (par `4000 PARTIDA_NAO_INICIADA`) é terminal —
 * não reagenda reconexão e sinaliza `onPartidaNaoIniciada`. A
 * `ADMISSAO_REJEITADA` com `PARTIDA_NAO_ENCONTRADA` só é terminal no retry
 * pós-não-início (após o close 4000); sem esse contexto, é falha com retry.
*  Trata apenas `ADMISSAO_ACEITA`
 *  (sinaliza que a partida ficou disponível) e eventos da partida
 *  (`EventoDoCanalDaPartida` via callback — tabuleiro, peões/ciclo, turnos
 *  (ST-11), iluminação/limpeza da issue #151 e chat da Partida #390/#389);
 *  mensagens desconhecidas são
 * ignoradas (o socket pode receber PING/PONG ou eventos fora do escopo da
 * ST-09/10/11 sem quebrar o cliente).
 */

import { useCallback, useEffect, useRef } from 'react'
import type {
  AdmissaoAceitaEvento,
  AdmissaoRejeitadaEvento,
  PartidaComandoDoCliente,
  TabuleiroEventoDoServidor,
  PeaoEventoDoServidor,
  PosicaoConfirmadaEvento,
  TurnoEncerradoEvento,
  TurnoIniciadoEvento,
  CelulasIluminadasWireEvento,
  LimpezaAplicadaWireEvento,
  MensagemDeChatDaPartidaEvento,
  PartidaIniciadaEvento,
  EstadoDaPartidaEvento,
  PecaSorteadaEvento,
  VagaDaPecaRecebidaEscolhidaEvento,
  PartidaTerminadaWireEvento,
  AtaqueResolvidoWireEvento,
  ResgateRealizadoWireEvento,
  DesistenciaRegistradaWireEvento,
  JogadorEmReconexaoWireEvento,
  JogadorReconectadoWireEvento,
} from '@flicker/shared'
import { buildGameWsUrl } from '../api/encaminhamento'
import { refreshSession } from '../api/auth'
import { agendarReconexaoComSlide } from './agendarReconexaoComSlide'
import {
  aoAtivarModo,
  aoDesativarModo,
  coletar,
  estaModoAtivo,
  resumirPayload,
} from '../utils/coletorDeDepuracao'

/**
 * Eventos que o canal da Partida entrega à página (issue #156): tabuleiro
*  (ST-09), peões (ST-10), os três eventos de turno (ST-11), iluminação/
 *  limpeza (issue #151), snapshot (PARTIDA_INICIADA/ESTADO_DA_PARTIDA),
 *  monstros/estados (ST-15, issue #174 — ATAQUE_RESOLVIDO/RESGATE_REALIZADO),
 *  desistência (issue #290 — DESISTENCIA_REGISTRADA) e mensagens de chat
 *  (issue #390/#389 — MENSAGEM_DE_CHAT_DA_PARTIDA)
 *  agora roteados exclusivamente pelo contrato de Partida.
 */
export type EventoDoCanalDaPartida =
  | TabuleiroEventoDoServidor
  | PeaoEventoDoServidor
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento
  | CelulasIluminadasWireEvento
  | LimpezaAplicadaWireEvento
  | MensagemDeChatDaPartidaEvento
  | PecaSorteadaEvento
  | VagaDaPecaRecebidaEscolhidaEvento
  | PartidaIniciadaEvento
  | EstadoDaPartidaEvento
  | PartidaTerminadaWireEvento
  | AtaqueResolvidoWireEvento
  | ResgateRealizadoWireEvento
  | DesistenciaRegistradaWireEvento
  | JogadorEmReconexaoWireEvento
  | JogadorReconectadoWireEvento

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
   * Diz se o canal está com socket aberto agora (issue #389): o chat da
   * Partida NÃO enfileira — sem conexão o envio falha localmente com
   * feedback enxuto em vez de entrar na fila de pendentes do handshake.
   */
  estaConectado: () => boolean
  /**
   * Aguarda a conexão abrir até o teto (R2). Resolve `true` imediato se já
   * OPEN, `true` no próximo `open`, `false` no timeout ou no unmount. Sem
   * `timeoutMs`, espera até o open/unmount (saída com retry visível da
   * desistência — issue #290). Usado só pela desistência — o jogo normal
   * segue enfileirando sem esperar.
   */
  aguardarConexao: (timeoutMs?: number) => Promise<boolean>
  /**
   * Remove comandos enfileirados por tipo (issue #290, R2): o "Cancelar" do
   * "saindo" desiste da desistência antes do open — sem isso, o drain do open
   * enviaria um DESISTIR já cancelado pelo usuário.
   */
  removerPendentesPorTipo: (tipo: PartidaComandoDoCliente['type']) => void
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
  /**
   * Chamado quando a Partida é declarada não iniciada (issue #329): caminho
   * terminal, sem reconexão — o Jogador volta à Sala reaberta por gesto
   * próprio (Retorno à Sala). Dispara no fechamento `4000
   * PARTIDA_NAO_INICIADA` do game-server ou na `ADMISSAO_REJEITADA` com
   * `PARTIDA_NAO_ENCONTRADA` do retry pós-não-início (o upgrade já não
   * encontra a Partida cancelada).
   */
  onPartidaNaoIniciada?: () => void
}

/**
 * Fechamento de não-início da Partida (game-server `fecharSocketsDeNaoInicio`,
 * PR #304): par estrito — código de aplicação `4000` com reason
 * `PARTIDA_NAO_INICIADA`. Ambos são exigidos juntos; code ou reason sozinhos
 * caem na reconexão simples.
 */
export const CODIGO_FECHAMENTO_PARTIDA_NAO_INICIADA = 4000
export const MOTIVO_PARTIDA_NAO_INICIADA = 'PARTIDA_NAO_INICIADA'

function fechamentoDeNaoInicio(code: number, reason: string | undefined): boolean {
  return code === CODIGO_FECHAMENTO_PARTIDA_NAO_INICIADA && reason === MOTIVO_PARTIDA_NAO_INICIADA
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
  onPartidaNaoIniciada,
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
  const onPartidaNaoIniciadaRef = useRef(onPartidaNaoIniciada)
  // Pós-não-início (issue #329): marca que o close 4000 já foi visto — só
  // então ADMISSAO_REJEITADA/PARTIDA_NAO_ENCONTRADA é terminal. Sem esse
  // contexto (ex.: primeira entrada com partidaId inválido), cai em falha
  // com retry em vez de diagnóstico enganoso de não-início.
  const viuNaoInicioRef = useRef(false)
  useEffect(() => {
    onEventoRef.current = onEvento
    onAdmissaoRef.current = onAdmissao
    onFalhaDeConexaoRef.current = onFalhaDeConexao
    onPartidaNaoIniciadaRef.current = onPartidaNaoIniciada
  }, [onEvento, onAdmissao, onFalhaDeConexao, onPartidaNaoIniciada])

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

  const encerrarSemReconexao = useCallback((ws: WebSocket) => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    // Socket terminal: nula o handler como no encerramento manual para
    // sinalizar "encerrado sem reconexão" ao inspetor/testes.
    ws.onclose = null
    if (wsRef.current === ws) wsRef.current = null
    try {
      ws.close()
    } catch {
      // ignora
    }
  }, [])

  const conectar = useCallback(() => {
    // Sem alvo (URL sem serverId/partidaId), não há canal para abrir — a
    // conexão fica inerte (a página exibirá tela de falha pelo caminho DEV/não-DEV).
    if (!serverId || !partidaId) return
    if (typeof window === 'undefined') return
    // Novo socket, novo contexto de admissão: o não-início visto numa
    // Partida anterior não contamina a próxima na mesma montagem.
    viuNaoInicioRef.current = false
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
        case 'ADMISSAO_REJEITADA': {
          // Pós-não-início (issue #329): o retry encontra o upgrade sem a
          // Partida cancelada (HTTP 404 `PARTIDA_NAO_ENCONTRADA`) e o canal o
          // entrega como mensagem. Só é o mesmo terminal do close 4000 quando
          // o não-início já foi visto — sem esse contexto (primeira entrada
          // com partidaId inválido/expirado), é falha com retry, não
          // diagnóstico de não-início. Demais códigos de admissão seguem
          // ignorados como antes.
          const codigo = (data as AdmissaoRejeitadaEvento).codigo
          if (codigo === 'PARTIDA_NAO_ENCONTRADA') {
            if (!montadoRef.current) return
            if (viuNaoInicioRef.current) {
              encerrarSemReconexao(ws)
              onPartidaNaoIniciadaRef.current?.()
            } else {
              encerrarSemReconexao(ws)
              onFalhaDeConexaoRef.current()
            }
          }
          return
        }
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
        case 'ATRAVESSOU_O_ESCURO':
        case 'TURNO_INICIADO':
        case 'TURNO_ENCERRADO':
        case 'POSICAO_CONFIRMADA':
        case 'PARTIDA_INICIADA':
        case 'ESTADO_DA_PARTIDA':
        case 'PARTIDA_TERMINADA':
        case 'ATAQUE_RESOLVIDO':
        case 'RESGATE_REALIZADO':
        case 'DESISTENCIA_REGISTRADA':
        case 'MENSAGEM_DE_CHAT_DA_PARTIDA':
        case 'JOGADOR_EM_RECONEXAO':
        case 'JOGADOR_RECONECTADO':
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

    ws.onclose = (event: CloseEvent) => {
      if (!montadoRef.current) return
      wsRef.current = null
      // Não-início (issue #329): a Partida foi declarada não iniciada e o
      // lobby reabriu a Sala — terminal, sem reagendar reconexão (o retry
      // cairia no upgrade 404 em loop). Demais fechamentos mantêm a
      // reconexão simples após 1s.
      if (fechamentoDeNaoInicio(event.code, event.reason)) {
        viuNaoInicioRef.current = true
        encerrarSemReconexao(ws)
        onPartidaNaoIniciadaRef.current?.()
        return
      }
      // Reconexão simples após 1s se ainda montado, com a Sessão renovada
      // antes (issue #376, review PR #383): gate compartilhado em
      // `agendarReconexaoComSlide` — o refresh começa já (aproveita a janela
      // de 1s) e a reconexão aguarda o assentamento.
      // eslint-disable-next-line react-hooks/immutability -- reconexão recursiva segura em runtime
      agendarReconexaoComSlide(reconnectTimerRef, montadoRef, refreshSession(), conectar)
    }

    ws.onerror = () => {
      if (!montadoRef.current) return
      // Falha de conexão não deve reconectar sozinha — exibe tela de falha
      // até retry manual (PartidaPage.tentarNovamenteComConexao, que já renova
      // a Sessão com `await` antes de reconectar). Suprime o agendamento do
      // onclose subsequente.
      ws.onclose = null
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      onFalhaDeConexaoRef.current()
    }
  }, [serverId, partidaId, encerrarSemReconexao])

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

  const estaConectado = useCallback((): boolean => {
    const ws = wsRef.current
    return ws !== null && ws.readyState === WebSocket.OPEN
  }, [])

  const aguardarConexao = useCallback((timeoutMs?: number): Promise<boolean> => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(true)
    return new Promise<boolean>((resolver) => {
      let timer: number | undefined
      const resolverFinal = (abriu: boolean) => {
        if (timer !== undefined) window.clearTimeout(timer)
        resolver(abriu)
      }
      // Sem teto: espera até o open (o cleanup no unmount resolve `false`).
      if (timeoutMs !== undefined) {
        timer = window.setTimeout(() => {
          const pendentes = esperasDeConexaoRef.current
          const indice = pendentes.indexOf(resolverFinal)
          if (indice >= 0) pendentes.splice(indice, 1)
          resolver(false)
        }, timeoutMs)
      }
      esperasDeConexaoRef.current = [...esperasDeConexaoRef.current, resolverFinal]
    })
  }, [])

  const removerPendentesPorTipo = useCallback((tipo: PartidaComandoDoCliente['type']) => {
    comandosPendentesRef.current = comandosPendentesRef.current.filter(
      (comando) => comando.type !== tipo,
    )
  }, [])

  return { conectar, desconectar, enviar, estaConectado, aguardarConexao, removerPendentesPorTipo }
}
