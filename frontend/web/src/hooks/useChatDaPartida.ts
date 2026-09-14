/**
 * Estado do painel de chat da Partida (issue #389).
 *
 * Dono único do feed (ordem de chegada — sem sort, mesmo critério do lobby:
 * horários de relógios diferentes reordenariam o feed), do badge de não
 * lidas, do painel aberto/fechado e do cooldown local pós-rate-limit.
 *
 * O cooldown é espelho do servidor (issue #390): o game-server impõe o ritmo
 * (`INTERVALO_MINIMO_ENTRE_MENSAGENS_MS`) e recusa com LIMITE_DE_MENSAGENS;
 * o cliente só CONGELA a janela ao receber a recusa — nunca inicia o
 * cooldown por conta própria (o servidor é a autoridade do tempo entre
 * mensagens). As demais recusas (vazia/longa) viram feedback enxuto.
 *
 * Envio nunca enfileira: `estaConectado()` falho = recusa local imediata,
 * fora da fila de pendentes do handshake (o chat não pode "pegar carona" no
 * drain do open) — e a corrida OPEN→close que retornar `enfileirado` é
 * purgada da fila via `descartarPendentesPorTipo` (B1). O blip (WebAudio,
 * ADR-0007) toca só com o painel fechado para mensagens de terceiros,
 * coalescido por lote de rajada (~250ms).
 *
 * O estado é por Partida (`partidaId`): trocar de Partida no mesmo mount
 * reseta feed, não-lidas, anúncio e guardas — sem vazar conversa (B3).
 * O anúncio para leitor de tela (`anuncio`) avança SÓ no live; a semente do
 * histórico nunca anuncia conversa velha como nova (R2).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ErroDoTabuleiroEvento,
  MensagemDeChatDaPartidaEvento,
  PartidaComandoDoCliente,
} from '@flicker/shared'
import { tocarBlipDoChat } from '../components/partida/somDeBlipDoChat'

/** Limite de caracteres espelhado do game-server (handlers.ts, issue #390). */
export const LIMITE_DE_CARACTERES_DO_CHAT = 300

/** Janela do cooldown local após a recusa LIMITE_DE_MENSAGENS (espelho do servidor). */
export const INTERVALO_MINIMO_ENTRE_MENSAGENS_MS = 2000

/** Coalescência do blip: um blip por lote de rajada dentro desta janela. */
export const INTERVALO_DE_COALESCENCIA_DO_BLIP_MS = 250

/** Teto do feed em memória (mesmo padrão do lobby, useSalaWebSocket #200). */
export const TETO_DE_MENSAGENS_DO_FEED = 200

/** Tempo de exibição do feedback enxuto de recusa. */
export const TEMPO_DE_EXIBICAO_DA_RECUSA_MS = 3000

/** Recusas do chat (tabuleiro.ts:147-149): rota própria do painel, sem som. */
export const CODIGOS_DE_RECUSA_DO_CHAT = [
  'MENSAGEM_VAZIA',
  'MENSAGEM_LONGA_DEMAIS',
  'LIMITE_DE_MENSAGENS',
] as const

export type CodigoDeRecusaDoChat = (typeof CODIGOS_DE_RECUSA_DO_CHAT)[number]

export interface MensagemDoChatDaPartida {
  readonly id: number
  readonly jogadorId: string
  readonly apelido: string
  readonly conteudo: string
  readonly enviadoEm: string
}

/**
 * Hora HH:MM local do marco ISO 8601 do servidor (o feed usa o horário do
 * navegador, como o lobby). Puro e determinístico: entra sem timezone
 * (ex.: testes com '2026-09-14T14:05:00') vira hora local estável.
 */
export function formatarHora(iso: string): string {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return '--:--'
  const horas = String(data.getHours()).padStart(2, '0')
  const minutos = String(data.getMinutes()).padStart(2, '0')
  return `${horas}:${minutos}`
}

