import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AmbienteDeJogo } from '../components/partida/AmbienteDeJogo'
import { HudDaPartida } from '../components/partida/HudDaPartida'
import { useViewportCompacto } from '../hooks/useViewportCompacto'
import { PartidaMoldura } from '../components/partida/PartidaMoldura'
import { PartidaOverlays } from '../components/partida/PartidaOverlays'
import { usePartidaTela } from '../components/partida/usePartidaTela'
import type { EstadoDaTela } from '../components/partida/partidaTelaMachine'
import {
  motivoDeRecusaDoEvento,
  textoDoAnuncioDeRecusa,
  tocarSomDeRecusa,
} from '../components/partida/somDeRecusa'
import { tocarConquistasDaConfirmacao } from '../components/partida/somDaConquista'
import { TransicaoAtaque } from '../components/partida/TransicaoAtaque'
import { useFilaDeAtaque } from '../components/partida/useFilaDeAtaque'
import type { FatiaDoAtaque } from '../game/tabuleiro/ataque'
import type { EstadoVisualDoAtaque } from '../game/tabuleiro/ataque'
import { CAMINHO_SOM_SOMBRIO_LIMPEZA } from '../game/tabuleiro/animacao'
import {
  origemDoEncaixe,
  tocarSomDeMovimentoDoEncaixe,
  tocarSomDeGiroDoEncaixe,
} from '../components/partida/somDoEncaixe'
import type { EncaixeTrigger } from '../game/tabuleiro/encaixe'
import { deveReduzirMovimento } from '../hooks/usePrefersReducedMotion'
import { tocarSom } from '../game/audio/sons'
import type { MotivoDeRecusa } from '../components/partida/somDeRecusa'
import {
  deveLimparVooNoSnapshot,
  deveTocarCliqueDoPeao,
  limparVooAoAterrissar,
  tocarCliqueDoPeao,
  vooDoPeaoDoEvento,
} from '../game/tabuleiro/vooDoPeao'
import type { VooDoPeaoPendente } from '../game/tabuleiro/vooDoPeao'
import { usePartidaWebSocket } from '../hooks/usePartidaWebSocket'
import { definirFase } from '../utils/coletorDeDepuracao'
import { useRequerModoPaisagem } from '../hooks/useModoPaisagemCelular'
import { OverlayModoPaisagem } from '../components/partida/OverlayModoPaisagem'
import { aplicarSnapshot } from '../game/tabuleiro/snapshot'
import {
  chaveDeComandoPendente,
  consumirAck,
} from '../game/tabuleiro/pendentes'
import {
  criarEstadoInicialDoCliente,
  reduzirEvento,
  reduzirFatiaDoAtaque,
  estadoDeExibicaoDoModelo,
  peoesEmBaixaIluminacaoDe,
} from '../game/tabuleiro/reducao'
import type { EstadoDoTabuleiroNoCliente, SanidadePorPeao } from '../game/tabuleiro/reducao'
import { mapearFinalizarManipulacao, mapearGiro } from '../game/tabuleiro/interacao'
import type { ComandoDePeaoDoDespacho, EstadoInteracaoPeoes } from '../game/tabuleiro/interacaoPeoes'
import { bordaDaTravessiaPendente, mapearFinalizarRecebida } from '../game/tabuleiro/interacaoPeoes'
import type { PeaoId } from '../game/tabuleiro/contrato'
import { giroAlteraConexao, quantidadeValidaDeJogadores, ehPecaDeMonstro } from '../game/tabuleiro/contrato'
import { useAuth } from '../state/useAuth'
import { useSalaCodigoOptional, useQuantidadeDeMembrosDaSalaOptional, useMarcarSaidaPropriaOptional } from '../state/sala-web-socket-context'
import { normalizarCodigoDeSala } from '../utils/codigoDeSala'
import type {
  CelulasIluminadasWireEvento,
  AtravessarOEscuroPartidaComando,
  ConfirmarPosicaoDoPeaoComando,
  DesistirDaPartidaComando,
  EncerrarTurnoComando,
  EstadoDaPartidaSnapshot,
  LimpezaAplicadaWireEvento,
  PartidaComandoDoCliente,
  PeaoComandoDoCliente,
  TabuleiroComandoDoCliente,
  TurnoEncerradoEvento,
  TurnoIniciadoEvento,
} from '@flicker/shared'

/** Comandos do canal: tabuleiro (ST-09), peões (ST-10), turnos (ST-11, #118),
 * travessia do escuro (ADR-0017 / issue #377 — viaja no canal de Partida com
 * jogadorId, mas nasce do ciclo do Peão) e desistência (#290), sem o
 * jogadorId — injetado uma única vez em enviarComJogador. */
type ComandoDoCanal =
  | TabuleiroComandoDoCliente
  | PeaoComandoDoCliente
  | Omit<AtravessarOEscuroPartidaComando, 'jogadorId'>
  | Omit<ConfirmarPosicaoDoPeaoComando, 'jogadorId'>
  | Omit<EncerrarTurnoComando, 'jogadorId'>
  | Omit<DesistirDaPartidaComando, 'jogadorId'>

type AcaoDoModelo =
  | { type: 'EVENTO'; evento: Parameters<typeof reduzirEvento>[1] }
  | { type: 'FATIA_DE_ATAQUE'; fatia: FatiaDoAtaque }
  | { type: 'APLICAR_SNAPSHOT'; snapshot: EstadoDaPartidaSnapshot }
  | { type: 'SYNC_QUANTIDADE'; quantidade: number }

function reduzirModelo(
  estado: EstadoDoTabuleiroNoCliente,
  acao: AcaoDoModelo,
): EstadoDoTabuleiroNoCliente {
  if (acao.type === 'APLICAR_SNAPSHOT') {
    return aplicarSnapshot(estado, acao.snapshot)
  }
  if (acao.type === 'FATIA_DE_ATAQUE') {
    return reduzirFatiaDoAtaque(estado, acao.fatia)
  }
  if (acao.type === 'SYNC_QUANTIDADE') {
    // Sincroniza seed pré-snapshot (risco 3): se ainda sem snapshot de roster,
    // recria o estado inicial com o N atualizado da Sala. Com jogadores já
    // presentes (snapshot), a autoridade é do servidor — não sobrescreve.
    if (Object.keys(estado.jogadorPorId).length > 0) return estado
    if (estado.quantidadeParaLayout === acao.quantidade) return estado
    return criarEstadoInicialDoCliente(acao.quantidade)
  }
  return reduzirEvento(estado, acao.evento)
}

interface PartidaPageProps {
  estadoInicial?: EstadoDaTela
  loader?: () => Promise<unknown>
}

/**
 * Pendência de desistência não entregue (R2, issue #290): "Sair mesmo assim"
 * ou aba fechada durante o "saindo" gravam aqui (localStorage — sobrevive ao
 * fechar a aba); a próxima visita reenvia no primeiro open e limpa ao
 * entregar. Chave escopada por partida; valor = jogadorId autor.
 */
function chaveDesistenciaPendente(partidaId: string): string {
  return `partida-desistir-pendente:${partidaId}`
}

function lerDesistenciaPendente(partidaId: string | null): string | null {
  if (typeof window === 'undefined' || partidaId === null) return null
  try {
    return window.localStorage.getItem(chaveDesistenciaPendente(partidaId))
  } catch {
    return null
  }
}

function gravarDesistenciaPendente(partidaId: string | null, jogadorId: string): void {
  if (typeof window === 'undefined' || partidaId === null) return
  try {
    window.localStorage.setItem(chaveDesistenciaPendente(partidaId), jogadorId)
  } catch {
    // Armazenamento indisponível: vale o retry em memória da sessão atual.
  }
}

function limparDesistenciaPendente(partidaId: string | null): void {
  if (typeof window === 'undefined' || partidaId === null) return
  try {
    window.localStorage.removeItem(chaveDesistenciaPendente(partidaId))
  } catch {
    // Sem armazenamento, nada a limpar.
  }
}

