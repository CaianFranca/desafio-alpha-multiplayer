/**
 * Painel de chat da Partida (issue #389).
 *
 * Botão discreto no HUD com badge de não lidas (`role="status"`) e painel
 * expansível ancorado à direita sob o sistema do HUD: histórico rolável com
 * hora HH:MM e apelido na cor do peão por mensagem (humanas e de bot
 * renderizadas igual — a cor vem do roster `jogadorPorId`, a identidade do
 * bot também vive lá) e input com contador do limite.
 *
 * Block da cena: com o painel aberto um backdrop cobre a tela engolindo
 * cliques (Escape, clique no backdrop ou no botão fecham e devolvem o
 * controle) — o jogo NÃO pausa, só o input para. O gate de teclado para a
 * cena (R/E/Espaço/Enter) vive na PartidaPage, que lê o estado aberto.
 * Notícias de novas mensagens (e recusas) saem por região aria-live; o
 * badge zera ao abrir.
 *
 * Em viewport compacto de paisagem (#230) o painel vira drawer ancorado na
 * faixa entre o sistema sup-dir e o Turno inf-dir — mesma moldura do modal
 * de saída. O backdrop bloqueia cena + HUD (decisão: painel aberto é modal),
 * o jogo segue rolando por baixo.
 */

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { HEX_COR_PEAO } from '../../game/tabuleiro/contrato'
import type { PercepcaoDeJogador } from '../../game/tabuleiro/reducao'
import { useViewportCompacto } from '../../hooks/useViewportCompacto'
import {
  LIMITE_DE_CARACTERES_DO_CHAT,
  formatarHora,
} from '../../hooks/useChatDaPartida'
import type { MensagemDoChatDaPartida } from '../../hooks/useChatDaPartida'

interface ChatDaPartidaProps {
  /** Feed na ordem de chegada do broadcast (sem sort, como o lobby). */
  mensagens: readonly MensagemDoChatDaPartida[]
  /** Não lidas acumuladas com o painel fechado (zera ao abrir). */
  naoLidas: number
  aberto: boolean
  /** Instante (epoch ms) até o qual o input fica congelado (recusa do servidor). */
  cooldownAte: number | null
  /** Feedback enxuto de recusa (vazia/longa/rate-limit/sem conexão). */
  recusa: string | null
  /** Roster do snapshot (jogadorId → apelido/cor): fonte da cor do peão. */
  jogadorPorId: Readonly<Record<string, PercepcaoDeJogador>>
  /** Sessão do Jogador local — mensagens próprias ganham destaque âmbar. */
  jogadorLocalId: string | null
  aoAbrir: () => void
  aoFechar: () => void
  /** Envia; devolve true quando aceito localmente (o painel limpa o rascunho). */
  aoEnviar: (conteudo: string) => boolean
  /** Força/deriva o modo compacto paisagem-celular (issue #230). */
  compacto?: boolean | null
}

/** Iniciais do Apelido para o avatar do chat (repetição mínima do HUD). */
function iniciaisDoApelido(apelido: string): string {
  const letras = apelido.replace(/[^\p{L}\p{N}]/gu, '')
  return (letras.slice(0, 2) || '??').toUpperCase()
}

