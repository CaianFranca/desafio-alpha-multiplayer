/**
 * Painel de chat da Partida (issue #389).
 *
 * Botão discreto no HUD com badge de não lidas (`role="status"`) e painel
 * expansível ancorado à direita sob o sistema do HUD: histórico rolável com
 * hora HH:MM e apelido na cor do peão por mensagem (humanas e de bot
 * renderizadas igual — a cor vem do roster `jogadorPorId`, a identidade do
 * bot também vive lá) e input com contador do limite.
 *
 * Block da cena: com o painel aberto EM ANDAMENTO um backdrop cobre a tela
 * engolindo cliques (Escape, clique no backdrop ou no botão fecham e devolvem
 * o controle) — o jogo NÃO pausa, só o input para. No RESULTADO não há
 * backdrop nem trap de Tab (o jogo já acabou e os botões de Vitória/Derrota
 * precisam seguir clicáveis — a cena segue protegida pelo próprio overlay);
 * Escape fecha sempre, em qualquer estado. O gate de teclado para a
 * cena (R/E/Espaço/Enter) vive na PartidaPage, que lê o estado aberto.
 * Notícias de novas mensagens (e recusas) saem por região aria-live; o
 * badge zera ao abrir.
 *
 * Em viewport compacto de paisagem (#230) o painel vira drawer ancorado na
 * faixa entre o sistema sup-dir e o Turno inf-dir — mesma moldura do modal
 * de saída. No compacto o backdrop fica ABAIXO do HUD (drawer, critério [5]
 * da #389: o HUD essencial segue clicável), no integral segue modal
 * (backdrop acima de tudo). O jogo segue rolando por baixo em ambos.
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
  /** Input congelado na janela pós-rate-limit (derivado no hook, sem Date no render). */
  emCooldown: boolean
  /** Feedback enxuto de recusa (vazia/longa/rate-limit/sem conexão). */
  recusa: string | null
  /**
   * Última mensagem do LIVE para o anúncio SR (R2): a semente do histórico
   * nunca avança este prop, então reconexão não anuncia conversa velha.
   * Sem live ainda, a região anuncia vazio.
   */
  anuncio: MensagemDoChatDaPartida | null
  /** Roster do snapshot (jogadorId → apelido/cor): fonte da cor do peão. */
  jogadorPorId: Readonly<Record<string, PercepcaoDeJogador>>
  /** Sessão do Jogador local — mensagens próprias ganham destaque âmbar. */
  jogadorLocalId: string | null
  aoAbrir: () => void
  aoFechar: () => void
  /** Envia; devolve true quando aceito localmente (o painel limpa o rascunho). */
  aoEnviar: (conteudo: string) => boolean
  /**
   * Bloqueio da cena: true em andamento (backdrop + trap de Tab ativos),
   * false no Resultado (sem backdrop, sem trap — só Escape fecha). A página
   * passa `estadoEmAndamento`.
   */
  bloqueiaCena?: boolean
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
  emCooldown,
  recusa,
  anuncio,
  jogadorPorId,
  jogadorLocalId,
  aoAbrir,
  aoFechar,
  aoEnviar,
  bloqueiaCena = true,
  compacto = null,
}: ChatDaPartidaProps) {
  const [rascunho, setRascunho] = useState('')
  const botaoRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const feedRef = useRef<HTMLDivElement | null>(null)
  const raizRef = useRef<HTMLDivElement | null>(null)
  // Seguir o fim do feed (M1): o usuário que rolou para cima ler o histórico
  // não é puxado para baixo a cada mensagem nova.
  const seguirFeedRef = useRef(true)
  const emModoCompacto = useViewportCompacto(compacto)
  const podeEnviar = rascunho.trim().length > 0 && !emCooldown

  // Abertura move o foco ao input (autoFocus é frágil em React/jsdom) e arma
  // o block da cena: Escape fecha SEMPRE (atalho, não bloqueio) e devolve o
  // foco ao botão; Tab circula SÓ dentro do painel quando `bloqueiaCena`
  // (em andamento — o backdrop bloqueia ponteiro, o trap bloqueia o teclado;
  // o gate R/E/Espaço/Enter da página lê o estado aberto). No Resultado
  // (`bloqueiaCena=false`) não há trap: os botões de Vitória/Derrota seguem
  // alcançáveis por teclado.
  useEffect(() => {
    if (!aberto) return
    seguirFeedRef.current = true
    inputRef.current?.focus()
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        aoFechar()
        botaoRef.current?.focus()
        return
      }
      if (!bloqueiaCena) return
      if (e.key !== 'Tab') return
      const raiz = raizRef.current
      if (!raiz) return
      // Sem filtro de visibilidade por layout (offsetParent é null no jsdom
      // e o painel aberto só contém elementos visíveis): o seletor já exclui
      // desabilitados.
      const focaveis = [...raiz.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )]
      if (focaveis.length === 0) return
      const primeiro = focaveis[0]!
      const ultimo = focaveis[focaveis.length - 1]!
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto, aoFechar, bloqueiaCena])

  // Auto-scroll condicional (M1): só desce sozinho quando o leitor já estava
  // no fim (ou na abertura). jsdom não implementa scrollTo — fallback.
  useEffect(() => {
    if (!aberto || !seguirFeedRef.current) return
    const feed = feedRef.current
    if (!feed) return
    try {
      if (typeof feed.scrollTo === 'function') feed.scrollTo({ top: feed.scrollHeight })
      else feed.scrollTop = feed.scrollHeight
    } catch {
      // Feed rolável é progressivo: sem scroll o chat segue legível.
    }
  }, [aberto, mensagens.length])

  const aoRolarFeed = () => {
    const feed = feedRef.current
    if (!feed) return
    seguirFeedRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80
  }

  const aoSubmeter = (e: FormEvent) => {
    e.preventDefault()
    if (aoEnviar(rascunho)) setRascunho('')
  }

  return (
    <>
      <div
        ref={raizRef}
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
            {/*
              role=log dá semântica de histórico; aria-live=off porque o
              anúncio polite dedicado (chat-anuncio, R2) já anuncia cada live
              — sem isso o leitor diria tudo 2x (R3).
            */}
            <div
              ref={feedRef}
              data-testid="chat-feed"
              role="log"
              aria-live="off"
              aria-label="Histórico do chat"
              onScroll={aoRolarFeed}
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
      {aberto && bloqueiaCena ? (
        <div
          data-testid="chat-backdrop"
          data-compacto={emModoCompacto ? 'true' : 'false'}
          onClick={() => {
            aoFechar()
            botaoRef.current?.focus()
          }}
          aria-hidden="true"
          // Ordem de empilhamento (critério [5] da #389, review #401):
          // cena (`ambiente-de-jogo`, absolute sem z → z-auto) < backdrop
          // < HUD (`hud-da-partida`, z-30 com pointer-events-none na raiz e
          // auto só nos interativos) < painel do chat (z-50). No compacto o
          // backdrop em z-20 engole o clique na cena mas deixa os botões do
          // HUD (SAIR, Turno) acima e clicáveis — drawer, não modal. No
          // integral o backdrop em z-40 mantém o modal (cena + HUD
          // bloqueados). O gate de teclado (R/E/Espaço/Enter) vale nos dois.
          className={
            emModoCompacto
              ? 'absolute inset-0 z-20 bg-zinc-950/30'
              : 'absolute inset-0 z-40 bg-zinc-950/30'
          }
        />
      ) : null}
      {/*
        Região viva restrita a leitores de tela (issue #389): cada mensagem
        nova DO LIVE (humana ou de bot) é anunciada; o `key` remonta o nó a
        cada chegada para repetições re-anunciarem. A semente do histórico
        (R2) nunca avança `anuncio`: reconexão não anuncia conversa velha.
      */}
      <div
        key={anuncio?.id ?? 'sem-mensagem'}
        data-testid="chat-anuncio"
        data-jogador-id={anuncio?.jogadorId ?? undefined}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {anuncio !== null ? `${anuncio.apelido}: ${anuncio.conteudo}` : ''}
      </div>
    </>
  )
}