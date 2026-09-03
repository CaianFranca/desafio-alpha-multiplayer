import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AmbienteDeJogo } from '../components/partida/AmbienteDeJogo'
import { PartidaMoldura } from '../components/partida/PartidaMoldura'
import { PartidaOverlays } from '../components/partida/PartidaOverlays'
import { usePartidaTela } from '../components/partida/usePartidaTela'
import type { EstadoDaTela } from '../components/partida/partidaTelaMachine'
import { FlashOverlay } from '../components/partida/FlashOverlay'
import { usePartidaWebSocket } from '../hooks/usePartidaWebSocket'
import { aplicarSnapshot } from '../game/tabuleiro/snapshot'
import {
  criarEstadoInicialDoCliente,
  reduzirEvento,
  estadoDeExibicaoDoModelo,
} from '../game/tabuleiro/reducao'
import type { EstadoDoTabuleiroNoCliente } from '../game/tabuleiro/reducao'
import { mapearGiro, FLASH_BRANCO } from '../game/tabuleiro/interacao'
import type { FlashFeedback } from '../game/tabuleiro/interacao'
import { mapearEventoPeaoParaFeedback } from '../game/tabuleiro/interacaoPeoes'
import type { EstadoInteracaoPeoes } from '../game/tabuleiro/interacaoPeoes'
import { HEX_COR_PEAO, ALVO_GERADORES_LIGADOS } from '../game/tabuleiro/contrato'
import { useAuth } from '../state/useAuth'
import type {
  ConfirmarPosicaoDoPeaoComando,
  EncerrarTurnoComando,
  EstadoDaPartidaSnapshot,
  PartidaComandoDoCliente,
  PeaoComandoDoCliente,
  TabuleiroComandoDoCliente,
} from '@flicker/shared'

/** Comandos do canal: tabuleiro (ST-09), peões (ST-10) e turnos (ST-11, #118),
 * sem o jogadorId — injetado uma única vez em enviarComJogador. */
type ComandoDoCanal =
  | TabuleiroComandoDoCliente
  | PeaoComandoDoCliente
  | Omit<ConfirmarPosicaoDoPeaoComando, 'jogadorId'>
  | Omit<EncerrarTurnoComando, 'jogadorId'>

type AcaoDoModelo =
  | { type: 'EVENTO'; evento: Parameters<typeof reduzirEvento>[1] }
  | { type: 'APLICAR_SNAPSHOT'; snapshot: EstadoDaPartidaSnapshot }

