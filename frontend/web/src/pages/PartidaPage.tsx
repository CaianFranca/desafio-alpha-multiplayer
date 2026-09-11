import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AmbienteDeJogo } from '../components/partida/AmbienteDeJogo'
import { HudDaPartida } from '../components/partida/HudDaPartida'
import { PartidaMoldura } from '../components/partida/PartidaMoldura'
import { PartidaOverlays } from '../components/partida/PartidaOverlays'
import { usePartidaTela } from '../components/partida/usePartidaTela'
import type { EstadoDaTela } from '../components/partida/partidaTelaMachine'
import {
  motivoDeRecusaDoEvento,
  textoDoAnuncioDeRecusa,
  tocarSomDeRecusa,
} from '../components/partida/somDeRecusa'
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
  estadoDeExibicaoDoModelo,
  peoesEmBaixaIluminacaoDe,
} from '../game/tabuleiro/reducao'
import type { EstadoDoTabuleiroNoCliente, SanidadePorPeao } from '../game/tabuleiro/reducao'
import { mapearFinalizarManipulacao, mapearGiro } from '../game/tabuleiro/interacao'
import type { EstadoInteracaoPeoes } from '../game/tabuleiro/interacaoPeoes'
import { mapearFinalizarRecebida } from '../game/tabuleiro/interacaoPeoes'
import type { PeaoId } from '../game/tabuleiro/contrato'
import { giroAlteraConexao, quantidadeValidaDeJogadores } from '../game/tabuleiro/contrato'
import { useAuth } from '../state/useAuth'
import { useSalaCodigoOptional, useQuantidadeDeMembrosDaSalaOptional } from '../state/sala-web-socket-context'
import { normalizarCodigoDeSala } from '../utils/codigoDeSala'
import type {
  ConfirmarPosicaoDoPeaoComando,
  DesistirDaPartidaComando,
  EncerrarTurnoComando,
  EstadoDaPartidaSnapshot,
  PartidaComandoDoCliente,
  PeaoComandoDoCliente,
  TabuleiroComandoDoCliente,
} from '@flicker/shared'

/** Comandos do canal: tabuleiro (ST-09), peões (ST-10), turnos (ST-11, #118)
 * e desistência (#290), sem o jogadorId — injetado uma única vez em enviarComJogador. */
type ComandoDoCanal =
  | TabuleiroComandoDoCliente
  | PeaoComandoDoCliente
  | Omit<ConfirmarPosicaoDoPeaoComando, 'jogadorId'>
  | Omit<EncerrarTurnoComando, 'jogadorId'>
  | Omit<DesistirDaPartidaComando, 'jogadorId'>

type AcaoDoModelo =
  | { type: 'EVENTO'; evento: Parameters<typeof reduzirEvento>[1] }
  | { type: 'APLICAR_SNAPSHOT'; snapshot: EstadoDaPartidaSnapshot }
  | { type: 'SYNC_QUANTIDADE'; quantidade: number }

