import { useCallback, useEffect, useReducer, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AmbienteDeJogo } from '../components/partida/AmbienteDeJogo'
import { PartidaMoldura } from '../components/partida/PartidaMoldura'
import { PartidaOverlays } from '../components/partida/PartidaOverlays'
import { PartidaDevToolbar } from '../components/partida/PartidaDevToolbar'
import { usePartidaTela } from '../components/partida/usePartidaTela'
import { isEstadoDaTela, type EstadoDaTela } from '../components/partida/partidaTelaMachine'
import { FlashOverlay } from '../components/partida/FlashOverlay'
import { usePartidaWebSocket } from '../hooks/usePartidaWebSocket'
import { criarEstadoInicialDoCliente, reduzirEvento } from '../game/tabuleiro/reducao'
import type { EstadoDoTabuleiroNoCliente } from '../game/tabuleiro/reducao'
import { mapearEventoParaFeedback, mapearGiro } from '../game/tabuleiro/interacao'
import type { FlashFeedback } from '../game/tabuleiro/interacao'
import { criarEstadoExibicaoMock } from '../game/tabuleiro/mockExibicao'
import type { TabuleiroComandoDoCliente } from '@flicker/shared'

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

  // ?partidaEstado é initialOnly e exclusivo de DEV — lido só no mount; após isso, estado interno (toolbar/retry) governa.
  // Prioridade: URL (DEV) > prop > default do hook. Gate DEV evita vazamento para produção (B2).
  const estadoViaUrl =
    import.meta.env.DEV && isEstadoDaTela(param) ? (param as EstadoDaTela) : null
  const estadoInicialEfetivo = estadoViaUrl ?? estadoInicial
  const { estado, carregar, partidaEmAndamento, falhar, forcarEstado } = usePartidaTela({
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
        // Feedback: evento de sucesso → flash branco; rejeição → flash vermelho.
        setFlash(mapearEventoParaFeedback(evento))
      },
      [],
    ),
    onAdmisso: useCallback(() => partidaEmAndamento(), [partidaEmAndamento]),
    onFalhaDeConexao: useCallback(() => falhar(), [falhar]),
  })

  const noAlvo = !temAlvo

  // No alvo, o estado de tela é dirigido pelo canal WS. Fora dele (produção
  // sem `?partidaEstado`), a página já começa em 'falha' — sem recarregar.
  const estadoEmAndamento = temAlvo && estado === 'disponivel'

  // Estado de exibição da cena: DEV sem alvo usa o mock; com alvo o modelo do
  // cliente (deltas). Não-DEV sem alvo não monta cena (estado falha).
  const estadoExibicao =
    temAlvo && estadoEmAndamento
      ? { reserva: modelo.reserva, posicionadas: modelo.posicionadas }
      : noAlvo && estado === 'disponivel'
        ? criarEstadoExibicaoMock()
        : null
  const estadoInteracao: EstadoDoTabuleiroNoCliente | null =
    temAlvo && estadoEmAndamento ? modelo : null

  const onComando = useCallback(
    (comando: TabuleiroComandoDoCliente | null) => {
      if (comando === null) return
      enviar(comando)
    },
    [enviar],
  )

  // ── Rotação: botões DOM (horário/anti-horário) + teclas R/E ──
  const pecaAlvoDeGiro = estadoInteracao
    ? (estadoInteracao.pecaEmManipulacaoId ?? estadoInteracao.pecaSelecionadaId)
    : null

  const girar = useCallback(
    (sentido: 'horario' | 'anti_horario') => {
      if (pecaAlvoDeGiro === null) return
      enviar(mapearGiro(pecaAlvoDeGiro, sentido))
    },
    [enviar, pecaAlvoDeGiro],
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
    carregar()
    desconectar()
    reconectarSocket()
  }, [carregar, desconectar, reconectarSocket])

  const limparFlash = useCallback(() => setFlash(null), [])
  const [bordaPx, setBordaPx] = useState(0)

  // Acoplado ao header de App.tsx (5rem); remover/trocar por h-screen quando Partida deixar de ser filha de App
  return (
    <div className="relative min-h-[calc(100vh-5rem)] w-full overflow-hidden">
      <AmbienteDeJogo
        bordaPx={bordaPx}
        estadoExibicao={estadoExibicao}
        estadoInteracao={estadoInteracao}
        onComando={onComando}
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