function reduzirModelo(
  estado: EstadoDoTabuleiroNoCliente,
  acao: AcaoDoModelo,
): EstadoDoTabuleiroNoCliente {
  if (acao.type === 'APLICAR_SNAPSHOT') {
    return aplicarSnapshot(estado, acao.snapshot)
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

  const { estado, carregar, tentarNovamente, partidaPreparada, partidaEmAndamento, falhar } =
    usePartidaTela({
      estadoInicial: !temAlvo ? 'falha' : estadoInicial,
      loader,
    })

  // ── Modelo local do tabuleiro (deltas + snapshot) ──
  const [modelo, despachar] = useReducer(reduzirModelo, undefined, criarEstadoInicialDoCliente)
  const despacharEvento = useCallback(
    (evento: Parameters<typeof reduzirEvento>[1]) => despachar({ type: 'EVENTO', evento }),
    [],
  )
  const aplicarSnapshotNoModelo = useCallback(
    (snapshot: EstadoDaPartidaSnapshot) => despachar({ type: 'APLICAR_SNAPSHOT', snapshot }),
    [],
  )
  const [flash, setFlash] = useState<FlashFeedback | null>(null)

  // ── Conexão do canal da partida (#156) ──
  const { enviar, conectar: reconectarSocket, desconectar } = usePartidaWebSocket({
    serverId,
    partidaId,
    onEvento: useCallback(
      (evento) => {
        if (evento.type === 'ESTADO_DA_PARTIDA') {
          if (evento.snapshot.estado === 'em_andamento') partidaEmAndamento()
          aplicarSnapshotNoModelo(evento.snapshot)
          return
        }
        if (evento.type === 'PARTIDA_INICIADA') {
          partidaEmAndamento()
          return
        }
        // Promoção de tela só por admissão em_andamento, PARTIDA_INICIADA ou
        // ESTADO_DA_PARTIDA (em_andamento): eventos de turno avulsos não
        // abrem o tabuleiro sem snapshot — descreve a própria PR.
        despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
        // Feedback unificado: cobre eventos de tabuleiro, peão, turno (#118)
        // e limpeza (#151). Branco para aprovação/seleção; vermelho para
        // ERRO_DO_TABULEIRO (motivo específico para pendências); âmbar para
        // FORA_DA_VEZ; TURNO_INICIADO/TURNO_ENCERRADO não geram flash (null).
        if (evento.type === 'CELULAS_ILUMINADAS') {
          return
        }
        if (evento.type === 'LIMPEZA_APLICADA') {
          setFlash({ ...FLASH_BRANCO })
          return
        }
        const feedback = mapearEventoPeaoParaFeedback(
          evento as Parameters<typeof mapearEventoPeaoParaFeedback>[0],
        )
        if (feedback !== null) setFlash({ ...feedback })
      },
      [aplicarSnapshotNoModelo, despacharEvento, partidaEmAndamento],
    ),
    onAdmissao: useCallback(
      (evento) => {
        if (evento.estado === 'preparada') partidaPreparada()
        else partidaEmAndamento()
      },
      [partidaPreparada, partidaEmAndamento],
    ),
    onFalhaDeConexao: useCallback(() => falhar(), [falhar]),
  })

  const estadoEmAndamento = temAlvo && estado === 'disponivel'

  // Estado de exibição: exclusivamente do modelo quando disponível (sem mock)
  const estadoExibicao = estadoEmAndamento ? estadoDeExibicaoDoModelo(modelo) : null
  const estadoInteracao: EstadoDoTabuleiroNoCliente | null =
    estadoEmAndamento ? modelo : null

  // ── Injeção única de jogadorId (issue #91) ──
  const enviarComJogador = useCallback(
    (comando: ComandoDoCanal) => {
      if (jogadorId === null) return
      enviar({ ...comando, jogadorId } as PartidaComandoDoCliente)
    },
    [enviar, jogadorId],
  )

  const onComando = useCallback(
    (comando: TabuleiroComandoDoCliente | null) => {
      if (comando === null) return
      enviarComJogador(comando)
    },
    [enviarComJogador],
  )

  // ── Comandos de Peão passam pelo mesmo ponto de injeção ──
  const onComandoPeao = enviarComJogador

  // ── Estado de interação dos peões (derivado do modelo) ──
  const estadoInteracaoPeoes: EstadoInteracaoPeoes | null = useMemo(() => {
    if (!temAlvo || !estadoEmAndamento) return null
    return {
      peoes: modelo.peoes,
      posicionadas: modelo.posicionadas,
      recebidasPendentes: modelo.recebidasPendentes,
      peaoSelecionadoId: modelo.peaoSelecionadoId,
      pecaSelecionadaId: modelo.pecaSelecionadaId,
      reserva: modelo.reserva,
      posicaoConfirmadaNoTurno: modelo.posicaoConfirmadaNoTurno,
    }
  }, [temAlvo, estadoEmAndamento, modelo])

  // ── Rejeição de peão (local) → flash vermelho ──
  const onRejeicaoPeao = useCallback((feedback: FlashFeedback) => {
    setFlash({ ...feedback })
  }, [])

  // ── Turnos (issue #118): vez, rodada, fase e peão do Jogador Ativo ──
  const minhaVez = jogadorId !== null && modelo.jogadorAtivoId === jogadorId
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
          : 'permanecer'

  // ── Chip Jogador Ativo (apelido/cor do snapshot, #156) ──
  const jogadorAtivoDados =
    modelo.jogadorAtivoId !== null ? modelo.jogadorPorId[modelo.jogadorAtivoId] ?? null : null

  // ── Rotação: botões DOM (horário/anti-horário) + teclas R/E ──
  const pecaAlvoDeGiro = estadoInteracao
    ? (estadoInteracao.pecaEmManipulacaoId ?? estadoInteracao.pecaSelecionadaId)
    : null

  const girar = useCallback(
    (sentido: 'horario' | 'anti_horario') => {
      if (pecaAlvoDeGiro === null) return
      enviarComJogador(mapearGiro(pecaAlvoDeGiro, sentido))
    },
    [enviarComJogador, pecaAlvoDeGiro],
  )

  useEffect(() => {
    if (!estadoEmAndamento) return
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA')) return
      if (e.key === 'r' || e.key === 'R') girar('horario')
      if (e.key === 'e' || e.key === 'E') girar('anti_horario')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [estadoEmAndamento, girar])

  const tentarNovamenteComConexao = useCallback(() => {
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
  }, [carregar, tentarNovamente, desconectar, reconectarSocket, falhar, temAlvo, loader])

  const limparFlash = useCallback(() => setFlash(null), [])

  // ── Comandos de turno (issue #118) — todos via enviarComJogador ──
  const permanecerNoTurno = useCallback(() => {
    if (peaoProprioId === null) return
    enviarComJogador({ type: 'PERMANECER', peaoId: peaoProprioId })
  }, [enviarComJogador, peaoProprioId])

  const confirmarPosicaoNoTurno = useCallback(() => {
    if (peaoProprioId === null) return
    enviarComJogador({ type: 'CONFIRMAR_POSICAO_DO_PEAO', peaoId: peaoProprioId })
  }, [enviarComJogador, peaoProprioId])

  const encerrarTurno = useCallback(() => {
    enviarComJogador({ type: 'ENCERRAR_TURNO' })
  }, [enviarComJogador])
  const [bordaPx, setBordaPx] = useState(0)

  return (
    <div className="relative min-h-[calc(100vh-5rem)] w-full overflow-hidden">
      <AmbienteDeJogo
        bordaPx={bordaPx}
        estadoExibicao={estadoExibicao}
        estadoInteracao={estadoInteracao}
        estadoInteracaoPeoes={estadoInteracaoPeoes}
        onComando={onComando}
        onComandoPeao={onComandoPeao}
        onRejeicaoPeao={onRejeicaoPeao}
        peaoSelecionadoIdServidor={modelo.peaoSelecionadoId}
        peaoAtivoId={peaoAtivoId}
      />
      <PartidaOverlays estado={estado} onRetry={tentarNovamenteComConexao} />
      <FlashOverlay flash={flash} onClear={limparFlash} />
      {estadoEmAndamento && modelo.rodada !== null ? (
        <div
          data-testid="indicador-rodada"
          className="pointer-events-none absolute right-4 top-4 z-30 rounded bg-zinc-900/80 px-3 py-1 text-sm text-zinc-200"
        >
          Rodada {modelo.rodada}
        </div>
      ) : null}
      {estadoEmAndamento && modelo.pecasRestantesNaCaixa !== null ? (
        // Contagem da Caixa no HUD (issue #145): baseline do snapshot +
        // decremento ao vivo em PECA_SORTEADA. Oculta enquanto null (antes do
        // primeiro ESTADO_DA_PARTIDA nunca se mostra contagem inventada).
        <div
          data-testid="contagem-caixa"
          className="pointer-events-none absolute right-4 top-12 z-30 rounded bg-zinc-900/80 px-3 py-1 text-sm text-zinc-200"
        >
          Caixa: {modelo.pecasRestantesNaCaixa}
        </div>
      ) : null}
      {estadoEmAndamento && jogadorAtivoDados ? (
        <div
          data-testid="chip-jogador-ativo"
          data-cor={jogadorAtivoDados.cor}
          className="pointer-events-none absolute left-4 top-4 z-30 flex items-center gap-2 rounded bg-zinc-900/80 px-3 py-1 text-sm text-zinc-100"
          style={{ borderLeft: `4px solid ${HEX_COR_PEAO[jogadorAtivoDados.cor] ?? '#fff'}` }}
        >
          <span>{jogadorAtivoDados.apelido}</span>
        </div>
      ) : null}
      {estadoEmAndamento ? (
        // Chips de Objetivo Global na moldura (issue #145, spec pai ST-12):
        // overlay IRMÃO sobre a moldura — o PartidaMoldura é decoração
        // aria-hidden, os chips são informativos (aria-label) e nunca captam
        // ponteiro. Fonte: modelo local (baseline do snapshot + derivação ao
        // vivo pelos eventos existentes; sem novos eventos de conquista).
        <div className="pointer-events-none absolute left-1/2 top-4 z-30 flex -translate-x-1/2 gap-2">
          <div
            data-testid="chip-geradores-ligados"
            role="status"
            data-geradores={modelo.geradoresLigados.length}
            aria-label={`Geradores ligados: ${modelo.geradoresLigados.length} de ${ALVO_GERADORES_LIGADOS}`}
            className={`rounded bg-zinc-900/80 px-3 py-1 text-sm ${
              modelo.geradoresLigados.length >= ALVO_GERADORES_LIGADOS
                ? 'text-amber-300'
                : 'text-zinc-200'
            }`}
          >
            Geradores {modelo.geradoresLigados.length}/{ALVO_GERADORES_LIGADOS}
          </div>
          <div
            data-testid="chip-cartao-de-acesso"
            role="status"
            data-obtido={modelo.cartaoDeAcessoObtido ? 'true' : 'false'}
            aria-label={
              modelo.cartaoDeAcessoObtido
                ? 'Cartão de Acesso obtido'
                : 'Cartão de Acesso ainda não obtido'
            }
            className={`rounded bg-zinc-900/80 px-3 py-1 text-sm ${
              modelo.cartaoDeAcessoObtido ? 'text-emerald-300' : 'text-zinc-500'
            }`}
          >
            Cartão de Acesso
          </div>
        </div>
      ) : null}
      {estadoEmAndamento && faseDoTurno !== null ? (
        <div
          data-testid="controles-de-turno"
          className="pointer-events-auto absolute bottom-6 right-6 z-30 flex gap-2"
        >
          {faseDoTurno === 'permanecer' ? (
            <button
              type="button"
              data-testid="botao-permanecer"
              onClick={permanecerNoTurno}
              disabled={peaoProprioId === null}
              className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
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
              className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Confirmar Posição
            </button>
          ) : null}
          {faseDoTurno === 'encerrar' ? (
            <button
              type="button"
              data-testid="botao-encerrar-turno"
              onClick={encerrarTurno}
              className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700"
            >
              Encerrar Turno
            </button>
          ) : null}
        </div>
      ) : null}
      {estadoEmAndamento ? (
        <div
          data-testid="controles-de-giro"
          className="pointer-events-auto absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-2"
        >
          <button
            type="button"
            data-testid="girar-anti-horario"
            onClick={() => girar('anti_horario')}
            disabled={pecaAlvoDeGiro === null}
            className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            Girar ◀
          </button>
          <button
            type="button"
            data-testid="girar-horario"
            onClick={() => girar('horario')}
            disabled={pecaAlvoDeGiro === null}
            className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            Girar ▶
          </button>
        </div>
      ) : null}
      <PartidaMoldura onBordaChange={setBordaPx} />
    </div>
  )
}