function reduzirModelo(
  estado: EstadoDoTabuleiroNoCliente,
  acao: AcaoDoModelo,
): EstadoDoTabuleiroNoCliente {
  if (acao.type === 'APLICAR_SNAPSHOT') {
    return aplicarSnapshot(estado, acao.snapshot)
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
  const tocarRecusa = useCallback((motivo: MotivoDeRecusa) => {
    tocarSomDeRecusa(motivo)
    proximoIdDeAnuncio.current += 1
    setAnuncioDeRecusa({ id: proximoIdDeAnuncio.current, motivo })
  }, [])

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

  // ── Batch atômico de lote de turno (ADR-0013 / B8): TURNO_INICIADO +
  // PECA_SORTEADA + RECEBIMENTO_GERADO do avancarVez em Baixa chegam como 3
  // WS messages no mesmo tick. Sem batch, despacharEvento por mensagem causa
  // flash de 1 frame com recebidasPendentes=[] (faseDoTurno mostraria
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
  const { enviar, conectar: reconectarSocket, desconectar } = usePartidaWebSocket({
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
          evento.type === 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO'
        ) {
          consumirAck(pendentesEmVoo.current, evento)
        }
        if (evento.type === 'ERRO_DO_TABULEIRO') {
          pendentesEmVoo.current.clear()
        }
        if (evento.type === 'TURNO_INICIADO' || evento.type === 'TURNO_ENCERRADO') {
          // Virada de turno invalida gates de posicionamento em voo: se o
          // ack/erro da jogada anterior se perdeu no canal, o alvo não pode
          // ficar bloqueado no turno seguinte (bloqueio silencioso).
          pendentesEmVoo.current.clear()
        }
        if (evento.type === 'PARTIDA_TERMINADA') {
          // Snapshot já aplicado via ESTADO_DA_PARTIDA se houver; garante a
          // tela de resultado.
          // Motivo da derrota acompanha (#145-exp); payloads antigos sem o
          // campo chegam undefined → null (tela mantém texto genérico).
          partidaTerminada(evento.resultado, evento.motivo ?? null)
          return
        }
        if (evento.type === 'ESTADO_DA_PARTIDA') {
          // Snapshot é autoridade total da seleção (#249): reconcilia
          // pendentes em voo contraditórios (limpa o conjunto).
          pendentesEmVoo.current.clear()
          aplicarSnapshotNoModelo(evento.snapshot)
          if (deveLimparVooNoSnapshot(evento)) setVooPendente(null)
          if (evento.snapshot.estado === 'terminada' && evento.snapshot.resultado) {
            partidaTerminada(evento.snapshot.resultado, evento.snapshot.motivo ?? null)
            return
          }
          if (evento.snapshot.estado === 'em_andamento') partidaEmAndamento()
          return
        }
        if (evento.type === 'PARTIDA_INICIADA') {
          partidaEmAndamento()
          return
        }
        // Batch atômico ADR-0013/B8: TURNO_INICIADO + PECA_SORTEADA + RECEBIMENTO_GERADO
        // do lote de Baixa chegam em 3 WS messages no mesmo tick. Sem batch há
        // flash de 1 frame com recebidas=[].
        if (
          evento.type === 'TURNO_INICIADO' ||
          (loteDeTurnoRef.current.length > 0 &&
            (evento.type === 'PECA_SORTEADA' ||
              evento.type === 'RECEBIMENTO_GERADO' ||
              evento.type === 'CELULAS_ILUMINADAS'))
        ) {
          loteDeTurnoRef.current.push(evento as Parameters<typeof reduzirEvento>[1])
          agendarFlushLote()
          return
        }
        // Após término, ignora eventos de jogo (partida em somente-leitura) — via ref para evitar stale closure
        if (emResultadoRef.current) return
        // Desistência (issue #290): projeta remoção do peão/ordem no modelo
        // (CELULAS_ILUMINADAS/LIMPEZA_APLICADA/TURNO_* do mesmo lote completam
        // o tabuleiro) + toast visível e anúncio SR. Snapshot reconcilia.
        if (evento.type === 'DESISTENCIA_REGISTRADA') {
          const anterior = modeloRef.current
          const apelido = anterior.jogadorPorId[evento.jogadorId]?.apelido ?? 'Um jogador'
          despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
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
          return
        }
        // Monstros e estados (ST-15, issue #174): ATAQUE e RESGATE são
        // projetados no modelo sem recarregar página. Só o ataque COM
        // penalidade (`estadosAplicados.length > 0`, issue #228) toca a
        // recusa — proteção que negou, gatilho sem vítimas e resgate ficam
        // em silêncio.
        if (evento.type === 'ATAQUE_RESOLVIDO' || evento.type === 'RESGATE_REALIZADO') {
          despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
          if (evento.type === 'ATAQUE_RESOLVIDO') {
            const motivo = motivoDeRecusaDoEvento(evento)
            if (motivo !== null) tocarRecusa(motivo)
          }
          return
        }
        // Limpeza (issue #239, B1): evento-driven para TransicaoLimpeza — só
        // LIMPEZA_APLICADA dispara som/animação, snapshots não.
        if (evento.type === 'LIMPEZA_APLICADA') {
          if (evento.pecasRemovidas.length > 0) {
            limpezaKeyRef.current += 1
            setLimpezaTrigger({ pecasRemovidas: evento.pecasRemovidas, key: limpezaKeyRef.current })
            tocarSom(CAMINHO_SOM_SOMBRIO_LIMPEZA)
          }
          despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
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

          despacharEvento(evento)

          // Auto-finaliza a manipulação para não exigir o segundo OK na tela
          if (eraRecebida) {
            enviarComJogadorRef.current(mapearFinalizarManipulacao())
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
        // Som de recusa unificado (issue #228): erros do tabuleiro incluindo
        // FORA_DA_VEZ (#118), pendências e Caixa esgotada (#143/#151); seleção,
        // aprovação, sorteio, confirmação, limpeza e turnos em silêncio (null).
        const motivo = motivoDeRecusaDoEvento(evento)
        if (motivo !== null) tocarRecusa(motivo)
      },
      [aplicarSnapshotNoModelo, despacharEvento, partidaEmAndamento, partidaTerminada, tocarRecusa, agendarFlushLote],
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
  const [desistiu, setDesistiu] = useState(() => {
    if (typeof window === 'undefined' || partidaId === null) return false
    try {
      return window.sessionStorage.getItem(`partida-desistiu:${partidaId}`) === '1'
    } catch {
      return false
    }
  })
  const desistirEIrParaPrincipal = useCallback(() => {
    if (desistindoRef.current) return
    desistindoRef.current = true
    if (jogadorId !== null && !emResultadoRef.current) {
      enviar({ type: 'DESISTIR_DA_PARTIDA', jogadorId } as PartidaComandoDoCliente)
    }
    setDesistiu(true)
    try {
      if (partidaId !== null) window.sessionStorage.setItem(`partida-desistiu:${partidaId}`, '1')
    } catch {
      // sessionStorage indisponível: a flag em memória já bloqueia o retry.
    }
    desconectar()
    navigate('/')
  }, [desconectar, enviar, jogadorId, navigate, partidaId])

  const onComando = useCallback(
    (comando: TabuleiroComandoDoCliente | null) => {
      if (comando === null) return
      enviarComJogador(comando)
    },
    [enviarComJogador],
  )

  // ── Comandos de Peão passam pelo mesmo ponto de injeção ──
  const onComandoPeao = enviarComJogador

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
      // mover é confirmar → encerrar, e Permanecer só vale ANTES de mover.
      movimentouNoTurno: modelo.movimentouNoTurno,
      // Gate do pull na bandeja (revisão #199): só o dono do ciclo puxa; a
      // bandeja continua pública (as pendências vêm do broadcast sem filtro).
      donoDoCiclo: minhaVez,
      // Projeção dos afetados (exceção de resgate #171 no espelho de destinos).
      afetadosPorPeaoId: afetadosEstavel,
      // N do roster para o teto do Portão (#284): nunca peoes.length.
      quantidadeDeJogadores: quantidadeParaTeto,
      // ADR-0013: espelho de vagas escuras em Baixa — filtra vagas iluminadas
      celulasIluminadas: modelo.celulasIluminadas,
      peaoIdsEmBaixa: emBaixaEstavel,
    }
  }, [temAlvo, estadoEmAndamento, modelo, minhaVez, afetadosEstavel, emResultado, emNaoInicio, quantidadeParaTeto, peaoDoTurnoId, emBaixaEstavel])

  // ── Rejeição local do roteador (AC3): motivo → som de recusa + anúncio ──
  const onRejeicaoPeao = tocarRecusa

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
  type FaseDoTurno = 'permanecer' | 'confirmar' | 'encerrar' | null
  const faseDoTurno: FaseDoTurno = !minhaVez
    ? null
    : modelo.posicaoConfirmadaNoTurno
      ? 'encerrar'
      : modelo.rodada === 1
        ? peaoProprioPosicionado && modelo.recebidasPendentes.length === 0
          ? 'encerrar'
          : null
        : modelo.movimentouNoTurno
          ? 'confirmar'
          : modelo.recebidasPendentes.length > 0
            ? null
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
    if (peaoProprioId === null || !minhaVez) return
    if (peaoDoTurnoId !== null && peaoProprioId !== peaoDoTurnoId) return
    if (modelo.peaoSelecionadoId !== peaoProprioId) {
      enviarComJogador({ type: 'SELECIONAR_PEAO', peaoId: peaoProprioId })
    }
    enviarComJogador({ type: 'PERMANECER', peaoId: peaoProprioId })
  }, [enviarComJogador, peaoProprioId, minhaVez, peaoDoTurnoId, modelo.peaoSelecionadoId])

  const confirmarPosicaoNoTurno = useCallback(() => {
    if (peaoProprioId === null) return
    enviarComJogador({ type: 'CONFIRMAR_POSICAO_DO_PEAO', peaoId: peaoProprioId })
  }, [enviarComJogador, peaoProprioId])

  const encerrarTurno = useCallback(() => {
    enviarComJogador({ type: 'ENCERRAR_TURNO' })
  }, [enviarComJogador])
  const requerModoPaisagem = useRequerModoPaisagem()
  const [bordaPx, setBordaPx] = useState(0)

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
      />
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
        Aviso de desistência alheia (issue #290): visível + anúncio SR
        (desistência, nova ordem e fim). O fim (derrota-quando-sobra-1) chega
        via PARTIDA_TERMINADA com motivo desistencia no overlay de resultado.
      */}
      {avisoDesistencia !== null && estadoEmAndamento ? (
        <div
          data-testid="aviso-desistencia"
          data-jogador-id={avisoDesistencia.jogadorId}
          role="status"
          className="pointer-events-auto absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded bg-zinc-900 px-4 py-2 text-sm text-zinc-100 shadow-xl"
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
          partidaId={partidaId}
          onSair={desistirEIrParaPrincipal}
        />
      ) : null}
      {estadoEmAndamento && faseDoTurno !== null ? (
        // Botões de turno acima do card de Turno do HUD (inf-dir, #226).
        <div
          data-testid="controles-de-turno"
          className="pointer-events-auto absolute bottom-32 right-6 z-30 flex gap-2"
        >
          {faseDoTurno === 'permanecer' ? (
            <button
              type="button"
              data-testid="botao-permanecer"
              onClick={permanecerNoTurno}
              disabled={peaoProprioId === null}
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
              disabled={peaoProprioId === null}
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
              className="min-h-[44px] min-w-[44px] rounded bg-zinc-800 px-5 py-3 text-[length:var(--hud-corpo,0.875rem)] leading-5 text-white hover:bg-zinc-700"
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
