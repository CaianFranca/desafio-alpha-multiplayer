import { useCallback, useEffect, useReducer, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AmbienteDeJogo } from '../components/partida/AmbienteDeJogo'
import { PartidaMoldura } from '../components/partida/PartidaMoldura'
import { PartidaOverlays } from '../components/partida/PartidaOverlays'
import { PartidaDevToolbar } from '../components/partida/PartidaDevToolbar'
import { usePartidaTela } from '../components/partida/usePartidaTela'
import { isEstadoDaTela, type EstadoDaTela } from '../components/partida/partidaTelaMachine'
import { FlashOverlay } from '../components/partida/FlashOverlay'
import { usePartidaWebSocket } from '../hooks/usePartidaWebSocket'
import { criarEstadoInicialDoCliente, reduzirEvento, estadoDeExibicaoDoModelo } from '../game/tabuleiro/reducao'
import type { EstadoDoTabuleiroNoCliente } from '../game/tabuleiro/reducao'
import { mapearGiro, FLASH_BRANCO } from '../game/tabuleiro/interacao'
import type { FlashFeedback } from '../game/tabuleiro/interacao'
import { criarEstadoExibicaoMock } from '../game/tabuleiro/mockExibicao'
import { mapearEventoPeaoParaFeedback } from '../game/tabuleiro/interacaoPeoes'
import type { EstadoInteracaoPeoes } from '../game/tabuleiro/interacaoPeoes'
import { useAuth } from '../state/useAuth'
import type {
  PartidaComandoDoCliente,
  PeaoComandoDoCliente,
  TabuleiroComandoDoCliente,
} from '@flicker/shared'

interface PartidaPageProps {
  estadoInicial?: EstadoDaTela
  loader?: () => Promise<unknown>
}

export function PartidaPage({ estadoInicial, loader }: PartidaPageProps) {
  const [searchParams] = useSearchParams()
  const param = searchParams.get('partidaEstado')
  const serverId = searchParams.get('serverId')
  const partidaId = searchParams.get('partidaId')
  const temAlvo = Boolean(serverId && partidaId)

  const { authState } = useAuth()
  const jogadorId =
    authState.status === 'authenticated' ? authState.jogador.id : null

  // ?partidaEstado é initialOnly e exclusivo de DEV — lido só no mount; após isso, estado interno (toolbar/retry) governa.
  // Prioridade: URL (DEV) > prop > default do hook. Gate DEV evita vazamento para produção (B2).
  const estadoViaUrl =
    import.meta.env.DEV && isEstadoDaTela(param) ? (param as EstadoDaTela) : null
  const estadoInicialEfetivo = estadoViaUrl ?? estadoInicial
  const { estado, carregar, tentarNovamente, partidaEmAndamento, falhar, forcarEstado } = usePartidaTela({
      estadoInicial:
        // Sem alvo (fora do gate DEV) o estado inicial é falha: não há canal para conectar.
        !temAlvo && estadoViaUrl === null ? 'falha' : estadoInicialEfetivo,
      loader,
    })

  // ── Modelo local do tabuleiro (deltas aplicados por evento do broadcast) ──
  const [modelo, despacharEvento] = useReducer(
    reduzirEvento,
    undefined,
    criarEstadoInicialDoCliente,
  )
  const [flash, setFlash] = useState<FlashFeedback | null>(null)

  // ── Conexão do canal da partida (#85) ──
  const { enviar, conectar: reconectarSocket, desconectar } = usePartidaWebSocket({
    serverId,
    partidaId,
    onEvento: useCallback(
      (evento) => {
        despacharEvento(evento)
        // Feedback unificado: cobre eventos de tabuleiro, peão e limpeza.
        // Branco para aprovação/seleção; vermelho para ERRO_DO_TABULEIRO.
        if (evento.type === 'CELULAS_ILUMINADAS') {
          // Iluminação (#151): estado espelhado do compartilhado — sem flash.
          return
        }
        if (evento.type === 'LIMPEZA_APLICADA') {
          // Limpeza (#151): um único flash de aprovação por evento.
          setFlash({ ...FLASH_BRANCO })
          return
        }
        const feedback = mapearEventoPeaoParaFeedback(evento)
        setFlash({ ...feedback })
      },
      [],
    ),
    onAdmissao: useCallback(() => partidaEmAndamento(), [partidaEmAndamento]),
    onFalhaDeConexao: useCallback(() => falhar(), [falhar]),
  })

  const noAlvo = !temAlvo

  // No alvo, o estado de tela é dirigido pelo canal WS. Fora dele (produção
  // sem `?partidaEstado`), a página já começa em 'falha' — sem recarregar.
  const estadoEmAndamento = temAlvo && estado === 'disponivel'

  // Estado de exibição do Ambiente de Jogo: DEV sem alvo usa o mock; com alvo
  // o modelo do cliente (deltas). Não-DEV sem alvo não monta cena (estado falha).
  const estadoExibicao =
    temAlvo && estadoEmAndamento
      ? estadoDeExibicaoDoModelo(modelo)
      : noAlvo && estado === 'disponivel'
        ? criarEstadoExibicaoMock()
        : null
  const estadoInteracao: EstadoDoTabuleiroNoCliente | null =
    temAlvo && estadoEmAndamento ? modelo : null

  // ── Injeção única de jogadorId (issue #91) ──
  // O canal da Partida exige jogadorId em TODOS os comandos (wire.ts do
  // game-server): comandos sem o campo são rejeitados com DADOS_INVALIDOS.
  // Ponto único de injeção para os comandos de tabuleiro (ST-09) e de peão
  // (ST-10); o espalhamento sobre a união produz a união dos comandos de
  // Partida com jogadorId (PartidaComandoDoCliente).
  const enviarComJogador = useCallback(
    (comando: TabuleiroComandoDoCliente | PeaoComandoDoCliente) => {
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
    }
  }, [temAlvo, estadoEmAndamento, modelo])

  // ── Rejeição de peão (local) → flash vermelho ──
  const onRejeicaoPeao = useCallback((feedback: FlashFeedback) => {
    setFlash({ ...feedback })
  }, [])

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
    // Usa tentarNovamente para honrar loader (loader?.catch(falhar)) quando fornecido;
    // cai para carregar quando sem loader. Mantém sem alvo em falha.
    if (loader) {
      tentarNovamente()
    } else {
      carregar()
    }
    reconectarSocket()
  }, [carregar, tentarNovamente, desconectar, reconectarSocket, falhar, temAlvo, loader])

  const limparFlash = useCallback(() => setFlash(null), [])
  const [bordaPx, setBordaPx] = useState(0)

  // Acoplado ao header de App.tsx (5rem); remover/trocar por h-screen quando Partida deixar de ser filha de App
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
      />
      <PartidaOverlays estado={estado} onRetry={tentarNovamenteComConexao} />
      <FlashOverlay flash={flash} onClear={limparFlash} />
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
      <PartidaDevToolbar onForcar={forcarEstado} />
    </div>
  )
}
