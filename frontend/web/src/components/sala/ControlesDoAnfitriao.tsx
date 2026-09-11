import { useEffect, useRef, useState } from 'react'
import type { Sala } from '@flicker/shared'
import type { JogadorBloqueado } from '../../hooks/useSalaWebSocket'
import { adicionarBot, BotIndisponivelError, BotErroError, consultarStatusDoBot, verificarBotsDisponiveis } from '../../api/bots'

interface Props {
  sala: Sala
  ehAnfitriao: boolean
  jogadoresBloqueados: JogadorBloqueado[]
  aoEncerrarSala: () => void
  aoIniciarPartida: () => void
  aoDesbloquearJogador: (jogadorId: string) => void
}

/** Janela do polling pós-202 até MEMBRO_ENTROU / BOT_FALHOU (mesma ordem da trava do backend). */
const POLLING_BOT_MS = 1000
const TIMEOUT_BOT_MS = 15_000

export function ControlesDoAnfitriao({
  sala,
  ehAnfitriao,
  jogadoresBloqueados,
  aoEncerrarSala,
  aoIniciarPartida,
  aoDesbloquearJogador,
}: Props) {
  const [adicionandoBot, setAdicionandoBot] = useState(false)
  const [erroBot, setErroBot] = useState<string | null>(null)
  /** 202 retornado, WS ainda não confirmou entrada — ocupa vaga e trava o botão (#365 item 2). */
  const [botPendente, setBotPendente] = useState<string | null>(null)
  /** Descoberta de feature: null = verificando (assume disponível até prova contrária). */
  const [botsDisponiveis, setBotsDisponiveis] = useState<boolean | null>(null)
  const pendenteRef = useRef<string | null>(null)
  pendenteRef.current = botPendente

  useEffect(() => {
    let cancelado = false
    void verificarBotsDisponiveis().then((ok) => {
      if (!cancelado) setBotsDisponiveis(ok)
    })
    return () => {
      cancelado = true
    }
  }, [])

  // Libera a trava quando o bot vira Membro (MEMBRO_ENTROU atualiza `sala`)
  // ou quando o status vira `falhou` (polling abaixo). Timeout de segurança
  // reabilita o botão mesmo sem nenhum dos dois (ex.: restart limpou o estado).
  useEffect(() => {
    const pendente = botPendente
    if (pendente === null) return
    if (sala.membros.some((m) => m.jogadorId === pendente)) {
      setBotPendente(null)
      setAdicionandoBot(false)
      return
    }
    const inicio = Date.now()
    const timer = window.setInterval(() => {
      const atual = pendenteRef.current
      if (atual === null) {
        window.clearInterval(timer)
        return
      }
      if (Date.now() - inicio > TIMEOUT_BOT_MS) {
        window.clearInterval(timer)
        setBotPendente(null)
        setAdicionandoBot(false)
        return
      }
      void consultarStatusDoBot(atual)
        .then((estado) => {
          if (estado === null) return
          if (estado.fase === 'falhou') {
            window.clearInterval(timer)
            setErroBot(estado.mensagem ?? 'Falha ao adicionar bot.')
            setBotPendente(null)
            setAdicionandoBot(false)
          } else if (estado.fase === 'ativo' || estado.fase === 'encerrado') {
            window.clearInterval(timer)
            setBotPendente(null)
            setAdicionandoBot(false)
          }
        })
        .catch(() => {
          // Polling best-effort: erro de rede não derruba a trava; o timeout acima resolve.
        })
    }, POLLING_BOT_MS)
    return () => window.clearInterval(timer)
  }, [botPendente, sala.membros])

  // O servidor revalida: 2 a 4 Membros (o Anfitrião incluso), todos conectados e prontos.
  const podeIniciar =
    sala.membros.length >= 2 &&
    sala.membros.length <= 4 &&
    sala.membros.every((m) => m.presenca === 'conectado' && m.prontidao)
  const motivoIniciar = podeIniciar ? undefined : 'Requer 2 a 4 Membros conectados e prontos'

  // Conta o pendente como vaga ocupada: cobre 202 → MEMBRO_ENTROU.
  const temVaga = sala.membros.length + (botPendente !== null ? 1 : 0) < 4
  const botsDesabilitados = botsDisponiveis === false
  const podeAdicionarBot = temVaga && !adicionandoBot && botPendente === null && !botsDesabilitados

  const confirmarEncerramento = () => {
    if (window.confirm('Encerrar a Sala para todos os Membros?')) aoEncerrarSala()
  }

  const handleAdicionarBot = async () => {
    setErroBot(null)
    setAdicionandoBot(true)
    try {
      const bot = await adicionarBot()
      // Trava até MEMBRO_ENTROU (via `sala`) ou BOT_FALHOU (via polling/status).
      setBotPendente(bot.jogadorId)
    } catch (err) {
      if (err instanceof BotIndisponivelError) {
        setBotsDisponiveis(false)
        setErroBot('Bots não disponíveis neste ambiente.')
      } else if (err instanceof BotErroError) {
        setErroBot(err.message)
      } else {
        setErroBot('Falha ao adicionar bot.')
      }
      setAdicionandoBot(false)
    }
  }

  if (!ehAnfitriao) return null

  return (
    <div className="flex flex-col gap-4 max-w-sm w-full">
      <div className="flex flex-col gap-3">
        <p className="text-[10px] tracking-[0.18em] uppercase text-white/60">Controles do Anfitrião</p>
        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={confirmarEncerramento}
            className="border border-white/20 px-4 py-2 text-xs tracking-wider uppercase text-white/70 hover:text-white hover:border-white/40 transition-colors"
          >
            Encerrar Sala
          </button>
          <button
            type="button"
            onClick={aoIniciarPartida}
            disabled={!podeIniciar}
            title={motivoIniciar}
            className="border border-[#c9a86a] text-[#c9a86a] px-4 py-2 text-xs font-bold tracking-wider uppercase hover:bg-[#c9a86a] hover:text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#c9a86a]"
          >
            Iniciar Partida
          </button>
          {!botsDesabilitados && (
            <button
              type="button"
              onClick={() => void handleAdicionarBot()}
              disabled={!podeAdicionarBot}
              title={
                !temVaga
                  ? 'Sala cheia (máximo 4 membros)'
                  : adicionandoBot || botPendente !== null
                    ? 'Adicionando bot...'
                    : 'Adicionar um bot à sala'
              }
              className="border border-white/30 text-white/60 px-4 py-2 text-xs font-bold tracking-wider uppercase hover:border-white/60 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-white/30 disabled:hover:text-white/60"
            >
              {adicionandoBot || botPendente !== null ? 'Adicionando…' : '+ Bot'}
            </button>
          )}
        </div>
        {erroBot && (
          <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-1">
            {erroBot}
          </p>
        )}
      </div>

      {jogadoresBloqueados.length > 0 && (
        <div className="flex flex-col gap-2" aria-label="Jogadores bloqueados">
          <p className="text-[10px] tracking-[0.18em] uppercase text-white/60">Jogadores bloqueados</p>
          <ul className="flex flex-col gap-2 max-h-36 overflow-y-auto pr-1">
            {jogadoresBloqueados.map((jogador) => (
              <li
                key={jogador.jogadorId}
                className="flex items-center justify-between gap-3 border border-white/10 bg-[#1e1e1e] px-3 py-2"
              >
                <span className="text-sm text-white/70 truncate">{jogador.apelido}</span>
                <button
                  type="button"
                  onClick={() => aoDesbloquearJogador(jogador.jogadorId)}
                  className="border border-[#c9a86a]/60 text-[#c9a86a] px-3 py-1 text-[10px] font-bold tracking-wider uppercase hover:bg-[#c9a86a] hover:text-black transition-colors"
                >
                  Desbloquear
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