export function ChatDaPartida({
  mensagens,
  naoLidas,
  aberto,
  cooldownAte,
  recusa,
  jogadorPorId,
  jogadorLocalId,
  aoAbrir,
  aoFechar,
  aoEnviar,
  compacto = null,
}: ChatDaPartidaProps) {
  const [rascunho, setRascunho] = useState('')
  const botaoRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const feedRef = useRef<HTMLDivElement | null>(null)
  const emModoCompacto = useViewportCompacto(compacto)
  // Janela do cooldown (re-renderiza ao expirar via timer do hook).
  const emCooldown = cooldownAte !== null && cooldownAte > Date.now()
  const ultimaMensagem = mensagens.length > 0 ? mensagens[mensagens.length - 1]! : null
  const podeEnviar = rascunho.trim().length > 0 && !emCooldown

  // Abertura move o foco ao input (autoFocus é frágil em React/jsdom);
  // Escape fecha o painel (block da cena) e devolve o foco ao botão para o
  // teclado da cena voltar a operar (o gate da página lê o estado aberto).
  useEffect(() => {
    if (!aberto) return
    inputRef.current?.focus()
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      aoFechar()
      botaoRef.current?.focus()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto, aoFechar])

  // Auto-scroll: nova mensagem com o painel aberto desce o feed até o fim.
  // jsdom não implementa scrollTo — guarda defensiva com fallback a scrollTop.
  useEffect(() => {
    if (!aberto) return
    const feed = feedRef.current
    if (!feed) return
    try {
      if (typeof feed.scrollTo === 'function') feed.scrollTo({ top: feed.scrollHeight })
      else feed.scrollTop = feed.scrollHeight
    } catch {
      // Feed rolável é progressivo: sem scroll o chat segue legível.
    }
  }, [aberto, mensagens.length])

  const aoSubmeter = (e: FormEvent) => {
    e.preventDefault()
    if (aoEnviar(rascunho)) setRascunho('')
  }

  return (
    <>
      <div
        data-testid="chat-da-partida"
        data-compacto={emModoCompacto ? 'true' : 'false'}
        className="pointer-events-auto absolute z-50"
        style={
          emModoCompacto && aberto
            ? {
                right: 0,
                top: 'calc(4.5rem + env(safe-area-inset-top))',
                bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
                width: 'min(21.25rem, calc(100vw - 1.5rem))',
                display: 'flex',
                flexDirection: 'column',
              }
            : {
                right: 'calc(1.5rem + env(safe-area-inset-right))',
                top: 'calc(4.5rem + env(safe-area-inset-top))',
                width: '21.25rem',
              }
        }
      >
        <button
          ref={botaoRef}
          type="button"
          data-testid="chat-botao"
          onClick={() => {
            if (aberto) {
              aoFechar()
              // Backdrop e botão não devolviam o foco — centraliza aqui para
              // o teclado da cena voltar sem depender do caminho de saída.
              botaoRef.current?.focus()
            } else {
              aoAbrir()
            }
          }}
          aria-expanded={aberto}
          aria-controls={aberto ? 'chat-painel' : undefined}
          className="flex h-9 w-full min-h-[44px] items-center justify-between gap-2 border border-[#504533] bg-[#1C140E] px-3 font-chat-rotulo text-[11px] uppercase tracking-[0.18em] text-zinc-100 shadow-[0_4px_16px_rgba(0,0,0,0.5)] focus-visible:outline-2 focus-visible:outline-amber-500"
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
            className="text-[#FDB813]"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>Chat</span>
          {!aberto && naoLidas > 0 ? (
            <span
              data-testid="chat-badge"
              role="status"
              aria-label={`${naoLidas} ${naoLidas === 1 ? 'mensagem não lida' : 'mensagens não lidas'}`}
              className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-zinc-950"
            >
              {naoLidas}
            </span>
          ) : (
            <span className="ml-auto w-5" aria-hidden="true" />
          )}
        </button>
        {aberto ? (
          <div
            id="chat-painel"
            data-testid="chat-painel"
            className={`flex w-full flex-col border border-t-0 border-[#504533] bg-[linear-gradient(180deg,rgba(28,25,23,0.95),rgba(20,18,16,0.97))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_32px_rgba(0,0,0,0.6)] ${
              emModoCompacto ? 'min-h-0 flex-1' : 'h-[15.875rem]'
            }`}
          >
            <div
              ref={feedRef}
              data-testid="chat-feed"
              role="log"
              aria-label="Histórico do chat"
              className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 py-1.5"
            >
              {mensagens.length === 0 ? (
                <p className="font-chat-mensagem text-[15px] text-zinc-400">Sem mensagens ainda</p>
              ) : (
                mensagens.map((mensagem) => {
                  const propria =
                    jogadorLocalId !== null && mensagem.jogadorId === jogadorLocalId
                  const cor =
                    HEX_COR_PEAO[jogadorPorId[mensagem.jogadorId]?.cor ?? 'branco']
                  return (
                    <div
                      key={mensagem.id}
                      data-testid="chat-mensagem"
                      data-jogador-id={mensagem.jogadorId}
                      data-propria={propria ? 'true' : 'false'}
                      className={`flex items-start gap-2 rounded-md px-1.5 py-1 ${
                        propria
                          ? 'bg-[rgba(253,184,19,0.12)] shadow-[inset_2px_0_0_rgba(253,184,19,0.55)]'
                          : ''
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        style={{ color: cor }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#504533] bg-zinc-950 font-chat-rotulo text-[10px] font-semibold"
                      >
                        {iniciaisDoApelido(mensagem.apelido)}
                      </span>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-baseline gap-x-2">
                          <span style={{ color: cor }} className="font-chat-rotulo text-[11px] tracking-wide">
                            {mensagem.apelido}
                          </span>
                          <span className="font-chat-rotulo text-[11px] tabular-nums text-zinc-500">
                            {formatarHora(mensagem.enviadoEm)}
                          </span>
                        </p>
                        <p className="font-chat-mensagem text-[15px] leading-snug break-words text-zinc-100">
                          {mensagem.conteudo}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <form
              className="flex items-center gap-2 border-t border-[#504533] bg-[rgba(0,0,0,0.6)] px-2 py-1.5"
              onSubmit={aoSubmeter}
            >
              <input
                ref={inputRef}
                data-testid="chat-input"
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                placeholder="ENVIAR MENSAGEM..."
                maxLength={LIMITE_DE_CARACTERES_DO_CHAT}
                disabled={emCooldown}
                aria-label="Nova mensagem"
                aria-describedby={recusa !== null ? 'chat-recusa' : undefined}
                className="min-w-0 flex-1 bg-transparent font-chat-mensagem text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none disabled:opacity-50"
              />
              <span
                data-testid="chat-contador"
                aria-hidden="true"
                className="font-chat-rotulo text-[11px] tabular-nums text-zinc-500"
              >
                {rascunho.length}/{LIMITE_DE_CARACTERES_DO_CHAT}
              </span>
              <button
                type="submit"
                aria-label="Enviar mensagem"
                disabled={!podeEnviar}
                className="text-[#FDB813] transition-colors hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
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
                  aria-hidden="true"
                >
                  <path d="M22 2 11 13" />
                  <path d="M22 2 15 22l-4-9-9-4z" />
                </svg>
              </button>
            </form>
            {recusa !== null ? (
              <p
                id="chat-recusa"
                data-testid="chat-recusa"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="px-2 pt-1 font-chat-rotulo text-[11px] leading-snug text-amber-300/90"
              >
                {recusa}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {aberto ? (
        <div
          data-testid="chat-backdrop"
          onClick={() => {
            aoFechar()
            botaoRef.current?.focus()
          }}
          aria-hidden="true"
          className="absolute inset-0 z-40 bg-zinc-950/30"
        />
      ) : null}
      {/*
        Região viva restrita a leitores de tela (issue #389): cada mensagem
        nova (humana ou de bot) é anunciada; o `key` remonta o nó a cada
        chegada para repetições re-anunciarem (padrão do anúncio de recusa).
      */}
      <div
        key={ultimaMensagem?.id ?? 'sem-mensagem'}
        data-testid="chat-anuncio"
        data-jogador-id={ultimaMensagem?.jogadorId ?? undefined}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {ultimaMensagem !== null
          ? `${ultimaMensagem.apelido}: ${ultimaMensagem.conteudo}`
          : ''}
      </div>
    </>
  )
}