interface UseChatDaPartidaOptions {
  /** Partida vigente: a troca reseta todo o estado do painel (B3). */
  partidaId: string | null
  /** Sessão autenticada do Jogador local (id da própria mensagem). */
  jogadorId: string | null
  /** Socket do canal da Partida: true só com OPEN (nunca enfileira o chat). */
  estaConectado: () => boolean
  /** Envia pelo canal; o hook monta o comando de chat com o jogadorId. */
  enviar: (comando: PartidaComandoDoCliente) => 'enviado' | 'enfileirado'
  /** Purga a fila de pendentes do handshake (B1: chat nunca pega o drain). */
  descartarPendentesPorTipo: (tipo: PartidaComandoDoCliente['type']) => void
}

export function useChatDaPartida({
  partidaId,
  jogadorId,
  estaConectado,
  enviar: enviarComando,
  descartarPendentesPorTipo,
}: UseChatDaPartidaOptions) {
  const [mensagens, setMensagens] = useState<MensagemDoChatDaPartida[]>([])
  const [naoLidas, setNaoLidas] = useState(0)
  const [aberto, setAberto] = useState(false)
  const [cooldownAte, setCooldownAte] = useState<number | null>(null)
  // Relógio do cooldown (lint: o painel não pode chamar Date.now no render —
  // ele lê `emCooldown`, derivado aqui com tique só durante a janela).
  const [agora, setAgora] = useState(() => Date.now())
  const [recusa, setRecusa] = useState<string | null>(null)
  // Anúncio SR só do live (R2): a semente do histórico alimenta o feed sem
  // tocar aqui, então reconexão não anuncia conversa velha como nova.
  const [anuncio, setAnuncio] = useState<MensagemDoChatDaPartida | null>(null)

  // Refs dos estados lidos em callbacks estáveis (o socket guarda o callback
  // em ref e não re-subscreve — o mesmo padrão de modeloRef/emResultadoRef).
  const abertoRef = useRef(aberto)
  useEffect(() => {
    abertoRef.current = aberto
  }, [aberto])
  const cooldownAteRef = useRef(cooldownAte)
  useEffect(() => {
    cooldownAteRef.current = cooldownAte
  }, [cooldownAte])
  const proximoIdRef = useRef(0)
  const ultimoBlipEmRef = useRef(0)
  const historicoHidratadoRef = useRef(false)
  const timerDoCooldownRef = useRef<number | null>(null)
  const timerDaRecusaRef = useRef<number | null>(null)

  // Limpeza dos timers no unmount (mesmo padrão do aviso de desistência).
  useEffect(
    () => () => {
      if (timerDoCooldownRef.current !== null) window.clearTimeout(timerDoCooldownRef.current)
      if (timerDaRecusaRef.current !== null) window.clearTimeout(timerDaRecusaRef.current)
    },
    [],
  )

  // Troca de Partida no mesmo mount (B3): reseta feed, régua de leitura,
  // anúncio e guardas — a conversa da Partida anterior não pode vazar.
  // Roda também no mount (valores já iniciais — no-op). Mesmo padrão do
  // reset de sala do lobby (useSalaWebSocket) — reset intencional por troca
  // de contexto, não estado derivado do render.
  useEffect(() => {
    if (timerDoCooldownRef.current !== null) {
      window.clearTimeout(timerDoCooldownRef.current)
      timerDoCooldownRef.current = null
    }
    if (timerDaRecusaRef.current !== null) {
      window.clearTimeout(timerDaRecusaRef.current)
      timerDaRecusaRef.current = null
    }
    proximoIdRef.current = 0
    ultimoBlipEmRef.current = 0
    historicoHidratadoRef.current = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAgora(Date.now())
    setMensagens([])
    setNaoLidas(0)
    setAberto(false)
    setCooldownAte(null)
    setRecusa(null)
    setAnuncio(null)
  }, [partidaId])

  const agendarLimpezaDaRecusa = useCallback(() => {
    if (timerDaRecusaRef.current !== null) window.clearTimeout(timerDaRecusaRef.current)
    timerDaRecusaRef.current = window.setTimeout(() => {
      timerDaRecusaRef.current = null
      setRecusa((atual) => (atual !== null ? null : atual))
    }, TEMPO_DE_EXIBICAO_DA_RECUSA_MS)
  }, [])

  // Semente do histórico (issue #388, fronteira do #389): snapshot de
  // Reconexão carrega tabuleiro + chat do mesmo instante, sem replay
  // separado. Hidrata uma única vez; live posterior só acrescenta.
  // Ausente (binário anterior ao #388) ≡ [] — no-op.
  // Corrida live-antes-do-snapshot (B2): o live que chegou antes é mais novo
  // que a semente — a semente entra ANTES, com dedupe por identidade
  // (jogadorId|enviadoEm|conteudo), então eco do servidor não duplica.
  const hidratarHistorico = useCallback(
    (historico: readonly MensagemDeChatDaPartidaEvento[] | undefined | null) => {
      if (historicoHidratadoRef.current) return
      if (!historico || historico.length === 0) return
      historicoHidratadoRef.current = true
      const semente: MensagemDoChatDaPartida[] = historico.map((evento) => {
        proximoIdRef.current += 1
        return {
          id: proximoIdRef.current,
          jogadorId: evento.jogadorId,
          apelido: evento.apelido,
          conteudo: evento.conteudo,
          enviadoEm: evento.enviadoEm,
        }
      })
      setMensagens((atual) => {
        if (atual.length === 0) return semente.slice(-TETO_DE_MENSAGENS_DO_FEED)
        const vistas = new Set(atual.map(identidadeDaMensagem))
        const faltantes = semente.filter((m) => !vistas.has(identidadeDaMensagem(m)))
        return [...faltantes, ...atual].slice(-TETO_DE_MENSAGENS_DO_FEED)
      })
    },
    [],
  )

  const aoEventoDeChat = useCallback(
    (evento: MensagemDeChatDaPartidaEvento) => {
      proximoIdRef.current += 1
      const mensagem: MensagemDoChatDaPartida = {
        id: proximoIdRef.current,
        jogadorId: evento.jogadorId,
        apelido: evento.apelido,
        conteudo: evento.conteudo,
        enviadoEm: evento.enviadoEm,
      }
      setMensagens((atual) => [...atual, mensagem].slice(-TETO_DE_MENSAGENS_DO_FEED))
      // Único avanço do anúncio SR (R2): só live anuncia.
      setAnuncio(mensagem)
      // Badge e blip só para mensagens de terceiros com o painel fechado:
      // eco da própria não "conta" como não-lida (a janela estava aberta
      // para enviar) e o aberto fecha a régua de leitura.
      const ehPropria = jogadorId !== null && evento.jogadorId === jogadorId
      if (abertoRef.current || ehPropria) return
      setNaoLidas((n) => n + 1)
      // Coalescência de rajada: um blip por lote dentro da janela (~250ms).
      const agora = Date.now()
      if (agora - ultimoBlipEmRef.current >= INTERVALO_DE_COALESCENCIA_DO_BLIP_MS) {
        ultimoBlipEmRef.current = agora
        tocarBlipDoChat()
      }
    },
    [jogadorId],
  )

  const aoErroDeChat = useCallback(
    (evento: ErroDoTabuleiroEvento) => {
      // Desistente fora do roster (R1): o servidor recusa o envio com
      // JOGADOR_NAO_NA_PARTIDA — a página só roteia até aqui sem reenvio de
      // desistência pendente (o caso R2 com pendência segue silencioso lá).
      if (evento.codigo === 'JOGADOR_NAO_NA_PARTIDA') {
        setRecusa('Sua sessão não está conectada à partida.')
        agendarLimpezaDaRecusa()
        return
      }
      // Guarda dupla (o roteador da página já filtra): recusas de outros
      // domínios (ex.: FORA_DA_VEZ) nunca chegam ao painel — feedback é só
      // do chat, e mensagemDaRecusa não tem ramo para códigos alheios.
      if (!CODIGOS_DE_RECUSA_DO_CHAT.includes(evento.codigo as CodigoDeRecusaDoChat)) return
      const codigo = evento.codigo as CodigoDeRecusaDoChat
      if (codigo === 'LIMITE_DE_MENSAGENS') {
        // Congela o input na janela do servidor; o timeout devolve o estado
        // e re-renderiza (o input reabilita sozinho ao expirar).
        const ate = Date.now() + INTERVALO_MINIMO_ENTRE_MENSAGENS_MS
        setCooldownAte(ate)
        if (timerDoCooldownRef.current !== null) window.clearTimeout(timerDoCooldownRef.current)
        timerDoCooldownRef.current = window.setTimeout(() => {
          timerDoCooldownRef.current = null
          setCooldownAte((atual) => (atual !== null && atual <= Date.now() ? null : atual))
        }, INTERVALO_MINIMO_ENTRE_MENSAGENS_MS + 100)
      }
      setRecusa(mensagemDaRecusa(codigo))
      agendarLimpezaDaRecusa()
    },
    [agendarLimpezaDaRecusa],
  )

  // Tique da janela do cooldown: re-renderiza o painel 4×/s só enquanto o
  // input está congelado, para o `disabled` cair sozinho ao expirar.
  useEffect(() => {
    if (cooldownAte === null) return
    const id = window.setInterval(() => setAgora(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [cooldownAte])

  const emCooldown = cooldownAte !== null && cooldownAte > agora

  const abrir = useCallback(() => {
    setAberto(true)
    setNaoLidas(0)
  }, [])

  const fechar = useCallback(() => {
    setAberto(false)
  }, [])

  const enviar = useCallback(
    (conteudo: string): boolean => {
      const texto = conteudo.trim()
      if (texto.length === 0) {
        setRecusa('Escreva uma mensagem antes de enviar.')
        agendarLimpezaDaRecusa()
        return false
      }
      if (texto.length > LIMITE_DE_CARACTERES_DO_CHAT) {
        setRecusa('Mensagem longa demais para o chat.')
        agendarLimpezaDaRecusa()
        return false
      }
      const emCooldown =
        cooldownAteRef.current !== null && cooldownAteRef.current > Date.now()
      if (emCooldown) {
        setRecusa('Muitas mensagens em pouco tempo. Aguarde para enviar de novo.')
        agendarLimpezaDaRecusa()
        return false
      }
      if (jogadorId === null) {
        setRecusa('Sua sessão não está conectada à partida.')
        agendarLimpezaDaRecusa()
        return false
      }
      if (!estaConectado()) {
        setRecusa('Sem conexão com o servidor: sua mensagem não foi enviada.')
        agendarLimpezaDaRecusa()
        return false
      }
      // Corrida OPEN→close: `enviar` pode enfileirar em vez de entregar —
      // o chat nunca pega carona no drain do handshake, então enfileirado
      // purga a fila e vira a mesma recusa local enxuta do sem-conexão (B1).
      const destino = enviarComando({ type: 'ENVIAR_MENSAGEM_DE_CHAT', jogadorId, conteudo: texto })
      if (destino === 'enfileirado') {
        descartarPendentesPorTipo('ENVIAR_MENSAGEM_DE_CHAT')
        setRecusa('Sem conexão com o servidor: sua mensagem não foi enviada.')
        agendarLimpezaDaRecusa()
        return false
      }
      if (timerDaRecusaRef.current !== null) window.clearTimeout(timerDaRecusaRef.current)
      setRecusa(null)
      return true
    },
    [jogadorId, estaConectado, enviarComando, descartarPendentesPorTipo, agendarLimpezaDaRecusa],
  )

  return {
    mensagens,
    naoLidas,
    aberto,
    emCooldown,
    recusa,
    anuncio,
    abrir,
    fechar,
    enviar,
    aoEventoDeChat,
    aoErroDeChat,
    hidratarHistorico,
  }
}

/** Identidade de dedupe semente×live (B2): eco do servidor não duplica. */
function identidadeDaMensagem(mensagem: Pick<MensagemDoChatDaPartida, 'jogadorId' | 'enviadoEm' | 'conteudo'>): string {
  return `${mensagem.jogadorId}|${mensagem.enviadoEm}|${mensagem.conteudo}`
}

/** Feedback enxuto por código de recusa do chat (anunciado via aria-live). */
function mensagemDaRecusa(codigo: CodigoDeRecusaDoChat): string {
  switch (codigo) {
    case 'MENSAGEM_VAZIA':
      return 'Escreva uma mensagem antes de enviar.'
    case 'MENSAGEM_LONGA_DEMAIS':
      return 'Mensagem longa demais para o chat.'
    case 'LIMITE_DE_MENSAGENS':
      return 'Muitas mensagens em pouco tempo. Aguarde para enviar de novo.'
  }
}