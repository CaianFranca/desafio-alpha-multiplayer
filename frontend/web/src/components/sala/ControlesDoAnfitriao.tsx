import { useState } from 'react'
import type { Sala } from '@flicker/shared'
import type { JogadorBloqueado } from '../../hooks/useSalaWebSocket'
import { adicionarBot, BotIndisponivelError, BotErroError } from '../../api/bots'

interface Props {
  sala: Sala
  ehAnfitriao: boolean
  jogadoresBloqueados: JogadorBloqueado[]
  aoEncerrarSala: () => void
  aoIniciarPartida: () => void
  aoDesbloquearJogador: (jogadorId: string) => void
}

export function ControlesDoAnfitriao({
  sala,
  ehAnfitriao,
  jogadoresBloqueados,
  aoEncerrarSala,
  aoIniciarPartida,
  aoDesbloquearJogador,
}: Props) {
  if (!ehAnfitriao) return null

  const [adicionandoBot, setAdicionandoBot] = useState(false)
  const [erroBot, setErroBot] = useState<string | null>(null)

  // O servidor revalida: 2 a 4 Membros (o Anfitrião incluso), todos conectados e prontos.
  const podeIniciar =
    sala.membros.length >= 2 &&
    sala.membros.length <= 4 &&
    sala.membros.every((m) => m.presenca === 'conectado' && m.prontidao)
  const motivoIniciar = podeIniciar ? undefined : 'Requer 2 a 4 Membros conectados e prontos'

  const temVaga = sala.membros.length < 4
  const podeAdicionarBot = temVaga && !adicionandoBot

  const confirmarEncerramento = () => {
    if (window.confirm('Encerrar a Sala para todos os Membros?')) aoEncerrarSala()
  }

  const handleAdicionarBot = async () => {
    setErroBot(null)
    setAdicionandoBot(true)
    try {
      const bot = await adicionarBot()
      // Aviso simples — o bot aparecerá na lista de membros via evento WS
      console.log(`[sala] bot adicionado: ${bot.apelido}`)
    } catch (err) {
      if (err instanceof BotIndisponivelError) {
        setErroBot('Bots não disponíveis neste ambiente.')
      } else if (err instanceof BotErroError) {
        setErroBot(err.message)
      } else {
        setErroBot('Falha ao adicionar bot.')
      }
    } finally {
      setAdicionandoBot(false)
    }
  }

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
          <button
            type="button"
            onClick={() => void handleAdicionarBot()}
            disabled={!podeAdicionarBot}
            title={
              !temVaga
                ? 'Sala cheia (máximo 4 membros)'
                : adicionandoBot
                  ? 'Adicionando bot...'
                  : 'Adicionar um jogador-bot à sala'
            }
            className="border border-white/30 text-white/60 px-4 py-2 text-xs font-bold tracking-wider uppercase hover:border-white/60 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-white/30 disabled:hover:text-white/60"
          >
            {adicionandoBot ? 'Adicionando…' : '+ Bot'}
          </button>
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