export function PartidaPage({ estadoInicial, loader }: PartidaPageProps) {
  const [searchParams] = useSearchParams()
  const serverId = searchParams.get('serverId')
  const partidaId = searchParams.get('partidaId')
  const temAlvo = Boolean(serverId && partidaId)

  const { authState } = useAuth()
  const jogadorId =
    authState.status === 'authenticated' ? authState.jogador.id : null
  const navigate = useNavigate()
  const codigoDeSala = useSalaCodigoOptional()
  // F2 (#290): limpeza otimista da sala do lobby ao desistir — o broadcast
  // MEMBRO_SAIU reconcilia depois (idempotente), mas não é a única fonte.
  const marcarSaidaPropria = useMarcarSaidaPropriaOptional()
  // Retorno à Sala (issue #329): o redirect do Encaminhamento usa
  // window.location.assign (reload) e o contexto da Sala morre na /partida —
  // ?codigoDeSala= é o fallback que sobrevive ao reload. Contexto primeiro,
  // URL depois, /salas/criar por último.
  const codigoDeSalaUrl = normalizarCodigoDeSala(searchParams.get('codigoDeSala') ?? '')
  const codigoEfetivo = codigoDeSala ?? codigoDeSalaUrl

  const { estado, resultado, motivo, carregar, tentarNovamente, partidaPreparada, partidaEmAndamento, partidaTerminada, falhar, partidaNaoIniciada } =
    usePartidaTela({
      estadoInicial: !temAlvo ? 'falha' : estadoInicial,
      loader,
    })

  // ── Modelo local do tabuleiro (deltas + snapshot) ──
  // Seed com o N real da Sala (#284): sem ele, a mesa nascia sempre com 4
  // peões/iniciais até o snapshot corrigir. Sem sala (link direto), fallback
  // 4 por compatibilidade — o snapshot continua sendo a autoridade.
  // Risco 3: o N da Sala pode chegar pós-mount (WS assíncrono); o valor
  // inicial do useReducer é capturado só no mount (stale). Lazy init +
  // efeito de sync cobrem o caso sem recriar após snapshot.
  const quantidadeDeMembrosDaSala = useQuantidadeDeMembrosDaSalaOptional()
  const [modelo, despachar] = useReducer(
    reduzirModelo,
    undefined,
    () => criarEstadoInicialDoCliente(quantidadeDeMembrosDaSala ?? 4),
  )
  useEffect(() => {
    if (
      quantidadeDeMembrosDaSala !== null &&
      modelo.quantidadeParaLayout !== quantidadeDeMembrosDaSala &&
      Object.keys(modelo.jogadorPorId).length === 0
    ) {
      despachar({ type: 'SYNC_QUANTIDADE', quantidade: quantidadeDeMembrosDaSala })
    }
  }, [quantidadeDeMembrosDaSala, modelo.quantidadeParaLayout, modelo.jogadorPorId])
  const despacharEvento = useCallback(
    (evento: Parameters<typeof reduzirEvento>[1]) => despachar({ type: 'EVENTO', evento }),
    [],
  )
  const aplicarSnapshotNoModelo = useCallback(
    (snapshot: EstadoDaPartidaSnapshot) => despachar({ type: 'APLICAR_SNAPSHOT', snapshot }),
    [],
  )
  // Modelo pré-despacho para derivar a origem do Encaixe (issue #241) e do
  // voo do peão (issue #242): o callback do canal lê a ref (sempre o último
  // modelo commitado) antes de despachar o evento — sem re-subscrever o
  // socket a cada render.
  const modeloRef = useRef(modelo)
  useEffect(() => {
    modeloRef.current = modelo
  }, [modelo])
  // Ref do jogador local para o auto-encadeamento da travessia (ADR-0017):
  // o callback do canal não pode depender de `jogadorId` (re-subscreveria o
  // socket a cada render) — leitura tardia via ref, mesmo padrão acima.
  const jogadorIdRef = useRef(jogadorId)
  useEffect(() => {
    jogadorIdRef.current = jogadorId
  }, [jogadorId])
  // Guarda do auto-encadeamento (ADR-0017, Opção B): o MOVER compulsório
  // pós-travessia é enviado uma única vez por peça posicionada (pecaId) —
  // duas abas do mesmo jogador ou duplo ack não movem duas vezes. Reseta na
  // virada de turno junto dos pendentes em voo.
  const moverTravessiaEncadeadoRef = useRef<string | null>(null)
  // Guarda do auto-encadeamento da ESCOLHA (ADR-0017, defeito 1): a vaga da
  // pendência travada é escolhida sozinha (1 clique: escuro → preview →
  // girar → OK) — uma vez por recebida. Reseta na virada de turno.
  const escolhaTravessiaEncadeadaRef = useRef<string | null>(null)
  // Guarda do auto-encadeamento da CONFIRMAÇÃO (ADR-0017, Opção B): após o
  // auto-MOVER da travessia ack (PEAO_MOVIDO pousando na peça colocada), o
  // FE confirma a posição sozinho — o jogador cai direto no botão Encerrar
  // Turno. Uma vez por turno; reseta na virada.
  const confirmarTravessiaEncadeadoRef = useRef(false)
  // Guarda do auto-encadeamento do ENCERRAMENTO (ADR-0017, Opção B): após a
  // auto-confirmação da travessia ack (POSICAO_CONFIRMADA), o FE encerra o
  // turno sozinho — fechamento de zero cliques (o jogador não precisa nem do
  // botão Encerrar). Uma vez por turno; reseta na virada.
  const encerrarTravessiaEncadeadoRef = useRef(false)
  // Guarda do auto-encadeamento da PERMANÊNCIA (ADR-0017, exceção monstro):
  // Monstro não aceita peão, o mover compulsório é impossível e o turno
  // travado fecha via Permanência — o FE auto-permanece no PECA_POSICIONADA,
  // uma vez por peça posicionada. Reseta na virada de turno.
  const permanecerMonstroTravessiaEncadeadoRef = useRef<string | null>(null)
  // ── Fases de turno no stream de depuração (issue #340) ──
  // A PartidaPage consome o canal da partida: TURNO_INICIADO/TURNO_ENCERRADO
  // e snapshots projetam `jogadorAtivoId`; a fase usa a posição do peão na
  // ordem do roster (`jogadores[].ordem` do snapshot) — fallback ao índice de
  // admissão quando o snapshot ainda não trouxe `ordem`. Entre turnos e ao
  // sair da partida, a fase volta para `sala` (o ObservadorDeFases cuida das
  // fases de login/registro/sala no nível do App).
  useEffect(() => {
    const ativo = modelo.jogadorAtivoId
    if (ativo === null) return
    const ordem = modelo.jogadorPorId[ativo]?.ordem
    if (ordem !== undefined) {
      definirFase(`turno-${ordem}`)
      return
    }
    const indice = Object.keys(modelo.jogadorPorId).indexOf(ativo)
    if (indice >= 0) definirFase(`turno-${indice + 1}`)
  }, [modelo.jogadorAtivoId, modelo.jogadorPorId])
  useEffect(() => () => definirFase('sala'), [])
  // ── Som de recusa + anúncio ao leitor de tela (issue #228) ──
  // Único dono dos disparos: reage aos mesmos eventos do canal que antes
  // geravam flash, somente leitura do modelo. Aprovações/seleções/sorteios/
  // turnos ficam em silêncio (motivo null = "foi"). O id (nonce) remonta a
  // região viva a cada disparo (`key`), então repetições do MESMO motivo
  // re-anunciam — sem ele, texto idêntico + bail-out do setState calariam a
  // segunda recusa para o leitor de tela.
  const [anuncioDeRecusa, setAnuncioDeRecusa] = useState<{
    id: number
    motivo: MotivoDeRecusa
  } | null>(null)
  const proximoIdDeAnuncio = useRef(0)
  // Anúncio sem som (issue #385): o ataque com penalidade mantém o anúncio
  // ao leitor ("Um peão sofreu um ataque.") mas usa os sons dos monstros —
  // nunca o THUD genérico, que segue só nas recusas de jogada.
  const anunciarRecusa = useCallback((motivo: MotivoDeRecusa) => {
    proximoIdDeAnuncio.current += 1
    setAnuncioDeRecusa({ id: proximoIdDeAnuncio.current, motivo })
  }, [])
  const tocarRecusa = useCallback(
    (motivo: MotivoDeRecusa) => {
      tocarSomDeRecusa(motivo)
      anunciarRecusa(motivo)
    },
    [anunciarRecusa],
  )

  // ── Voo do peão com sons (issue #242) ──
  // Único dono dos disparos: reage aos mesmos eventos do canal que atualizam
  // o modelo, somente leitura do modelo anterior. `PEAO_SELECIONADO` toca o
  // clique imediato; `PEAO_MOVIDO` e `PEAO_POSICIONADO` (Primeiro Turno,
  // mesa→Peça Inicial) registram o voo pendente (último vence — o
  // overlay remonta por nonce); o baque é tocado pela cena ao concluir o
  // pouso. `ESTADO_DA_PARTIDA` limpa o voo (snapshot é autoridade).
  const [vooPendente, setVooPendente] = useState<VooDoPeaoPendente | null>(null)
  const proximoNonceVoo = useRef(0)
  const onVooAterrissou = useCallback((nonce: number) => {
    setVooPendente((atual) => limparVooAoAterrissar(atual, nonce))
  }, [])
  // ── Trigger de limpeza para TransicaoLimpeza (issue #239, B1) ──
  // Evento-driven: só LIMPEZA_APLICADA dispara som/animação, snapshots não.
  const [limpezaTrigger, setLimpezaTrigger] = useState<{ pecasRemovidas: readonly string[]; key: number } | null>(null)
  const limpezaKeyRef = useRef(0)

  // ── Trigger de encaixe para TransicaoEncaixe (issue #241, spec #238) ──
  // Evento-driven: só PECA_POSICIONADA dispara voo/som, snapshots não. A
  // origem (mesa/bandeja) deriva do modelo PRÉ-despacho via ref (o callback
  // do canal é estável e não re-subscreve a cada render).
  const [encaixeTrigger, setEncaixeTrigger] = useState<EncaixeTrigger | null>(null)
  const encaixeKeyRef = useRef(0)
  const onFimEncaixe = useCallback((key: number) => {
    setEncaixeTrigger((atual) => (atual?.key === key ? null : atual))
  }, [])

  // ── Aviso de desistência alheia (issue #290) ──
  // Evento-driven: DESISTENCIA_REGISTRADA projeta no modelo + exibe toast
  // visível e anúncio para leitor de tela (desistência, nova ordem e fim).
  // Snapshot reconcilia; auto-dismiss em 8s como AvisosDoLobby.
  const [avisoDesistencia, setAvisoDesistencia] = useState<{
    id: number
    jogadorId: string
    apelido: string
    restantes: number
    ordemTexto: string
  } | null>(null)
  const avisoDesistenciaIdRef = useRef(0)
  const avisoDesistenciaTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (avisoDesistencia === null) return
    if (avisoDesistenciaTimerRef.current !== null) {
      window.clearTimeout(avisoDesistenciaTimerRef.current)
    }
    avisoDesistenciaTimerRef.current = window.setTimeout(() => {
      setAvisoDesistencia(null)
      avisoDesistenciaTimerRef.current = null
    }, 8000)
    return () => {
      if (avisoDesistenciaTimerRef.current !== null) {
        window.clearTimeout(avisoDesistenciaTimerRef.current)
        avisoDesistenciaTimerRef.current = null
      }
    }
  }, [avisoDesistencia])

  // Desistências pré-snapshot (review PR #378, AC3/AC4): sem roster o toast/SR
  // seria falso ("Um jogador desistiu") — enfileira e re-emite pós-snapshot
  // com a ordem/restantes autoritativos. Snapshot reconcilia o modelo; a fila
  // reconcilia o anúncio. Dedupe por jogadorId (replay/reconexão é no-op).
  const desistenciasPreSnapshotRef = useRef<Array<{ jogadorId: string; peaoId: string }>>([])

  // Esquece o reenvio correlacionado (R2): limpa flag + pendência gravada.
  // Declarado antes do `usePartidaWebSocket` (o `onEvento` usa).
  // Correlação silenciosa do reenvio: quando o servidor já processou a
  // desistência, o reenvio é recusado com JOGADOR_NAO_NA_PARTIDA — com a flag,
  // o ERRO só limpa a pendência, sem som/anúncio de recusa (o servidor já sabe).
  // Nonce da tentativa de saída: o "Cancelar" durante o "saindo" invalida a
  // espera em voo — o open tardio não pode navegar após o cancelamento.
  // Só callbacks escrevem aqui (nunca efeitos/render — regra react-hooks/refs).
  const reenvioPendenteRef = useRef(false)
  const saidaNonceRef = useRef(0)
  const esquecerReenvio = useCallback(() => {
    reenvioPendenteRef.current = false
    limparDesistenciaPendente(partidaId)
  }, [partidaId])

  const estadoEmAndamento = temAlvo && estado === 'disponivel'
  const emResultado = estado === 'resultado'
  const emResultadoRef = useRef(emResultado)
  useEffect(() => {
    emResultadoRef.current = emResultado
  }, [emResultado])
  // Não-início (issue #329): estado terminal de tela — como o resultado, a
  // partida fica em somente-leitura e o destino é o Retorno à Sala.
  const emNaoInicio = estado === 'partidaNaoIniciada'
  const emNaoInicioRef = useRef(emNaoInicio)
  useEffect(() => {
    emNaoInicioRef.current = emNaoInicio
  }, [emNaoInicio])
  // Ref de desconexão para o handler de não-início: o hook do canal precisa
  // do handler na construção (antes de `desconectar` existir) e o mantém em
  // ref — a leitura tardia via ref evita a circularidade sem re-subscrever.
  const desconectarRef = useRef<() => void>(() => {})
  const aoPartidaNaoIniciada = useCallback(() => {
    desconectarRef.current()
    partidaNaoIniciada()
  }, [partidaNaoIniciada])

  // ── Batch atômico de lote de turno (B8): eventos do mesmo lote do engine
  // (TURNO_INICIADO do avanço; ATRAVESSOU_O_ESCURO + PECA_SORTEADA +
  // RECEBIMENTO_GERADO da travessia — ADR-0017) chegam como WS messages
  // separadas no mesmo tick. Sem batch, despacharEvento por mensagem causa
  // flash de 1 frame com estado intermediário (faseDoTurno mostraria
  // permanecer indevido). Queue + microtask coalesce em um único render.
  const loteDeTurnoRef = useRef<Parameters<typeof reduzirEvento>[1][]>([])
  const loteAgendadoRef = useRef(false)
  const agendarFlushLote = useCallback(() => {
    if (loteAgendadoRef.current) return
    loteAgendadoRef.current = true
    queueMicrotask(() => {
      const lote = [...loteDeTurnoRef.current]
      loteDeTurnoRef.current = []
      loteAgendadoRef.current = false
      for (const ev of lote) despacharEvento(ev as Parameters<typeof reduzirEvento>[1])
    })
  }, [despacharEvento])

  // ── Fila do ataque com bloqueio da entrada do turno (issue #385 + follow-up
  // da ordem Espectro→Vulto) ──
  // Turno segurado volta pelo mesmo lote atômico (ordem preservada); o hook
  // guarda os callbacks em refs — estáveis sem re-subscrever o socket.
  const liberarTurnoSegurado = useCallback(
    (evento: TurnoIniciadoEvento | TurnoEncerradoEvento) => {
      loteDeTurnoRef.current.push(evento as Parameters<typeof reduzirEvento>[1])
      agendarFlushLote()
    },
    [agendarFlushLote],
  )
  // Fatia do slot na chegada (o ATAQUE_RESOLVIDO não despacha mais na hora:
  // cada slot aplica a sua via este dispatch, com guarda de snapshot-seq no
  // driver; sem vítimas/protegidos na fatia, nada a aplicar).
  const aplicarFatiaDoAtaque = useCallback((fatia: FatiaDoAtaque) => {
    despachar({ type: 'FATIA_DE_ATAQUE', fatia })
  }, [])
  // Iluminação/limpeza segurada libera pelo mesmo caminho do direto abaixo
  // (modelo + trigger TransicaoLimpeza + som) — extraído para reutilizar nos
  // dois pontos sem divergir.
  const liberarLimpezaSegurada = useCallback(
    (evento: CelulasIluminadasWireEvento | LimpezaAplicadaWireEvento) => {
      if (evento.type === 'CELULAS_ILUMINADAS') {
        despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
        return
      }
      if (evento.pecasRemovidas.length > 0) {
        limpezaKeyRef.current += 1
        setLimpezaTrigger({ pecasRemovidas: evento.pecasRemovidas, key: limpezaKeyRef.current })
        tocarSom(CAMINHO_SOM_SOMBRIO_LIMPEZA)
      }
      despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
    },
    [despacharEvento],
  )
  const {
    ataqueExibido,
    pecaIdEmTelegraph,
    enfileirarAtaque,
    segurarTurnoSeEmAtaque,
    segurarLimpezaSeEmAtaque,
    abrirJanelaDeGatilho,
    segurarNaJanelaSeAberta,
    entregarJanelaAoAtaque,
    fecharJanelaDeGatilho,
    notificarSnapshot,
    cancelarAtaque,
  } = useFilaDeAtaque({
    liberarTurnoSegurado,
    aplicarFatiaDoAtaque,
    anunciarRecusa,
    liberarLimpezaSegurada,
  })

  // Estado visual do ataque (issue #385, follow-up): prop única (telegraph +
  // reação por peça + gesto do atacante) derivada do item corrente SÓ no
  // estágio de ataque — tudo null no telegraph e ao drenar (3D e espelho DOM
  // apagam sem marcas; os chips do overlay seguem como legenda).
  const estadoVisualDoAtaque: EstadoVisualDoAtaque = useMemo(
    () => ({
      pecaIdEmTelegraph,
      reacoesDoAtaque:
        ataqueExibido !== null && ataqueExibido.estagio === 'ataque'
          ? new Map(ataqueExibido.item.reacoes.map((reacao) => [reacao.pecaId, reacao] as const))
          : null,
      pecaIdEmDisparo:
        ataqueExibido !== null && ataqueExibido.estagio === 'ataque'
          ? ataqueExibido.item.pecaId
          : null,
    }),
    [ataqueExibido, pecaIdEmTelegraph],
  )

  // Ref do ponto único de injeção do jogadorId (#91): o `onEvento` do canal
  // é declarado antes do `enviarComJogador` (useCallback abaixo), então usa a
  // ref para quebrar o TDZ e manter o callback do socket estável (mesmo
  // padrão de modeloRef/emResultadoRef acima — refs não entram em deps).
  const enviarComJogadorRef = useRef<(comando: ComandoDoCanal) => void>(() => {})

  // ── Pendentes otimistas anti-duplo-place (issue #249) ──
  // Conjunto de alvos em voo (POSICIONAR_PECA/POSICIONAR_PEAO/
  // DESELECIONAR_PEAO): bloqueia o reenvio do mesmo alvo até ack/erro/
  // snapshot. O servidor é a autoridade — o cliente nunca permite duplo
  // envio; o consumo acontece no onEvento abaixo (ack por evento, erro e
  // snapshot limpam). Ref estável, fora do modelo (nunca persiste).
  const pendentesEmVoo = useRef<Set<string>>(new Set())

  // ── Conexão do canal da partida (#156, ST-16 #180) ──
  const { enviar, conectar: reconectarSocket, desconectar, aguardarConexao, removerPendentesPorTipo } = usePartidaWebSocket({
    serverId,
    partidaId,
    onEvento: useCallback(
      (evento) => {
        // Após o não-início, ignora eventos tardios (terminal) — via ref para evitar stale closure
        if (emNaoInicioRef.current) return
        // Consumo dos pendentes otimistas (#249): ack remove o alvo em voo;
        // erro e snapshot reconciliam (autoridade total — limpam).
        if (
          evento.type === 'PECA_POSICIONADA' ||
          evento.type === 'PEAO_POSICIONADO' ||
          evento.type === 'PEAO_DESELECIONADO' ||
          evento.type === 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO' ||
          evento.type === 'ATRAVESSOU_O_ESCURO'
        ) {
          consumirAck(pendentesEmVoo.current, evento)
        }
        if (evento.type === 'ERRO_DO_TABULEIRO') {
          pendentesEmVoo.current.clear()
        }
        if (evento.type === 'TURNO_INICIADO' || evento.type === 'TURNO_ENCERRADO') {
          // Virada de turno invalida gates de posicionamento em voo: se o
          // ack/erro da jogada anterior se perdeu no canal, o alvo não pode
          // ficar bloqueado no turno seguinte (bloqueio silencioso). Os
          // auto-encadeamentos da travessia resetam junto (um MOVER por peça
          // posicionada e uma ESCOLHA por recebida dentro do turno).
          pendentesEmVoo.current.clear()
          moverTravessiaEncadeadoRef.current = null
          escolhaTravessiaEncadeadaRef.current = null
          confirmarTravessiaEncadeadoRef.current = false
          encerrarTravessiaEncadeadoRef.current = false
          permanecerMonstroTravessiaEncadeadoRef.current = null
        }
        if (evento.type === 'PARTIDA_TERMINADA') {
          // Snapshot já aplicado via ESTADO_DA_PARTIDA se houver; garante a
          // tela de resultado.
          // Drena o lote em voo antes da virada (2→1 por desistência fecha o
          // lote atômico): o modelo congela em resultado com a projeção
          // completa, não no meio do lote.
          // Motivo da derrota acompanha (#145-exp); payloads antigos sem o
          // campo chegam undefined → null (tela mantém texto genérico).
          if (loteDeTurnoRef.current.length > 0) {
            const pendente = [...loteDeTurnoRef.current]
            loteDeTurnoRef.current = []
            for (const ev of pendente) despacharEvento(ev as Parameters<typeof reduzirEvento>[1])
          }
          // Fim de jogo: nada a desistir — limpa eventual pendência de reenvio.
          esquecerReenvio()
          // Fim de jogo: a coreografia do ataque é descartada (tela congela).
          cancelarAtaque()
          partidaTerminada(evento.resultado, evento.motivo ?? null)
          return
        }
        if (evento.type === 'ESTADO_DA_PARTIDA') {
          // Snapshot é autoridade total da seleção (#249): reconcilia
          // pendentes em voo contraditórios (limpa o conjunto).
          pendentesEmVoo.current.clear()
          // Snapshot mais novo invalida turnos segurados pela fila do ataque
          // (issue #385: a autoridade já projetou a vez — sem regressão) e
          // cancela a fila + descarta fatias e iluminação/limpeza seguradas
          // (follow-up da ordem: snapshot é autoridade).
          notificarSnapshot()
          cancelarAtaque()
          aplicarSnapshotNoModelo(evento.snapshot)
          if (deveLimparVooNoSnapshot(evento)) setVooPendente(null)
          // Snapshot é a autoridade do roster: se ele já me excluiu E não há
          // pendência gravada, a saída está corroborada — encerra a correlação
          // (recusa posterior é nova, não eco). Com pendência gravada ou ainda
          // no roster, mantém: o servidor ainda pode recusar o reenvio com
          // JOGADOR_NAO_NA_PARTIDA, e esse ERRO deve ser silencioso.
          if (
            !evento.snapshot.jogadores.some((j) => j.jogadorId === jogadorId) &&
            lerDesistenciaPendente(partidaId) === null
          ) {
            esquecerReenvio()
          }
          // Re-emissão pós-snapshot (review PR #378, AC3/AC4): desistências
          // recebidas no early-join (sem roster) foram projetadas no modelo
          // mas sem toast/SR — re-anuncia agora com ordem/restantes
          // autoritativos do snapshot. Desistente já fora do roster = saída
          // confirmada; ainda presente = ignora (snapshot mais novo que o
          // evento não confirma a saída).
          if (desistenciasPreSnapshotRef.current.length > 0) {
            const pendentes = [...desistenciasPreSnapshotRef.current]
            desistenciasPreSnapshotRef.current = []
            const noSnapshot = new Map(
              evento.snapshot.jogadores.map((j) => [j.jogadorId, j] as const),
            )
            const ordenados = [...evento.snapshot.jogadores].sort((a, b) => a.ordem - b.ordem)
            for (const pendente of pendentes) {
              if (noSnapshot.has(pendente.jogadorId)) continue
              const ordemTexto = ordenados.map((j) => j.apelido).join(', ')
              avisoDesistenciaIdRef.current += 1
              setAvisoDesistencia({
                id: avisoDesistenciaIdRef.current,
                jogadorId: pendente.jogadorId,
                apelido: 'Um jogador',
                restantes: ordenados.length,
                ordemTexto,
              })
            }
          }
          if (evento.snapshot.estado === 'terminada' && evento.snapshot.resultado) {
            esquecerReenvio()
            // Fim de jogo via snapshot: descarta a coreografia do ataque.
            cancelarAtaque()
            partidaTerminada(evento.snapshot.resultado, evento.snapshot.motivo ?? null)
            return
          }
          // ADR-0018 (E2a): retomada da auto-cadeia pós-readmissão — o snapshot
          // é a única mensagem da retomada (os deltas não se repetem e os refs
          // nascem limpos). Deriva do estado autoritativo onde a cadeia parou
          // e continua sozinha, com as mesmas guardas anti-duplo do caminho ao
          // vivo (1x por peça; o ack do reenvio segue pela via de evento). Só
          // no turno local em_andamento; a pendência travada (pré-posicionamento)
          // segue pelo auto-ESCOLHA do useEffect.
          if (
            evento.snapshot.estado === 'em_andamento' &&
            !emResultadoRef.current &&
            !emNaoInicioRef.current &&
            jogadorIdRef.current !== null &&
            evento.snapshot.jogadorAtivoId === jogadorIdRef.current &&
            (evento.snapshot.atravessouNoTurno ?? false)
          ) {
            const snap = evento.snapshot
            const travessiaId = snap.pecaDaTravessiaId ?? null
            const peaoDoAtivoId =
              snap.jogadores.find((j) => j.jogadorId === jogadorIdRef.current)?.peaoId ?? null
            if (travessiaId !== null && peaoDoAtivoId !== null) {
              const pecaDaTravessia = snap.tabuleiro.posicionadas.find(
                (p) => p.pecaId === travessiaId,
              )
              const travessiaEhMonstro =
                pecaDaTravessia !== undefined && ehPecaDeMonstro(pecaDaTravessia.tipo)
              if (travessiaEhMonstro) {
                if (permanecerMonstroTravessiaEncadeadoRef.current !== travessiaId) {
                  permanecerMonstroTravessiaEncadeadoRef.current = travessiaId
                  if (snap.tabuleiro.peaoSelecionadoId !== peaoDoAtivoId) {
                    enviarComJogadorRef.current({ type: 'SELECIONAR_PEAO', peaoId: peaoDoAtivoId })
                  }
                  enviarComJogadorRef.current({ type: 'PERMANECER', peaoId: peaoDoAtivoId })
                }
              } else if (!snap.posicaoConfirmada) {
                const peao = snap.tabuleiro.peoes.find((p) => p.peaoId === peaoDoAtivoId)
                if (peao !== undefined && pecaDaTravessia !== undefined && peao.pecaId !== travessiaId) {
                  // Peça posicionada, peão fora dela — continua no auto-MOVER
                  // (o ack PEAO_MOVIDO segue pela via de evento: auto-CONFIRMAR).
                  if (moverTravessiaEncadeadoRef.current !== travessiaId) {
                    moverTravessiaEncadeadoRef.current = travessiaId
                    if (snap.tabuleiro.peaoSelecionadoId !== peaoDoAtivoId) {
                      enviarComJogadorRef.current({ type: 'SELECIONAR_PEAO', peaoId: peaoDoAtivoId })
                    }
                    enviarComJogadorRef.current({
                      type: 'MOVER_PEAO',
                      peaoId: peaoDoAtivoId,
                      celula: pecaDaTravessia.celula,
                    })
                  }
                } else if (peao !== undefined && peao.pecaId === travessiaId) {
                  // Peão sobre a peça, sem confirmar — continua no
                  // auto-CONFIRMAR (o ack POSICAO_CONFIRMADA segue pela via de
                  // evento: auto-ENCERRAR).
                  if (!confirmarTravessiaEncadeadoRef.current) {
                    confirmarTravessiaEncadeadoRef.current = true
                    enviarComJogadorRef.current({
                      type: 'CONFIRMAR_POSICAO_DO_PEAO',
                      peaoId: peaoDoAtivoId,
                    })
                  }
                }
              } else if (!encerrarTravessiaEncadeadoRef.current) {
                // Confirmado, sem encerramento — continua no auto-ENCERRAR.
                confirmarTravessiaEncadeadoRef.current = true
                encerrarTravessiaEncadeadoRef.current = true
                enviarComJogadorRef.current({ type: 'ENCERRAR_TURNO' })
              }
            }
          }
          if (evento.snapshot.estado === 'em_andamento') partidaEmAndamento()
          return
        }
        if (evento.type === 'PARTIDA_INICIADA') {
          // O broadcast carrega o marco autoritativo do início (issue #259):
          // reduzi-lo no modelo sincroniza o cronômetro dos Jogadores que
          // receberam o snapshot ainda em `preparada`.
          despacharEvento(evento)
          partidaEmAndamento()
          return
        }
        // Batch atômico B8 / ADR-0013 / ADR-0017 + lote da desistência (#290, AC2):
        // TURNO_INICIADO, ATRAVESSOU_O_ESCURO (+ PECA_SORTEADA +
        // RECEBIMENTO_GERADO da travessia) e DESISTENCIA_REGISTRADA +
        // CELULAS_ILUMINADAS + LIMPEZA_APLICADA + TURNO_* do lote atômico
        // chegam como WS messages separadas no mesmo tick. Sem batch há flash
        // de 1 frame com estado parcial (recebidas=[] ou peça órfã escura).
        // Queue + microtask coalesce em um único render, na ordem de chegada
        // (= ordem do engine: a travessia/desistência abre o lote). A
        // continuação por LIMPEZA_APLICADA/TURNO_ENCERRADO só vale para lote
        // aberto pela desistência — fora dele, os caminhos dedicados abaixo
        // seguem inalterados.
        // Fila do ataque (issue #385 + follow-up da ordem, com a coreografia
        // ativa, a VIRADA do turno (início e encerramento) é segurada até
        // drenar (lag deliberado por decisão do usuário); a iluminação e a
        // limpeza que chegarem com a fila ativa seguram junto e liberam na
        // chegada do Vulto (ou ao drenar, sem Vulto) — cegueira e sumiço não
        // aparecem antes da vez deles. Com a janela de gatilho aberta (lote
        // real Iluminação → Limpeza → Ataque, review PR #399), o buffer da
        // janela tem precedência — o fechamento compõe com a fila. O resto
        // do lote passa direto.
        // Snapshot mais novo invalida os segurados (a autoridade já projetou
        // a vez — sem regressão).
        // A virada de turno fecha a janela de gatilho (review PR #399,
        // Bloqueante 1): sem ataque no lote, o buffer libera em ordem antes
        // de a vez cair no seguro da fila (ou passar direto, sem fila); com
        // ataque já entregue, a janela está fechada e vale só o seguro.
        if (evento.type === 'TURNO_INICIADO' || evento.type === 'TURNO_ENCERRADO') {
          fecharJanelaDeGatilho()
          if (segurarTurnoSeEmAtaque(evento)) {
            return
          }
        } else if (
          (evento.type === 'CELULAS_ILUMINADAS' || evento.type === 'LIMPEZA_APLICADA') &&
          (segurarNaJanelaSeAberta(evento) || segurarLimpezaSeEmAtaque(evento))
        ) {
          // Janela de gatilho antes do seguro da fila: com a janela aberta,
          // o buffer do gatilho segura sem som/trigger (o fechamento compõe
          // com fila ativa anterior); sem janela, vale o seguro direto da
          // fila ativa (segunda onda pós-Baixa, virada).
          return
        }
        const loteAbertoPorDesistencia =
          loteDeTurnoRef.current.length > 0 &&
          loteDeTurnoRef.current[0]?.type === 'DESISTENCIA_REGISTRADA'
        if (
          evento.type === 'TURNO_INICIADO' ||
          evento.type === 'ATRAVESSOU_O_ESCURO' ||
          evento.type === 'DESISTENCIA_REGISTRADA' ||
          (loteDeTurnoRef.current.length > 0 &&
            (evento.type === 'PECA_SORTEADA' ||
              evento.type === 'RECEBIMENTO_GERADO' ||
              evento.type === 'CELULAS_ILUMINADAS')) ||
          (loteAbertoPorDesistencia &&
            (evento.type === 'LIMPEZA_APLICADA' || evento.type === 'TURNO_ENCERRADO'))
        ) {
          // Pós-término a partida é somente-leitura: o DESISTENCIA caía no
          // gate abaixo; mantido aqui para não ressuscitar projeção terminal.
          if (evento.type === 'DESISTENCIA_REGISTRADA' && emResultadoRef.current) return
          loteDeTurnoRef.current.push(evento as Parameters<typeof reduzirEvento>[1])
          agendarFlushLote()
          // Limpeza no lote (issue #239, B1): o som/animação da
          // TransicaoLimpeza é evento-driven e dispara na chegada (síncrono);
          // só o despacho ao modelo vai no flush.
          if (evento.type === 'LIMPEZA_APLICADA' && evento.pecasRemovidas.length > 0) {
            limpezaKeyRef.current += 1
            setLimpezaTrigger({ pecasRemovidas: evento.pecasRemovidas, key: limpezaKeyRef.current })
            tocarSom(CAMINHO_SOM_SOMBRIO_LIMPEZA)
          }
          // Toast/SR da desistência é síncrono (não espera o flush): usa o
          // modelo pré-lote como antes; o despacho vai no flush em ordem.
          // Desistência (issue #290): projeta remoção do peão/ordem no modelo
          // (CELULAS_ILUMINADAS/LIMPEZA_APLICADA/TURNO_* do mesmo lote
          // completam o tabuleiro) + toast visível e anúncio SR. Snapshot
          // reconcilia.
          if (evento.type === 'DESISTENCIA_REGISTRADA') {
            // Eco da própria desistência (reenvio após "sair mesmo assim"): o
            // modelo projeta via flush; o toast seria "você desistiu" para si
            // mesmo — suprime, sem perder a projeção. Corrobora o reenvio.
            if (evento.jogadorId === jogadorId) {
              reenvioPendenteRef.current = false
              return
            }
            const anterior = modeloRef.current
            const apelido = anterior.jogadorPorId[evento.jogadorId]?.apelido ?? 'Um jogador'
            // F4 (#290): sem snapshot ainda não há roster — projeta a remoção
            // no flush, mas suprime toast/SR imediato (apelido/ordem/restantes
            // seriam falsos). Enfileira para re-emitir pós-snapshot (review PR
            // #378, AC3/AC4) com dados autoritativos.
            if (Object.keys(anterior.jogadorPorId).length === 0) {
              const fila = desistenciasPreSnapshotRef.current
              if (!fila.some((p) => p.jogadorId === evento.jogadorId)) {
                fila.push({ jogadorId: evento.jogadorId, peaoId: evento.peaoId })
              }
              return
            }
            const restantes = Object.keys(anterior.jogadorPorId).filter((id) => id !== evento.jogadorId)
            const ordemTexto = Object.entries(anterior.jogadorPorId)
              .filter(([id]) => id !== evento.jogadorId)
              .map(([id, d]) => ({ id, ordem: d.ordem }))
              .sort((a, b) => a.ordem - b.ordem)
              .map((o) => anterior.jogadorPorId[o.id]?.apelido ?? o.id)
              .join(', ')
            avisoDesistenciaIdRef.current += 1
            setAvisoDesistencia({
              id: avisoDesistenciaIdRef.current,
              jogadorId: evento.jogadorId,
              apelido,
              restantes: restantes.length,
              ordemTexto,
            })
          }
          return
        }
        // Após término, ignora eventos de jogo (partida em somente-leitura) — via ref para evitar stale closure
        if (emResultadoRef.current) return
        // Reenvio já processado (R2): o servidor recusou com
        // JOGADOR_NAO_NA_PARTIDA porque a desistência anterior já valeu — só
        // limpa a pendência, sem som/anúncio de recusa (ele já sabe).
        if (
          evento.type === 'ERRO_DO_TABULEIRO' &&
          evento.codigo === 'JOGADOR_NAO_NA_PARTIDA' &&
          reenvioPendenteRef.current
        ) {
          esquecerReenvio()
          return
        }
        // Monstros e estados (ST-15, issue #174 + follow-up da ordem #385):
        // ATAQUE e RESGATE sem recarregar página. O ATAQUE_RESOLVIDO não
        // despacha mais na hora — evento+contexto vão ao driver, que aplica
        // cada fatia na chegada do próprio slot (Espectro resolve por completo
        // primeiro; Vulto depois) e anuncia ao leitor só com vítimas na
        // fatia. A penalidade usa os sons dos monstros, nunca o THUD
        // genérico; recusas de jogada mantêm o genérico.
        if (evento.type === 'ATAQUE_RESOLVIDO' || evento.type === 'RESGATE_REALIZADO') {
          if (evento.type === 'ATAQUE_RESOLVIDO') {
            // Fecha a janela do gatilho entregando o buffer à fila (review
            // PR #399): a iluminação/limpeza do mesmo lote libera na chegada
            // do Vulto (ou ao drenar, sem Vulto), nunca antes da vez.
            entregarJanelaAoAtaque()
            enfileirarAtaque(evento, modeloRef.current)
          } else {
            despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
          }
          return
        }
        // Conquistas da Confirmação de Posição (issue #385, follow-up):
        // evento-driven por aquisição — gerador (dedupe por id novo), cartão
        // (false→true) e proteção (!antes && resultante) soam uma vez;
        // snapshots nunca soam. O pós-estado deriva da redução pura sobre o
        // modelo pré-despacho (a ref só atualiza no próximo render).
        // ADR-0017 (Opção B, fundido no merge main↔399): quando a
        // auto-confirmação da travessia ack, o FE encerra o turno sozinho —
        // mesmo branch para não despachar 2x nem tornar o check tardio
        // inalcançável (o `return` acima estreita o tipo e calaria o TS2367).
        if (evento.type === 'POSICAO_CONFIRMADA') {
          // Janela anterior ainda aberta (dupla confirmação sem fechar — não
          // esperada no wire): libera em ordem antes de reabrir.
          fecharJanelaDeGatilho()
          const antes = modeloRef.current
          const depois = reduzirEvento(antes, evento as Parameters<typeof reduzirEvento>[1])
          despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
          tocarConquistasDaConfirmacao(antes, depois, evento.jogadorId)
          if (
            confirmarTravessiaEncadeadoRef.current &&
            !encerrarTravessiaEncadeadoRef.current &&
            modeloRef.current.jogadorAtivoId !== null &&
            modeloRef.current.jogadorAtivoId === jogadorIdRef.current
          ) {
            encerrarTravessiaEncadeadoRef.current = true
            enviarComJogadorRef.current({ type: 'ENCERRAR_TURNO' })
          }
          // Abre a janela de gatilho (review PR #399, Bloqueante 1): a
          // iluminação/limpeza do mesmo lote chega a seguir, antes do ataque
          // — segura sem som/trigger até o lote fechar (ataque entrega à
          // fila; virada de turno libera em ordem).
          abrirJanelaDeGatilho()
          return
        }
        // Limpeza (issue #239, B1): evento-driven para TransicaoLimpeza — só
        // LIMPEZA_APLICADA dispara som/animação, snapshots não. Com a janela
        // de gatilho aberta ou a fila do ataque ativa, o evento já foi
        // segurado acima e libera na chegada do Vulto (ou ao fechar/drenar);
        // aqui, só o caminho direto (mesmo corpo de
        // `liberarLimpezaSegurada`, sem divergir).
        if (evento.type === 'LIMPEZA_APLICADA') {
          liberarLimpezaSegurada(evento)
          return
        }
        // Giro (issue #241, mudança de spec verbal): evento-driven para o
        // som próprio — cada PECA_GIRADA toca a carta uma vez (giros
        // distintos em sequência soam múltiplo por design: cada giro é uma
        // ação distinta, sem debounce) e reduz no modelo. Cai antes do
        // despacho genérico; `motivoDeRecusaDoEvento` retornaria null aqui
        // (giro em silêncio na recusa) — o branch só adiciona o som.
        if (evento.type === 'PECA_GIRADA') {
          tocarSomDeGiroDoEncaixe()
          despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
          return
        }
        // Encaixe (issue #241, spec #238 + mudanças de spec verbais):
        // evento-driven para TransicaoEncaixe + som próprio — só
        // PECA_POSICIONADA dispara voo/som, snapshots não. A origem
        // (mesa/bandeja) deriva do modelo pré-despacho; o posicionamento
        // toca SÓ o toque enigmático como som de movimento, no instante em
        // que a peça começa a se mover (chegada do evento — sem atraso de
        // assento). Transição visual de voo inalterada.
        if (evento.type === 'PECA_POSICIONADA') {
          const origem = origemDoEncaixe(modeloRef.current, evento.pecaId)
          // Som imediato no início do movimento (com reduce, o voo vira
          // snap mas o som segue igual — o estado final já renderiza
          // pixel-igual).
          tocarSomDeMovimentoDoEncaixe()
          const reduzir = deveReduzirMovimento()
          if (origem !== null && !reduzir) {
            encaixeKeyRef.current += 1
            setEncaixeTrigger({
              pecaId: evento.pecaId,
              origem: origem.origem,
              indiceNaMesa: origem.indiceNaMesa,
              celula: evento.celula,
              key: encaixeKeyRef.current,
            })
          }

          // Checa no modelo ANTES do despacho se a peça pertencia às pendências
          const eraRecebida = modeloRef.current.recebidasPendentes.some(
            (r) => r.pecaId === evento.pecaId,
          )
          // ADR-0017 (exceção monstro): a pendência resolvida carrega o tipo
          // sorteado — Monstro dispensa o mover compulsório (o peão fica na
          // origem e o turno fecha via Permanência).
          const encaixouMonstro =
            modeloRef.current.recebidasPendentes.some(
              (r) =>
                r.pecaId === evento.pecaId && ehPecaDeMonstro(r.tipoDaPeca),
            )

          despacharEvento(evento)

          // Auto-finaliza a manipulação para não exigir o segundo OK na tela
          if (eraRecebida) {
            enviarComJogadorRef.current(mapearFinalizarManipulacao())
          }
          // ADR-0017 / issue #377 (Opção B): o encaixe que fecha a pendência
          // da Travessia dispara o mover compulsório para a peça colocada —
          // o FE encadeia o MOVER automaticamente (decisão aprovada: FE
          // auto-encadeia + guarda na engine). Só no turno local, sem
          // movimento e sem confirmação; a seleção é restaurada antes (mesmo
          // padrão serial da cadeia SELECIONAR+PERMANECER). Uma vez por peça
          // (guarda contra dupla aba / duplo ack). Exceção monstro: sem
          // auto-MOVER (o Monstro não aceita peão — fechamento por
          // Permanência, auto-permanecer abaixo).
          if (
            eraRecebida &&
            !encaixouMonstro &&
            moverTravessiaEncadeadoRef.current !== evento.pecaId &&
            modeloRef.current.atravessouNoTurno &&
            !modeloRef.current.posicaoConfirmadaNoTurno &&
            modeloRef.current.jogadorAtivoId !== null &&
            modeloRef.current.jogadorAtivoId === jogadorIdRef.current
          ) {
            const peaoDoAtivoId =
              modeloRef.current.peaoPorJogador[modeloRef.current.jogadorAtivoId] ?? null
            if (peaoDoAtivoId !== null) {
              moverTravessiaEncadeadoRef.current = evento.pecaId
              if (modeloRef.current.peaoSelecionadoId !== peaoDoAtivoId) {
                enviarComJogadorRef.current({ type: 'SELECIONAR_PEAO', peaoId: peaoDoAtivoId })
              }
              enviarComJogadorRef.current({ type: 'MOVER_PEAO', peaoId: peaoDoAtivoId, celula: evento.celula })
            }
          }
          // ADR-0017 (exceção monstro): Monstro não aceita peão — o mover
          // compulsório é impossível e o turno travado fecha via Permanência
          // (permanecerNaPartida reabre a via só para a peça da travessia).
          // O FE auto-permanece com a cadeia serial SELECIONAR+PERMANECER, só
          // no turno local, uma vez por peça (guarda contra dupla aba/ack).
          if (
            eraRecebida &&
            encaixouMonstro &&
            permanecerMonstroTravessiaEncadeadoRef.current !== evento.pecaId &&
            modeloRef.current.atravessouNoTurno &&
            !modeloRef.current.posicaoConfirmadaNoTurno &&
            modeloRef.current.jogadorAtivoId !== null &&
            modeloRef.current.jogadorAtivoId === jogadorIdRef.current
          ) {
            const peaoDoAtivoId =
              modeloRef.current.peaoPorJogador[modeloRef.current.jogadorAtivoId] ?? null
            if (peaoDoAtivoId !== null) {
              permanecerMonstroTravessiaEncadeadoRef.current = evento.pecaId
              if (modeloRef.current.peaoSelecionadoId !== peaoDoAtivoId) {
                enviarComJogadorRef.current({ type: 'SELECIONAR_PEAO', peaoId: peaoDoAtivoId })
              }
              enviarComJogadorRef.current({ type: 'PERMANECER', peaoId: peaoDoAtivoId })
            }
          }
          return
        }
        // Promoção de tela só por admissão em_andamento, PARTIDA_INICIADA ou
        // ESTADO_DA_PARTIDA (em_andamento): eventos de turno avulsos não
        // abrem o tabuleiro sem snapshot — descreve a própria PR.
        // Voo do peão (#242): gatilhos só do canal, sobre o modelo ANTES do
        // despacho (origem no estado anterior); o modelo atualiza instantâneo
        // e a cena interpola até o mesmo estado final.
        // Clique ao selecionar (#242, spec #238): cada `PEAO_SELECIONADO` do
        // canal que representa seleção nova (modelo anterior sem esse peão)
        // toca 1 clique — sem debounce por timestamp, que silenciaria
        // re-seleção legítima (revisão PR #254).
        if (deveTocarCliqueDoPeao(evento) && evento.type === 'PEAO_SELECIONADO') {
          if (modeloRef.current.peaoSelecionadoId !== evento.peaoId) {
            tocarCliqueDoPeao()
          }
        }
        const vooBase = vooDoPeaoDoEvento(evento, modeloRef.current)
        if (vooBase !== null) {
          proximoNonceVoo.current += 1
          setVooPendente({ nonce: proximoNonceVoo.current, ...vooBase })
        }
        despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
        // ADR-0017 (Opção B): quando o auto-MOVER da travessia ack
        // (PEAO_MOVIDO pousando na peça colocada), o FE auto-confirma a
        // posição uma vez — o jogador cai direto no botão Encerrar Turno
        // (decisão aprovada: fechamento sem clique intermediário). Guardas:
        // só o PEAO_MOVIDO que encerra o mover auto-encadeado, só no turno
        // local e só sem confirmação prévia (replay/duplo ack em silêncio).
        if (
          evento.type === 'PEAO_MOVIDO' &&
          moverTravessiaEncadeadoRef.current !== null &&
          evento.pecaIdPara === moverTravessiaEncadeadoRef.current &&
          !confirmarTravessiaEncadeadoRef.current &&
          !modeloRef.current.posicaoConfirmadaNoTurno &&
          modeloRef.current.jogadorAtivoId !== null &&
          modeloRef.current.jogadorAtivoId === jogadorIdRef.current
        ) {
          const peaoDoAtivoId =
            modeloRef.current.peaoPorJogador[modeloRef.current.jogadorAtivoId] ?? null
          if (peaoDoAtivoId !== null) {
            confirmarTravessiaEncadeadoRef.current = true
            enviarComJogadorRef.current({
              type: 'CONFIRMAR_POSICAO_DO_PEAO',
              peaoId: peaoDoAtivoId,
            })
          }
        }
        // Som de recusa unificado (issue #228): erros do tabuleiro incluindo
        // FORA_DA_VEZ (#118), pendências e Caixa esgotada (#143/#151); seleção,
        // aprovação, sorteio, confirmação, limpeza e turnos em silêncio (null).
        const motivo = motivoDeRecusaDoEvento(evento)
        if (motivo !== null) tocarRecusa(motivo)
      },
      // `jogadorId` entra em deps (só troca em login/logout — o hook guarda o
      // callback em ref, sem reabrir o socket).
      [aplicarSnapshotNoModelo, despacharEvento, partidaEmAndamento, partidaTerminada, tocarRecusa, agendarFlushLote, enfileirarAtaque, segurarTurnoSeEmAtaque, segurarLimpezaSeEmAtaque, abrirJanelaDeGatilho, segurarNaJanelaSeAberta, entregarJanelaAoAtaque, fecharJanelaDeGatilho, liberarLimpezaSegurada, notificarSnapshot, cancelarAtaque, jogadorId, partidaId, esquecerReenvio],
    ),
    onAdmissao: useCallback(
      (evento) => {
        // Terminal de não-início: admissões tardias não reabrem a tela.
        if (emNaoInicioRef.current) return
        if (evento.estado === 'preparada') partidaPreparada()
        else if (evento.estado === 'terminada') {
          // ADMISSAO_ACEITA não carrega resultado (shared/protocol.ts); o
          // snapshot ESTADO_DA_PARTIDA terminada que chega em seguida é a
          // fonte da verdade — não adivinhar 'derrota' aqui (vitória viraria derrota)
          return
        } else partidaEmAndamento()
      },
      [partidaPreparada, partidaEmAndamento],
    ),
    onFalhaDeConexao: useCallback(() => falhar(), [falhar]),
    // Não-início (issue #329): encerra sem loop de reconexão e devolve o
    // Jogador à Sala reaberta por botão (`voltarASala` no overlay).
    onPartidaNaoIniciada: aoPartidaNaoIniciada,
  })
  useEffect(() => {
    desconectarRef.current = desconectar
  }, [desconectar])

  // Reenvio da desistência pendente (R2): "Sair mesmo assim" ou aba fechada
  // durante o "saindo" gravaram a pendência; ao (re)abrir a partida com o
  // mesmo jogador, reenviamos no primeiro open. Sem socket (upgrade recusado,
  // falha), nada acontece — a pendência segue gravada para a próxima visita.
  useEffect(() => {
    if (partidaId === null || jogadorId === null) return
    if (lerDesistenciaPendente(partidaId) !== jogadorId) return
    if (emResultadoRef.current || emNaoInicioRef.current) {
      limparDesistenciaPendente(partidaId)
      return
    }
    let cancelado = false
    void (async () => {
      reenvioPendenteRef.current = true
      const abriu = await aguardarConexao(15000).catch(() => false)
      if (cancelado || !abriu) {
        reenvioPendenteRef.current = false
        return
      }
      if (emResultadoRef.current || emNaoInicioRef.current) {
        reenvioPendenteRef.current = false
        limparDesistenciaPendente(partidaId)
        return
      }
      const destino = enviar({ type: 'DESISTIR_DA_PARTIDA', jogadorId } as PartidaComandoDoCliente)
      // 'enviado' = entregue ao socket, não processado: mantém a correlação
      // até o servidor corroborar (eco DESISTENCIA, snapshot ou ERRO).
      if (destino === 'enviado') {
        limparDesistenciaPendente(partidaId)
      }
      // 'enfileirado': mantém pendente + correlação até o ERRO/snapshot.
    })()
    return () => {
      cancelado = true
    }
  }, [partidaId, jogadorId, aguardarConexao, enviar])

  // Estado de exibição: exclusivamente do modelo quando disponível ou em resultado (tabuleiro congelado)
  const estadoExibicao = estadoEmAndamento || emResultado ? estadoDeExibicaoDoModelo(modelo) : null
  const estadoInteracao: EstadoDoTabuleiroNoCliente | null =
    estadoEmAndamento ? modelo : null

  const voltarASala = useCallback(() => {
    desconectar()
    if (codigoEfetivo) navigate(`/sala/${codigoEfetivo}`)
    else navigate('/salas/criar')
  }, [desconectar, navigate, codigoEfetivo])

  // ── Injeção única de jogadorId (issue #91) — bloqueada após término e no não-início ──
  // Com gate anti-duplo-place (#249): o mesmo alvo em voo não é reenviado.
  const enviarComJogador = useCallback(
    (comando: ComandoDoCanal) => {
      if (jogadorId === null) return
      if (emResultado) return
      if (emNaoInicio) return
      const chave = chaveDeComandoPendente(comando)
      if (chave !== null) {
        if (pendentesEmVoo.current.has(chave)) return
        pendentesEmVoo.current.add(chave)
      }
      enviar({ ...comando, jogadorId } as PartidaComandoDoCliente)
    },
    [enviar, jogadorId, emResultado, emNaoInicio],
  )
  useEffect(() => {
    enviarComJogadorRef.current = enviarComJogador
  }, [enviarComJogador])

  // ── Desistência (issue #290) ──
  // Confirmar no modal envia DESISTIR_DA_PARTIDA (irreversível, só o próprio
  // Jogador, vale no próprio turno ou fora dele) e navega à principal (/),
  // mantendo o login (AuthProvider persiste a Sessão). Gate local anti-duplo
  // clique: DESISTIR não tem chave pendente (#249 retorna null).
  // Quem desistiu não readmite: o servidor rejeita o upgrade com
  // JOGADOR_NAO_NA_PARTIDA — a volta à URL cai em falha terminal sem retry
  // nem voltar-à-sala (só queda/logout mantém retry). A flag sobrevive a
  // F5/voltar pelo histórico na mesma aba via sessionStorage.
  const desistindoRef = useRef(false)
  // "Saindo" com retry visível (R2): confirmado sem OPEN, aguarda a entrega
  // em vez de navegar best-effort. O modal mostra o progresso + saída forçada.
  const [saindo, setSaindo] = useState(false)
  const [desistiu, setDesistiu] = useState(() => {
    if (typeof window === 'undefined' || partidaId === null) return false
    try {
      return window.sessionStorage.getItem(`partida-desistiu:${partidaId}`) === '1'
    } catch {
      return false
    }
  })

  const finalizarSaida = useCallback(() => {
    setSaindo(false)
    desconectar()
    navigate('/')
  }, [desconectar, navigate])

  // Escape hatch do "saindo": navega SEM a entrega, mas a pendência persiste
  // gravada para reenvio automático na próxima visita (R2).
  const sairMesmoAssim = useCallback(() => {
    if (!saindo) return
    finalizarSaida()
  }, [saindo, finalizarSaida])

  // Cancela a saída durante o "saindo": volta à partida como se nada tivesse
  // sido confirmado — a espera em voo é invalidada, o DESISTIR enfileirado é
  // purgado e a pendência apagada. Residual: se o open drenou na mesma fração
  // de segundo, o servidor já sabe (o broadcast reconcilia; o F2 local já
  // aplicado é idempotente e a sala segue encaminhada no servidor).
  const cancelarSaida = useCallback(() => {
    if (!saindo) return
    saidaNonceRef.current += 1
    setSaindo(false)
    desistindoRef.current = false
    removerPendentesPorTipo('DESISTIR_DA_PARTIDA')
    limparDesistenciaPendente(partidaId)
  }, [saindo, removerPendentesPorTipo, partidaId])

  // Marca a desistência como entregue: bloqueia retry/revisita (sessão) e
  // limpa a pendência de reenvio — o servidor já sabe.
  const marcarDesistenciaEntregue = useCallback(() => {
    setDesistiu(true)
    try {
      if (partidaId !== null) window.sessionStorage.setItem(`partida-desistiu:${partidaId}`, '1')
    } catch {
      // sessionStorage indisponível: a flag em memória já bloqueia o retry.
    }
    limparDesistenciaPendente(partidaId)
  }, [partidaId])

  const desistirEIrParaPrincipal = useCallback(() => {
    if (desistindoRef.current) return
    desistindoRef.current = true
    // B1 (#290): sair da tela de resultado (vitória/derrota normal) não é
    // desistência — o DESISTIR nem é enviado nesse caso; navega direto.
    if (emResultadoRef.current) {
      finalizarSaida()
      return
    }
    if (jogadorId === null) {
      finalizarSaida()
      return
    }
    // F2: zera a sala local na hora (nova aba / lobby fechado não recebem o
    // broadcast); o MEMBRO_SAIU posterior reconcilia sem ressuscitar.
    try {
      marcarSaidaPropria?.()
    } catch {
      // Sem provider do lobby: o broadcast continua sendo a fonte.
    }
    // R2 (issue #290, review PR #378): entrega GARANTIDA do DESISTIR. Sem
    // OPEN, o comando fica enfileirado e a tela entra em "saindo" com retry
    // visível — só navegamos após a entrega (o drain do open envia a fila).
    // A flag `desistiu` (bloqueia retry + terminal na revisita) só é marcada
    // após a entrega: antes dela, o Jogador segue membro e o retry ajuda.
    setSaindo(true)
    gravarDesistenciaPendente(partidaId, jogadorId)
    const nonce = saidaNonceRef.current
    const entregarESair = async () => {
      const destino = enviar({ type: 'DESISTIR_DA_PARTIDA', jogadorId } as PartidaComandoDoCliente)
      if (destino === 'enviado') {
        marcarDesistenciaEntregue()
        finalizarSaida()
        return
      }
      // Sem teto: espera o open (o cleanup no unmount resolve `false` — aí só
      // retorna; a pendência gravada cobre a próxima visita). O nonce invalida
      // a espera se o usuário cancelar no meio do caminho.
      const abriu = await aguardarConexao().catch(() => false)
      if (!abriu || nonce !== saidaNonceRef.current) return
      // O drain do open enviou a fila (inclui o DESISTIR) — entrega garantida.
      marcarDesistenciaEntregue()
      finalizarSaida()
    }
    void entregarESair()
  }, [aguardarConexao, enviar, finalizarSaida, jogadorId, marcarDesistenciaEntregue, marcarSaidaPropria, partidaId])

  // Bloqueio de entrada durante a fila do ataque (review PR #399, Bloqueante
  // 2): com slot em exibição, os botões de turno desabilitam e os cliques do
  // tabuleiro (cena 3D + espelho DOM, ambos via `onComando`/`onComandoPeao`)
  // silenciam até drenar — o clique viraria comando recusado (ida-e-volta
  // inútil + som de recusa confuso), exatamente o que o bloqueio evita.
  const entradaBloqueadaPeloAtaque = ataqueExibido !== null

  const onComando = useCallback(
    (comando: TabuleiroComandoDoCliente | null) => {
      if (comando === null || entradaBloqueadaPeloAtaque) return
      enviarComJogador(comando)
    },
    [enviarComJogador, entradaBloqueadaPeloAtaque],
  )

  // ── Comandos de Peão passam pelo mesmo ponto de injeção ──
  // Com o mesmo gate da fila do ataque: silencia até drenar.
  const onComandoPeao = useCallback(
    (comando: ComandoDePeaoDoDespacho) => {
      if (entradaBloqueadaPeloAtaque) return
      enviarComJogador(comando)
    },
    [enviarComJogador, entradaBloqueadaPeloAtaque],
  )

  // ── Vez (issue #118): derivada uma vez; consome o gate do pull (#199) ──
  const minhaVez = !emResultado && !emNaoInicio && jogadorId !== null && modelo.jogadorAtivoId === jogadorId

  // ── Percepção mínima de Sanidade e estados (ST-15, issue #174) ──
  // Sem controles completos; apenas indicadores no Ambiente de Jogo derivados
  // do snapshot + deltas de ATAQUE/RESGATE, sem recarregar página. Caminha
  // jogadorPorId × peaoPorJogador uma única vez (fonte também dos afetados).
  const sanidadePorPeao: SanidadePorPeao = useMemo(() => {
      const out: Record<string, { sanidade: number; emBaixaIluminacao: boolean; amedrontado: boolean }> = {}
      for (const [jogadorId, dados] of Object.entries(modelo.jogadorPorId)) {
        const peaoId = modelo.peaoPorJogador[jogadorId]
        if (peaoId) {
          out[peaoId] = {
            sanidade: dados.sanidade,
            emBaixaIluminacao: dados.emBaixaIluminacao,
            amedrontado: dados.amedrontado,
          }
        }
      }
      return out
    }, [modelo.jogadorPorId, modelo.peaoPorJogador])

  // ── Peões AFETADOS para o espelho de destinos (F1 #145-exp) ──
  // Predicado espelhado do engine (partida.ts:1484): Baixa Iluminação ∨
  // Amedrontado — único ponto onde a regra vive, sobre a projeção #174.
  // Alimenta a exceção de ocupação de resgate (+1 teto, #171) em
  // destinosConectadosDoPeao/mapearMovimentacao.
  // NB5: memo estável por conteúdo (evita Set novo toda render que quebra memo de estadoInteracaoPeoes)
  const afetadosPorPeaoId: ReadonlySet<string> = useMemo(() => {
    const out = new Set<string>()
    for (const [peaoId, dados] of Object.entries(sanidadePorPeao)) {
      if (dados.emBaixaIluminacao || dados.amedrontado) out.add(peaoId)
    }
    return out
  }, [sanidadePorPeao])
  const afetadosRef = useRef<ReadonlySet<string>>(afetadosPorPeaoId)
  if (
    afetadosPorPeaoId.size !== afetadosRef.current.size ||
    [...afetadosPorPeaoId].some((id) => !afetadosRef.current.has(id))
  ) {
    afetadosRef.current = afetadosPorPeaoId
  }
  const afetadosEstavel = afetadosRef.current

  // ── Peões em Baixa Iluminação (issue #297): avatar do Diretor apagado ──
  // Projeção de exibição do estado do Vulto por jogador (`emBaixaIluminacao`,
  // per-player — não por célula); deriva do mesmo `sanidadePorPeao` acima.
  const emBaixaIluminacaoPorPeaoId: ReadonlySet<PeaoId> = useMemo(
    () => peoesEmBaixaIluminacaoDe(sanidadePorPeao),
    [sanidadePorPeao],
  )
  const emBaixaRef = useRef<ReadonlySet<PeaoId>>(emBaixaIluminacaoPorPeaoId)
  if (
    emBaixaIluminacaoPorPeaoId.size !== emBaixaRef.current.size ||
    [...emBaixaIluminacaoPorPeaoId].some((id) => !emBaixaRef.current.has(id))
  ) {
    emBaixaRef.current = emBaixaIluminacaoPorPeaoId
  }
  const emBaixaEstavel = emBaixaRef.current

  // ── N da partida: o N real vem do roster do snapshot (jogadores reais);
  // o teto do Portão de Saída usa o clamp 2..4. Anúncio fala o N real
  // (solo anuncia 1, nunca um N falso), teto usa o N válido (#284, #281).
  // Solo (N=1) é estado transitório, nunca partida válida (#281 "solo
  // continua impossível"): o seed da Sala clampa para layout, o anúncio
  // pós-snapshot mostra o N cru.
  // Risco 5: quantidade é obrigatória na cadeia — não deriva de peoes.length
  // (modo misto). Antes do snapshot, a autoridade é o seed da Sala (já clampeado).
  // Definido antes do ciclo para alimentar o teto do Portão no espelho.
  const quantidadeRealDeJogadores = useMemo(() => {
    const doSnapshot = Object.keys(modelo.jogadorPorId).length
    if (doSnapshot > 0) return doSnapshot
    if (modelo.quantidadeParaLayout != null) return modelo.quantidadeParaLayout
    return quantidadeDeMembrosDaSala ?? 4
  }, [modelo.jogadorPorId, modelo.quantidadeParaLayout, quantidadeDeMembrosDaSala])
  const quantidadeParaTeto = quantidadeValidaDeJogadores(quantidadeRealDeJogadores)
  // ── Estado de interação dos peões (derivado do modelo) — indisponível em resultado ──
  // Fallback da sequência pendente (#326): se o espelho ficar sem seleção
  // pós-confirmação, vagas/escolha/destaque usam o peão do Jogador Ativo.
  const peaoDoTurnoId =
    modelo.jogadorAtivoId !== null
      ? (modelo.peaoPorJogador[modelo.jogadorAtivoId] ?? null)
      : null
  if (import.meta.env.DEV && modelo.recebidasPendentes.length > 0 && peaoDoTurnoId === null) {
    console.warn('[PartidaPage] Recebidas pendentes sem Peão do Jogador Ativo — fallback da sequência inerte (#326)')
  }
  const estadoInteracaoPeoes: EstadoInteracaoPeoes | null = useMemo(() => {
    if (emResultado) return null
    if (emNaoInicio) return null
    if (!temAlvo || !estadoEmAndamento) return null
    return {
      peoes: modelo.peoes,
      posicionadas: modelo.posicionadas,
      recebidasPendentes: modelo.recebidasPendentes,
      peaoSelecionadoId: modelo.peaoSelecionadoId,
      peaoDoTurnoId,
      pecaSelecionadaId: modelo.pecaSelecionadaId,
      posicaoConfirmadaNoTurno: modelo.posicaoConfirmadaNoTurno,
      // Zona da origem: Peça do início do turno derivada no TURNO_INICIADO
      // (+ baseline do snapshot); o espelho de destinos a respeita.
      pecaDoInicioDoTurnoId: modelo.pecaDoInicioDoTurnoId,
      // Gate do PERMANECER pós-movimento (revisão PR #309): após mover no
      // turno o clique no próprio Peão fica silencioso — encerrar depois de
      // mover é confirmar → encerrar; a Permanência (botão) volta a valer
      // quando o peão retorna à Peça do início do turno (ADR-0017,
      // arrependimento — ida-e-volta livre, ver faseDoTurno).
      movimentouNoTurno: modelo.movimentouNoTurno,
      // Gate do pull na bandeja (revisão #199): só o dono do ciclo puxa; a
      // bandeja continua pública (as pendências vêm do broadcast sem filtro).
      donoDoCiclo: minhaVez,
      // Projeção dos afetados (exceção de resgate #171 no espelho de destinos).
      afetadosPorPeaoId: afetadosEstavel,
      // N do roster para o teto do Portão (#284): nunca peoes.length.
      quantidadeDeJogadores: quantidadeParaTeto,
      // ADR-0017: espelho de vagas escuras em Baixa — filtra vagas iluminadas
      celulasIluminadas: modelo.celulasIluminadas,
      peaoIdsEmBaixa: emBaixaEstavel,
      // ADR-0017 / issue #377 (Opção B): fase da travessia no turno — veda
      // nova travessia no roteador e esconde o botão Permanecer (o mover
      // pós-posicionamento é compulsório e auto-encadeado).
      atravessouNoTurno: modelo.atravessouNoTurno,
      // ADR-0017 (mover compulsório PARA a colocada): o roteador silencia os
      // demais destinos pós-travessia (espelho da guarda da engine).
      pecaDaTravessiaId: modelo.pecaDaTravessiaId,
    }
  }, [temAlvo, estadoEmAndamento, modelo, minhaVez, afetadosEstavel, emResultado, emNaoInicio, quantidadeParaTeto, peaoDoTurnoId, emBaixaEstavel])

  // ADR-0017 (defeito 1): auto-encadeia a ESCOLHA da vaga travada — a
  // recebida da Travessia nasce com a célula-alvo pré-fixada, então a página
  // escolhe a vaga sozinha (1 clique: escuro → preview → girar → OK, sem o
  // segundo clique na célula). Só no turno local e sem confirmação; uma vez
  // por recebida (guarda contra dupla aba / duplo evento). O gate
  // anti-duplo-place (#249, por recebidaId) cobre o intervalo até o ack.
  useEffect(() => {
    if (!estadoEmAndamento || !minhaVez || emResultado || emNaoInicio) return
    if (estadoInteracaoPeoes === null) return
    const travada = bordaDaTravessiaPendente(estadoInteracaoPeoes)
    if (travada === null) return
    if (escolhaTravessiaEncadeadaRef.current === travada.recebidaId) return
    escolhaTravessiaEncadeadaRef.current = travada.recebidaId
    enviarComJogador({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: travada.recebidaId,
      borda: travada.borda,
    })
  }, [estadoEmAndamento, minhaVez, emResultado, emNaoInicio, estadoInteracaoPeoes, enviarComJogador])

  // ── Rejeição local do roteador (AC3): motivo → som de recusa + anúncio ──
  // Com a fila do ataque em exibição, silencia junto (review PR #399,
  // Bloqueante 2): clique na interação não dá feedback até drenar.
  const onRejeicaoPeao = useCallback(
    (motivo: MotivoDeRecusa) => {
      if (entradaBloqueadaPeloAtaque) return
      tocarRecusa(motivo)
    },
    [tocarRecusa, entradaBloqueadaPeloAtaque],
  )

  // ── Turnos (issue #118): rodada, fase e peão do Jogador Ativo (minhaVez
  // derivada acima) — nulo em resultado ──
  const peaoProprioId =
    jogadorId !== null ? (modelo.peaoPorJogador[jogadorId] ?? null) : null
  const peaoAtivoId =
    modelo.jogadorAtivoId !== null
      ? (modelo.peaoPorJogador[modelo.jogadorAtivoId] ?? null)
      : null
  const peaoProprioPosicionado =
    peaoProprioId !== null &&
    modelo.peoes.some((p) => p.peaoId === peaoProprioId && p.celula !== null)
  // ADR-0017 (arrependimento na Baixa): o peão do Jogador Ativo está sobre a
  // Peça do início do turno — caso da ida-e-volta (mover para peça iluminada
  // e voltar). A Permanência volta a valer (a engine só exige o peão na Peça
  // do início; não há guarda de movimentouNoTurno) e as vagas escuras seguem
  // disponíveis (sem atravessouNoTurno).
  const peaoAtivoSobrePecaDeOrigem = ((): boolean => {
    if (modelo.pecaDoInicioDoTurnoId === null || peaoAtivoId === null) return false
    const peaoDoAtivo = modelo.peoes.find((p) => p.peaoId === peaoAtivoId)
    if (!peaoDoAtivo || peaoDoAtivo.celula === null) return false
    const celulaDoPeao = peaoDoAtivo.celula
    const pecaAcomodando = modelo.posicionadas.find(
      (p) =>
        p.celula.linha === celulaDoPeao.linha &&
        p.celula.coluna === celulaDoPeao.coluna,
    )
    return pecaAcomodando?.pecaId === modelo.pecaDoInicioDoTurnoId
  })()
  // ADR-0018 (E2b): piso manual de recuperação — se a retomada automática
  // (E2a) falhar, o peão sobre a peça da travessia sem confirmar mostra o
  // botão Confirmar em vez de tela sem botão (softlock). O predicado casa com
  // a guarda E1 da engine (CONFIRMAR só vale sobre a peça colocada); no caminho
  // feliz o auto dispara primeiro e o botão nem aparece.
  const peaoAtivoSobrePecaDaTravessia = ((): boolean => {
    if (modelo.pecaDaTravessiaId === null || peaoAtivoId === null) return false
    const peaoDoAtivo = modelo.peoes.find((p) => p.peaoId === peaoAtivoId)
    if (!peaoDoAtivo || peaoDoAtivo.celula === null) return false
    const celulaDoPeao = peaoDoAtivo.celula
    const pecaAcomodando = modelo.posicionadas.find(
      (p) =>
        p.celula.linha === celulaDoPeao.linha &&
        p.celula.coluna === celulaDoPeao.coluna,
    )
    return pecaAcomodando?.pecaId === modelo.pecaDaTravessiaId
  })()
  // ADR-0017 (exceção monstro): a peça da travessia é Monstro — o mover
  // compulsório é impossível (Monstro não aceita peão) e o fechamento do
  // turno travado vira Permanência.
  const pecaDaTravessiaEhMonstro = ((): boolean => {
    const id = modelo.pecaDaTravessiaId
    if (id === null) return false
    const peca = modelo.posicionadas.find((p) => p.pecaId === id)
    return peca !== undefined && ehPecaDeMonstro(peca.tipo)
  })()
  type FaseDoTurno = 'permanecer' | 'confirmar' | 'encerrar' | null
  const faseDoTurno: FaseDoTurno = !minhaVez
    ? null
    : modelo.posicaoConfirmadaNoTurno
      ? 'encerrar'
      : modelo.rodada === 1
        ? peaoProprioPosicionado && modelo.recebidasPendentes.length === 0
          ? 'encerrar'
          : null
        : modelo.recebidasPendentes.length > 0
          ? null
          : modelo.atravessouNoTurno
            // ADR-0017 / issue #377 (Opção B): pós-travessia o mover para a
            // peça colocada é compulsório (auto-encadeado) — sem botão
            // Permanecer (o engine rejeitaria), exceto quando a peça
            // atravessada é Monstro (fechamento via Permanência). ADR-0018
            // (E2b): peão sobre a peça colocada sem confirmar mostra o botão
            // Confirmar — piso manual se a retomada automática falhar.
            ? pecaDaTravessiaEhMonstro
              ? 'permanecer'
              : peaoAtivoSobrePecaDaTravessia
                ? 'confirmar'
                : null
            : peaoAtivoSobrePecaDeOrigem
              // ADR-0017 (arrependimento): peão de volta na Peça do início
              // do turno (ida-e-volta livre) — a Permanência volta a valer;
              // as vagas escuras da travessia seguem disponíveis. Cobre
              // também o caso de nunca ter movido (default).
              ? 'permanecer'
              : modelo.movimentouNoTurno
                ? 'confirmar'
                : 'permanecer'

  // ── Rotação: teclas R/E (a peça em manipulação gira pelo overlay 3D) ──
  const pecaAlvoDeGiro = estadoInteracao
    ? (estadoInteracao.pecaEmManipulacaoId ?? estadoInteracao.pecaSelecionadaId)
    : null

  const girar = useCallback(
    (sentido: 'horario' | 'anti_horario') => {
      if (pecaAlvoDeGiro === null) return
      // Peça de 4 caminhos (cruz): giro redundante, sem setas no overlay e
      // sem R/E (review PR #338). O tipo vem da posicionada em manipulação
      // ou da pendência em foco (pré-encaixe).
      const emManipulacao = estadoInteracao?.pecaEmManipulacaoId ?? null
      const tipoAlvo =
        emManipulacao !== null && pecaAlvoDeGiro === emManipulacao
          ? (estadoExibicao?.posicionadas.find((p) => p.pecaId === pecaAlvoDeGiro)?.tipo ?? null)
          : (modelo.recebidasPendentes.find((r) => r.pecaId === pecaAlvoDeGiro)?.tipoDaPeca ?? null)
      if (tipoAlvo !== null && !giroAlteraConexao(tipoAlvo)) return
      enviarComJogador(mapearGiro(pecaAlvoDeGiro, sentido))
    },
    [enviarComJogador, pecaAlvoDeGiro, estadoInteracao, estadoExibicao, modelo.recebidasPendentes],
  )

  // ── Acessibilidade do overlay 3D (review #338 + issue #357): o botão "OK"
  // é exclusivo de ponteiro no canvas — Espaço/Enter com manipulação ativa
  // equivale ao OK (fora de botões/campos, para não duplicar o clique nativo).
  // Com preview provisório pré-encaixe em foco (sem manipulação aberta),
  // Espaço/Enter equivale ao OK do preview (POSICIONAR_PECA na célula-alvo).
  const pecaEmManipulacaoId = estadoInteracao?.pecaEmManipulacaoId ?? null
  const finalizarManipulacao = useCallback(() => {
    if (pecaEmManipulacaoId !== null) {
      enviarComJogador(mapearFinalizarManipulacao())
      return
    }
    if (estadoInteracaoPeoes !== null) {
      const posicionar = mapearFinalizarRecebida(estadoInteracaoPeoes)
      if (posicionar !== null) enviarComJogador(posicionar)
    }
  }, [enviarComJogador, pecaEmManipulacaoId, estadoInteracaoPeoes])

  useEffect(() => {
    if (!estadoEmAndamento) return
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA')) return
      if (e.key === 'r' || e.key === 'R') girar('horario')
      if (e.key === 'e' || e.key === 'E') girar('anti_horario')
      if (e.key === ' ' || e.key === 'Enter') {
        if (alvo && (alvo.tagName === 'BUTTON' || alvo.tagName === 'A')) return
        // OK do preview (issue #357): sem manipulação aberta mas com preview
        // em foco, Espaço/Enter também confirma (POSICIONAR_PECA).
        const previewEmFoco =
          estadoInteracaoPeoes !== null &&
          estadoInteracao?.pecaEmManipulacaoId == null &&
          mapearFinalizarRecebida(estadoInteracaoPeoes) !== null
        if (pecaEmManipulacaoId === null && !previewEmFoco) return
        e.preventDefault()
        finalizarManipulacao()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [estadoEmAndamento, girar, pecaEmManipulacaoId, finalizarManipulacao, estadoInteracao, estadoInteracaoPeoes])

  const tentarNovamenteComConexao = useCallback(() => {
    // Desistente não reconecta (o servidor rejeitaria com
    // JOGADOR_NAO_NA_PARTIDA) — falha terminal sem retry.
    if (desistiu) return
    desconectar()
    if (!temAlvo) {
      falhar()
      return
    }
    if (loader) {
      tentarNovamente()
    } else {
      carregar()
    }
    reconectarSocket()
  }, [carregar, tentarNovamente, desconectar, reconectarSocket, falhar, temAlvo, loader, desistiu])

  // ── Comandos de turno (issue #118) — todos via enviarComJogador ──
  // Permanecer auto-seleciona o peão da vez (bloqueante review #338): no
  // fluxo padrão (rodada 2+, peão desselecionado) o PERMANECER cru seria
  // recusado com PEAO_NAO_SELECIONADO — a cadeia SELECIONAR+PERMANECER segue
  // o padrão serial da #261, na mesma conexão e em ordem.
  const permanecerNoTurno = useCallback(() => {
    if (entradaBloqueadaPeloAtaque) return
    if (peaoProprioId === null || !minhaVez) return
    if (peaoDoTurnoId !== null && peaoProprioId !== peaoDoTurnoId) return
    if (modelo.peaoSelecionadoId !== peaoProprioId) {
      enviarComJogador({ type: 'SELECIONAR_PEAO', peaoId: peaoProprioId })
    }
    enviarComJogador({ type: 'PERMANECER', peaoId: peaoProprioId })
  }, [enviarComJogador, peaoProprioId, minhaVez, peaoDoTurnoId, modelo.peaoSelecionadoId, entradaBloqueadaPeloAtaque])

  const confirmarPosicaoNoTurno = useCallback(() => {
    if (entradaBloqueadaPeloAtaque) return
    if (peaoProprioId === null) return
    enviarComJogador({ type: 'CONFIRMAR_POSICAO_DO_PEAO', peaoId: peaoProprioId })
  }, [enviarComJogador, peaoProprioId, entradaBloqueadaPeloAtaque])

  const encerrarTurno = useCallback(() => {
    if (entradaBloqueadaPeloAtaque) return
    enviarComJogador({ type: 'ENCERRAR_TURNO' })
  }, [enviarComJogador, entradaBloqueadaPeloAtaque])
  const requerModoPaisagem = useRequerModoPaisagem()
  const [bordaPx, setBordaPx] = useState(0)
  const viewportCompacto = useViewportCompacto()

  // Devolução de foco do overlay bloqueante: rastreia o último foco fora
  // do overlay (via focusin — o auto-focus do filho roda antes do efeito
  // do pai, então salvar na transição já seria tarde) e restaura ao
  // liberar (giro para paisagem).
  const focoAnteriorRef = useRef<Element | null>(null)
  useEffect(() => {
    const aoFocar = (e: FocusEvent) => {
      const alvo = e.target as Element | null
      if (!alvo) return
      if (typeof alvo.closest === 'function' && alvo.closest('[data-testid="overlay-modo-paisagem"]')) return
      focoAnteriorRef.current = alvo
    }
    document.addEventListener('focusin', aoFocar)
    return () => document.removeEventListener('focusin', aoFocar)
  }, [])
  useEffect(() => {
    if (!requerModoPaisagem) {
      const anterior = focoAnteriorRef.current
      focoAnteriorRef.current = null
      if (anterior instanceof HTMLElement && document.contains(anterior)) anterior.focus()
    }
  }, [requerModoPaisagem])

  const textoJogadorAtivo = modelo.jogadorAtivoId ? (modelo.jogadorPorId[modelo.jogadorAtivoId]?.apelido ?? 'desconhecido') : 'nenhum'
  const ordemDeEntradaTexto = useMemo(() => {
    const ordem = Object.entries(modelo.jogadorPorId)
      .map(([id, d]) => ({ id, ordem: d.ordem }))
      .sort((a, b) => a.ordem - b.ordem)
    const idx = ordem.findIndex((o) => o.id === modelo.jogadorAtivoId)
    if (idx === -1) return ordem.map((o) => modelo.jogadorPorId[o.id]?.apelido ?? o.id).join(', ')
    return [...ordem.slice(idx), ...ordem.slice(0, idx)].map((o) => modelo.jogadorPorId[o.id]?.apelido ?? o.id).join(' → ')
  }, [modelo.jogadorPorId, modelo.jogadorAtivoId])

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Anúncio de estado da partida para leitor de tela com N real */}
      <div
        data-testid="anuncio-partida"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {estadoEmAndamento
          ? `Partida com ${quantidadeRealDeJogadores} ${quantidadeRealDeJogadores === 1 ? 'jogador' : 'jogadores'}, rodada ${modelo.rodada ?? 1}, Jogador Ativo ${textoJogadorAtivo}, ordem de entrada ${ordemDeEntradaTexto}, Portão de Saída teto ${quantidadeParaTeto}`
          : ''}
      </div>
      <div data-testid="conteudo-jogo" inert={requerModoPaisagem}>
      <AmbienteDeJogo
        bordaPx={bordaPx}
        estadoExibicao={estadoExibicao}
        estadoInteracao={estadoInteracao}
        estadoInteracaoPeoes={estadoInteracaoPeoes}
        quantidadeDeJogadores={quantidadeParaTeto}
        onComando={onComando}
        onComandoPeao={onComandoPeao}
        onRejeicaoPeao={onRejeicaoPeao}
        peaoSelecionadoIdServidor={modelo.peaoSelecionadoId}
        peaoAtivoId={peaoAtivoId}
        sanidadePorPeao={sanidadePorPeao}
        vooPendente={vooPendente}
        onVooAterrissou={onVooAterrissou}
        limpezaTrigger={limpezaTrigger}
        encaixeTrigger={encaixeTrigger}
        onFimEncaixe={onFimEncaixe}
        emBaixaIluminacaoPorPeaoId={emBaixaEstavel}
        estadoVisualDoAtaque={estadoVisualDoAtaque}
      />
      {/*
        Coreografia do ataque (issue #385): overlay evento-driven da fila —
        só revela (cada fatia aplica na chegada do próprio slot); desmonta
        ao drenar, sem marcas. Com movimento reduzido, legenda estática (sons
        e bloqueio seguem).
      */}
      <TransicaoAtaque ataque={ataqueExibido} />
      <PartidaOverlays estado={estado} resultado={resultado} motivo={motivo} onRetry={tentarNovamenteComConexao} onVoltar={voltarASala} semRetry={desistiu} />
      {/*
        Anúncio de recusa restrito a leitores de tela (issue #228, história 8):
        região viva sempre presente; o texto atualiza a cada recusa (som +
        anúncio). Invisível para quem não usa leitor (`sr-only`). O `key` com
        o id do anúncio remonta o nó a cada disparo para que repetições do
        mesmo motivo re-anunciem; `data-anuncio-id` expõe o nonce aos testes.
      */}
      <div
        key={anuncioDeRecusa?.id ?? 'sem-anuncio'}
        data-testid="anuncio-de-recusa"
        data-motivo={anuncioDeRecusa?.motivo ?? undefined}
        data-anuncio-id={anuncioDeRecusa?.id ?? undefined}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {anuncioDeRecusa !== null ? textoDoAnuncioDeRecusa(anuncioDeRecusa.motivo) : ''}
      </div>
      {/*
        Aviso de desistência alheia (issue #290, R4): visível + anúncio SR
        (desistência, nova ordem e fim). Permanece em resultado (derrota-
        quando-sobra-1) até o auto-dismiss de 8s — o fim chega também via
        PARTIDA_TERMINADA com motivo desistencia no overlay de resultado.
      */}
      {avisoDesistencia !== null && (estadoEmAndamento || emResultado) ? (
        <div
          data-testid="aviso-desistencia"
          data-jogador-id={avisoDesistencia.jogadorId}
          role="status"
          className="pointer-events-auto absolute left-1/2 top-20 z-50 -translate-x-1/2 rounded bg-zinc-900 px-4 py-2 text-sm text-zinc-100 shadow-xl"
        >
          {avisoDesistencia.apelido} desistiu. Nova ordem: {avisoDesistencia.ordemTexto || '—'}.
        </div>
      ) : null}
      <div
        key={avisoDesistencia?.id ?? 'sem-desistencia'}
        data-testid="anuncio-desistencia"
        data-jogador-id={avisoDesistencia?.jogadorId ?? undefined}
        data-anuncio-id={avisoDesistencia?.id ?? undefined}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {avisoDesistencia !== null
          ? `${avisoDesistencia.apelido} desistiu da partida. Nova ordem: ${avisoDesistencia.ordemTexto || 'sem jogadores restantes'}. ${avisoDesistencia.restantes <= 1 ? 'Partida terminada em derrota por desistência.' : `${avisoDesistencia.restantes} jogadores restantes.`}`
          : ''}
      </div>
      {/*
        HUD definitivo da Partida (issue #226, spec pai #224): irmão de
        AmbienteDeJogo/PartidaMoldura no ponto mais alto, somente leitura do
        modelo existente (reducao.ts/snapshot.ts). Substitui os indicadores
        provisórios (rodada, caixa, jogador ativo em texto, lista de sanidade
        em texto, chips de geradores/cartão em texto) — sem card de Proteção.
      */}
      {(estadoEmAndamento || emResultado) ? (
        <HudDaPartida
          jogadorPorId={modelo.jogadorPorId}
          jogadorAtivoId={modelo.jogadorAtivoId}
          jogadorLocalId={jogadorId}
          geradoresLigados={modelo.geradoresLigados}
          cartaoDeAcessoObtido={modelo.cartaoDeAcessoObtido}
          emAndamento={estadoEmAndamento}
          emResultado={emResultado}
          iniciadaEm={modelo.iniciadaEm}
          onSair={desistirEIrParaPrincipal}
          saindo={saindo}
          onSairMesmoAssim={sairMesmoAssim}
          onCancelarSaida={cancelarSaida}
          compacto={viewportCompacto}
        />
      ) : null}
      {estadoEmAndamento && faseDoTurno !== null ? (
        // Botões de turno acima do card de Turno do HUD (inf-dir, #226;
        // contidos no compacto #230 com safe-area, sem sobrepor HUD/alvos).
        <div
          data-testid="controles-de-turno"
          data-compacto={viewportCompacto ? 'true' : 'false'}
          style={
            viewportCompacto
              ? {
                  right: 'calc(1.5rem + env(safe-area-inset-right))',
                  bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
                }
              : undefined
          }
          className={`pointer-events-auto absolute z-30 flex gap-2 ${viewportCompacto ? 'bottom-20 right-4' : 'bottom-32 right-6'}`}
        >
          {faseDoTurno === 'permanecer' ? (
            <button
              type="button"
              data-testid="botao-permanecer"
              onClick={permanecerNoTurno}
              disabled={peaoProprioId === null || entradaBloqueadaPeloAtaque}
              className="min-h-[44px] min-w-[44px] rounded bg-zinc-800 px-5 py-3 text-[length:var(--hud-corpo,0.875rem)] leading-5 text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Permanecer
            </button>
          ) : null}
          {faseDoTurno === 'confirmar' ? (
            <button
              type="button"
              data-testid="botao-confirmar-posicao"
              onClick={confirmarPosicaoNoTurno}
              disabled={peaoProprioId === null || entradaBloqueadaPeloAtaque}
              className="min-h-[44px] min-w-[44px] rounded bg-zinc-800 px-5 py-3 text-[length:var(--hud-corpo,0.875rem)] leading-5 text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Confirmar Posição
            </button>
          ) : null}
          {faseDoTurno === 'encerrar' ? (
            <button
              type="button"
              data-testid="botao-encerrar-turno"
              onClick={encerrarTurno}
              disabled={entradaBloqueadaPeloAtaque}
              className="min-h-[44px] min-w-[44px] rounded bg-zinc-800 px-5 py-3 text-[length:var(--hud-corpo,0.875rem)] leading-5 text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Encerrar Turno
            </button>
          ) : null}
        </div>
      ) : null}
      </div>
      {requerModoPaisagem ? <OverlayModoPaisagem /> : null}
      <PartidaMoldura onBordaChange={setBordaPx} />
    </div>
  )
}
