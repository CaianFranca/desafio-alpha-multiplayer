import { useState } from 'react'
import type { MensagemDeChatDoLobby } from '../../hooks/useSalaWebSocket'

// Espelha o limite validado pelo backend (lobby-server/handlers) no wire.
const LIMITE_DE_CARACTERES_DO_CHAT = 500

interface Props {
  mensagens: MensagemDeChatDoLobby[]
  aoEnviar: (conteudo: string) => void
}

export function ChatDoLobby({ mensagens, aoEnviar }: Props) {
  const [rascunho, setRascunho] = useState('')

  // Feed só de jogadores, na ordem de chegada (os avisos do lobby ficam no
  // AvisosDoLobby — deduplicação de informação). Sem sort: horários de
  // relógios diferentes (local x servidor) reordenariam o feed.
  const mensagensDoFeed = mensagens.map((mensagem) => ({
    chave: mensagem.id,
    texto: `${mensagem.apelido}: ${mensagem.conteudo}`,
  }))

  const podeEnviar = rascunho.trim().length > 0

  const enviar = () => {
    if (!podeEnviar) return
    aoEnviar(rascunho.trim())
    setRascunho('')
  }

  return (
    <section className="flex flex-col gap-2 max-w-sm w-full" aria-label="Chat do Lobby">
      <div className="flex items-center justify-between">
        <p className="text-sm tracking-[0.18em] uppercase text-white/60">Chat</p>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[#c9a86a]"
          aria-hidden
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>

      <div
        className="flex flex-col gap-1 bg-[#161616] border border-white/10 px-3 py-2 h-44 overflow-y-auto font-mono text-sm uppercase"
        aria-live="polite"
        aria-label="Histórico do chat"
      >
        {mensagensDoFeed.length === 0 ? (
          <p className="text-white/70">Sem mensagens ainda</p>
        ) : (
          mensagensDoFeed.map((item) => (
            <p key={item.chave} className="text-white/60">
              {item.texto}
            </p>
          ))
        )}
      </div>

      <form
        className="flex items-center gap-2 bg-[#1e1e1e] border border-white/15 px-3 py-2 focus-within:border-[#c9a86a]"
        onSubmit={(e) => {
          e.preventDefault()
          enviar()
        }}
      >
        <input
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          placeholder="ENVIAR MENSAGEM..."
          maxLength={LIMITE_DE_CARACTERES_DO_CHAT}
          aria-label="Nova mensagem"
          className="flex-1 min-w-0 bg-transparent text-base text-white placeholder:text-white/60 focus:outline-none"
        />
        <span className="text-sm text-white/60 tabular-nums" aria-hidden>
          {rascunho.length}/{LIMITE_DE_CARACTERES_DO_CHAT}
        </span>
        <button
          type="submit"
          aria-label="Enviar mensagem"
          disabled={!podeEnviar}
          className="text-[#c9a86a] hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#c9a86a]"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M22 2 11 13" />
            <path d="M22 2 15 22l-4-9-9-4z" />
          </svg>
        </button>
      </form>
    </section>
  )
}
