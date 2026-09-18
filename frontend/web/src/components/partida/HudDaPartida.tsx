/**
 * HUD definitivo da Partida (issues #226 e #225, spec pai #224) — 6 regiões
 * sobre o Ambiente de Jogo, somente leitura do modelo existente, com os 3
 * cards de estado do jogador local (Baixa Iluminação, Amedrontado, Proteção)
 * e ícones de estado junto aos avatares dos companheiros.
 *
 * Layout espelhado da referência `GamePage.jpg` (posição das 6 regiões, anel
 * amarelo nos avatares, cards escuros translúcidos, título serifado com
 * tracking largo, botão SAIR outline): sup-esq pilha de adversários, sup-centro
 * título, sup-dir cronômetro/volume/SAIR, inf-esq jogador local, inf-centro
 * conquistas, inf-dir Turno.
 *
 * Responsividade (critério #226): até tablet o HUD só reduz a escala
 * (`scale-90` abaixo de `lg`), sem reorganizar as 6 regiões nem ocultar
 * conteúdo. Breakpoint mínimo suportado: 768px — abaixo disso as regiões são
 * mantidas com escala reduzida (portrait de celular fora do escopo).
 *
 * Modo compacto paisagem-celular (issue #230, 800x360): `compacto` ou
 * viewport paisagem curto/estreito (`deveUsarHudCompacto`) mantém as 6
 * regiões integrais em versão mínima — título fora, estados locais em ícones
 * ao lado do nome, avatares e conquistas reduzidos a ícones, com
 * `env(safe-area-inset-*)` nas bordas para não cobrir alvos de toque.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { HEX_COR_PEAO, ALVO_GERADORES_LIGADOS, type CorDoPeao } from '../../game/tabuleiro/contrato'
import type { PercepcaoDeJogador } from '../../game/tabuleiro/reducao'
import type { AlvoDoGuiaDeTurno } from '../../game/tabuleiro/guiaDeTurno'
import type { PresencaNaPartidaWire } from '@flicker/shared'
import { useCronometroDaPartida } from './useCronometroDaPartida'
import { useViewportCompacto } from '../../hooks/useViewportCompacto'

// Re-export para compatibilidade com testes que importam de HudDaPartida
export { deveUsarHudCompacto } from '../../hooks/useViewportCompacto'

export interface HudDaPartidaProps {
  /** Projeção jogadorId → dados de exibição (snapshot + deltas, somente leitura). */
  jogadorPorId: Readonly<Record<string, PercepcaoDeJogador>>
  /** Jogador com a vez (null entre turnos). */
  jogadorAtivoId: string | null
  /** Jogador local (Sessão autenticada); null quando desconhecido. */
  jogadorLocalId: string | null
  /** pecaIds dos Geradores ligados (os IDs únicos acendem as conquistas). */
  geradoresLigados: readonly string[]
  /** Cartão de Acesso obtido (Sala do Diretor). */
  cartaoDeAcessoObtido: boolean
  /** Peças restantes na Caixa (issue #439): null oculta o chip. */
  pecasRestantesNaCaixa?: number | null
  /** Partida em andamento (cronômetro conta). */
  emAndamento: boolean
  /** Partida em resultado (cronômetro congela). */
  emResultado: boolean
  /**
   * Marco autoritativo do início da Partida (epoch ms, issue #259), baseline
   * do cronômetro. `null`/ausente mantém o tempo em `00:00`.
   */
  iniciadaEm?: number | null
  /**
   * Foto por jogador (jogadorId → URL); ausente/null mantém as iniciais.
   * Alimentada pela PartidaPage via cor do peão → foto do avatar (#404).
   */
  imagemPorJogador?: Readonly<Record<string, string | null | undefined>>
  /** Desistência da Partida (issue #290): envia DESISTIR_DA_PARTIDA e sai à principal. */
  onSair: () => void
  /**
   * Saída com retry visível (R2, issue #290): confirmado sem OPEN, o modal
   * mostra o progresso da entrega + saída forçada. Omitido = comportamento
   * atual (confirmar/cancelar).
   */
  saindo?: boolean
  /** Escape do "saindo": navega sem a entrega (a pendência será reenviada). */
  onSairMesmoAssim?: () => void
  /** Cancela a saída durante o "saindo": volta à partida, purga a fila. */
  onCancelarSaida?: () => void
  /**
   * Força o modo compacto (issue #230): true = compacto, false = integral.
   * null/undefined = deriva do viewport (paisagem-celular 800x360). Seam no
   * ponto mais alto para testes com viewport mockado.
   */
  compacto?: boolean | null
  /**
   * Guia de turno (issue #441): texto da etapa atual (null = sem guia).
   * Card fixo pequeno com blur acima dos objetivos, sem interceptar cliques.
   */
  etapaDoGuiaTexto?: string | null
  /** Alvo atual do guia (só `turno` acende aqui — o resto vive no espelho). */
  guiaAlvo?: AlvoDoGuiaDeTurno | null
  /** Switch "Guia do Jogador" (persistido no navegador, default ligado). */
  guiaLigado?: boolean
  onMudarGuiaLigado?: (ligado: boolean) => void
  /** Modal de configurações do guia (foco gerenciado, cena inert no pai). */
  guiaModalAberto?: boolean
  onAbrirGuiaModal?: () => void
  onFecharGuiaModal?: () => void
}

interface JogadorOrdenado {
  jogadorId: string
  dados: PercepcaoDeJogador
}

/** Iniciais do Apelido para o avatar placeholder (cor do peão). */
function iniciaisDoApelido(apelido: string): string {
  const letras = apelido.replace(/[^\p{L}\p{N}]/gu, '')
  return (letras.slice(0, 2) || '??').toUpperCase()
}

/**
 * Conteúdo do avatar: foto quando houver URL, iniciais na cor do peão como
 * fallback. O contêiner (moldura circular/quadrada com `overflow-hidden`)
 * vive no chamador; aqui só o preenchimento em `object-cover`.
 */
function ConteudoDoAvatar({
  apelido,
  cor,
  imagemUrl = null,
}: {
  apelido: string
  cor: CorDoPeao
  imagemUrl?: string | null
}) {
  // Falha de carregamento (issue #404): a URL com erro volta às iniciais na
  // cor do peão. Guarda a URL que falhou (não um booleano) para resetar
  // automaticamente quando `imagemUrl` trocar. Retorno a URL já falha mantém
  // o fallback sem retentar (cache negativo intencional, evita loop de erro).
  const [urlComFalha, setUrlComFalha] = useState<string | null>(null)
  const comFalha = imagemUrl != null && imagemUrl === urlComFalha
  if (imagemUrl && !comFalha) {
    return (
      <img
        src={imagemUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-full w-full object-cover"
        onError={() => setUrlComFalha(imagemUrl)}
      />
    )
  }
  return (
    <span aria-hidden="true" style={{ color: HEX_COR_PEAO[cor] ?? '#fff' }}>
      {iniciaisDoApelido(apelido)}
    </span>
  )
}

function ordenarPorOrdemDeEntrada(jogadorPorId: Readonly<Record<string, PercepcaoDeJogador>>): JogadorOrdenado[] {
  return Object.entries(jogadorPorId)
    .map(([jogadorId, dados]) => ({ jogadorId, dados }))
    .sort((a, b) => a.dados.ordem - b.dados.ordem)
}

/**
 * Fila circular do card de Turno (issue #226): a leitura dos "próximos"
 * começa no Jogador Ativo e segue a ordem de entrada da Sala com wrap.
 * Entre turnos (`jogadorAtivoId` null) e ativo desconhecido mantém a ordem
 * de entrada — sem slot inventado.
 */
function ordenarCircularPorAtivo(
  ordenados: readonly JogadorOrdenado[],
  jogadorAtivoId: string | null,
): readonly JogadorOrdenado[] {
  if (jogadorAtivoId === null) return ordenados
  const indice = ordenados.findIndex((j) => j.jogadorId === jogadorAtivoId)
  if (indice === -1) return ordenados
  return [...ordenados.slice(indice), ...ordenados.slice(0, indice)]
}

/**
 * Cronômetro isolado do resto do HUD (revisão PR #279): o tick de 1×/s fica
 * confinado a este subcomponente, então re-renderiza só o texto do cronômetro
 * — as 6 regiões não reconciliam a cada segundo.
 */
function CronometroDoHud({
  emAndamento,
  emResultado,
  iniciadaEm = null,
}: {
  emAndamento: boolean
  emResultado: boolean
  iniciadaEm?: number | null
}) {
  const { texto: tempo, segundos } = useCronometroDaPartida({ emAndamento, emResultado, iniciadaEm })
  return (
    <span
      data-testid="hud-cronometro"
      data-segundos={String(segundos)}
      role="timer"
      aria-label={`Tempo de partida: ${tempo}`}
      className="text-[length:var(--hud-corpo,0.875rem)] leading-5 tabular-nums text-zinc-100"
    >
      {tempo}
    </span>
  )
}

// Anel de Sanidade ao redor do avatar do adversário: 3 arcos de 120° com
// folga entre eles; o arco `i` acende quando `i < sanidade` (mesma linguagem
// da barra segmentada local).
const RAIO_ANEL_SANIDADE = 26
const CIRC_ANEL_SANIDADE = 2 * Math.PI * RAIO_ANEL_SANIDADE
const ARCO_ANEL_SANIDADE = CIRC_ANEL_SANIDADE / 3
const FOLGA_ANEL_SANIDADE = 5

export function HudDaPartida({
  jogadorPorId,
  jogadorAtivoId,
  jogadorLocalId,
  geradoresLigados,
  cartaoDeAcessoObtido,
  pecasRestantesNaCaixa = null,
  emAndamento,
  emResultado,
  iniciadaEm = null,
  imagemPorJogador = {},
  onSair,
  saindo = false,
  onSairMesmoAssim,
  onCancelarSaida,
  compacto = null,
  etapaDoGuiaTexto = null,
  guiaAlvo = null,
  guiaLigado = true,
  onMudarGuiaLigado,
  guiaModalAberto = false,
  onAbrirGuiaModal,
  onFecharGuiaModal,
}: HudDaPartidaProps) {
  const [confirmandoSaida, setConfirmandoSaida] = useState(false)
  // Trava local anti-duplo-clique no Confirmar (#290): o gate de rede vive na
  // página, mas o modal segue aberto até o navigate assíncrono.
  const [saidaEnviada, setSaidaEnviada] = useState(false)
  const emModoCompacto = useViewportCompacto(compacto)
  // Foco gerenciado do modal do guia (#441): ao abrir, o foco vai ao switch;
  // Escape fecha; ao fechar, o foco volta ao botão de configurações.
  const botaoConfigRef = useRef<HTMLButtonElement | null>(null)
  const switchRef = useRef<HTMLButtonElement | null>(null)
  const guiaEstavaAbertoRef = useRef(false)
  useEffect(() => {
    if (guiaModalAberto) {
      guiaEstavaAbertoRef.current = true
      switchRef.current?.focus()
    } else if (guiaEstavaAbertoRef.current) {
      guiaEstavaAbertoRef.current = false
      botaoConfigRef.current?.focus()
    }
  }, [guiaModalAberto])
  useEffect(() => {
    if (!guiaModalAberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFecharGuiaModal?.()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [guiaModalAberto, onFecharGuiaModal])

  // Ordenação estável: recomputada apenas quando o modelo muda — o cronômetro
  // vive isolado em <CronometroDoHud>, então o tick de 1×/s não re-renderiza
  // as 6 regiões (revisão PR #279).
  const ordenados = useMemo(() => ordenarPorOrdemDeEntrada(jogadorPorId), [jogadorPorId])
  // Sem snapshot o HUD fica oculto (sem dados inventados — critério #226).
  if (ordenados.length === 0) return null

  const jogadorLocal =
    (jogadorLocalId !== null ? ordenados.find((j) => j.jogadorId === jogadorLocalId) : undefined) ??
    ordenados.find((j) => j.jogadorId === jogadorAtivoId) ??
    ordenados[0]
  // Anel do turno: só pisca quando o turno é de fato do jogador local.
  const ehMeuTurno =
    jogadorLocalId !== null &&
    jogadorLocal.jogadorId === jogadorLocalId &&
    jogadorAtivoId === jogadorLocalId
  const adversarios = ordenados.filter((j) => j.jogadorId !== jogadorLocal.jogadorId)
  // Fila circular do Turno (#226): a leitura começa no Jogador Ativo e segue
  // a ordem de entrada com wrap. Só o card de Turno rotaciona — os avatares
  // de adversários (sup-esq) mantêm a ordem de entrada fixa.
  const ordemDoTurno = ordenarCircularPorAtivo(ordenados, jogadorAtivoId)
  // Conquistas de Gerador: conta IDs ÚNICOS — um gerador repetido no array
  // (ex.: snapshot com duplicata) não acende duas conquistas (revisão PR #279).
  const geradoresAcesos = Math.min(new Set(geradoresLigados).size, ALVO_GERADORES_LIGADOS)

  // Ícones de estado local no modo compacto (#230): ao lado do nome, sem cards.
  const iconesLocaisCompactos: Array<{ chave: string; simbolo: string; titulo: string; ativo: boolean }> = [
    { chave: 'baixa-iluminacao', simbolo: '◐', titulo: 'Baixa Iluminação', ativo: jogadorLocal.dados.emBaixaIluminacao },
    { chave: 'amedrontado', simbolo: '⚠', titulo: 'Amedrontado', ativo: jogadorLocal.dados.amedrontado },
    { chave: 'protecao', simbolo: '🛡', titulo: 'Proteção', ativo: jogadorLocal.dados.protegido ?? false },
  ]

  return (
    <div
      data-testid="hud-da-partida"
      aria-label="HUD da Partida"
      data-modo-compacto={emModoCompacto ? 'true' : 'false'}
      className="pointer-events-none absolute inset-0 z-30"
    >
      {/* ── sup-esq: adversários em pilha vertical de avatares circulares ── */}
      <div
        data-testid="hud-outros-jogadores"
        aria-label="Outros jogadores"
        style={{
          left: 'calc(1.5rem + env(safe-area-inset-left))',
          top: 'calc(1.5rem + env(safe-area-inset-top))',
        }}
        className="absolute left-6 top-6 flex origin-top-left scale-90 flex-col gap-2 lg:scale-100"
      >
        {adversarios.map(({ jogadorId, dados }) => {
          const ehAtivo = jogadorId === jogadorAtivoId
          const presenca: PresencaNaPartidaWire = (dados as { presenca?: PresencaNaPartidaWire }).presenca ?? 'conectado'
          const emReconexao = presenca === 'em_reconexao'
          return (
            <div key={jogadorId} className="flex items-center gap-1.5">
              <div className={`relative flex items-center justify-center ${emModoCompacto ? 'h-10 w-10' : 'h-14 w-14'}`}>
                <svg
                  viewBox="0 0 56 56"
                  aria-hidden="true"
                  data-testid="hud-anel-sanidade"
                  data-jogador-id={jogadorId}
                  data-cor={dados.cor}
                  data-sanidade={String(dados.sanidade)}
                  className="absolute inset-0 h-full w-full"
                >
                  {[0, 1, 2].map((indice) => (
                    <circle
                      key={indice}
                      cx="28"
                      cy="28"
                      r={RAIO_ANEL_SANIDADE}
                      fill="none"
                      strokeWidth="3"
                      data-testid="hud-anel-sanidade-segmento"
                      data-jogador-id={jogadorId}
                      data-preenchido={indice < dados.sanidade ? 'true' : 'false'}
                      strokeDasharray={`${ARCO_ANEL_SANIDADE - FOLGA_ANEL_SANIDADE} ${CIRC_ANEL_SANIDADE - ARCO_ANEL_SANIDADE + FOLGA_ANEL_SANIDADE}`}
                      strokeDashoffset={-(indice * ARCO_ANEL_SANIDADE)}
                      transform="rotate(-90 28 28)"
                      style={indice < dados.sanidade ? { stroke: HEX_COR_PEAO[dados.cor] } : undefined}
                      className={
                        indice < dados.sanidade
                          ? ''
                          : dados.amedrontado
                            ? 'stroke-red-900'
                            : 'stroke-zinc-600'
                      }
                    />
                  ))}
                </svg>
                <div
                  data-testid="hud-avatar-adversario"
                  data-jogador-id={jogadorId}
                  data-sanidade={String(dados.sanidade)}
                  data-ativo={ehAtivo ? 'true' : 'false'}
                  data-em-baixa={dados.emBaixaIluminacao ? 'true' : undefined}
                  data-amedrontado={dados.amedrontado ? 'true' : undefined}
                  data-protegido={dados.protegido ? 'true' : undefined}
                  data-presenca={emReconexao ? 'em_reconexao' : undefined}
                  role="img"
                aria-label={`${dados.apelido}, Sanidade ${dados.sanidade} de 3${dados.emBaixaIluminacao ? ', em Baixa Iluminação' : ''}${dados.amedrontado ? ', Amedrontado' : ''}${dados.protegido ? ', protegido' : ''}${emReconexao ? ', reconectando' : ''}`}
                title={emReconexao ? 'Reconectando' : dados.apelido}
                  data-compacto={emModoCompacto ? 'true' : undefined}
                  className={`flex items-center justify-center overflow-hidden rounded-full bg-zinc-950 font-display font-semibold shadow-[0_0_10px_rgba(0,0,0,0.8)] transition-all duration-500 ${emModoCompacto ? 'h-8 w-8 text-xs' : 'h-12 w-12 text-base'} ${
                    emReconexao ? 'ring-2 ring-amber-400/70' : ''
                  }`}
                >
                  <ConteudoDoAvatar
                    apelido={dados.apelido}
                    cor={dados.cor}
                    imagemUrl={imagemPorJogador[jogadorId] ?? null}
                  />
                </div>
                {emReconexao ? (
                  <span
                    data-testid="hud-reconectando"
                    data-jogador-id={jogadorId}
                    title="Reconectando"
                    className="absolute -bottom-1 -right-1 rounded bg-amber-500 px-1 py-0.5 text-[10px] font-bold leading-none text-zinc-900 shadow"
                  >
                    <span aria-hidden="true">⟳</span> reconectando
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col gap-0.5">
                <span
                  data-testid="hud-nome-adversario"
                  data-jogador-id={jogadorId}
                  style={{ color: HEX_COR_PEAO[dados.cor] }}
                  className="max-w-[7rem] truncate text-sm font-semibold leading-5"
                >
                  {dados.apelido}
                </span>
                <div aria-hidden="true" className="flex flex-col items-start gap-0.5">
                {dados.emBaixaIluminacao ? (
                  <span data-testid="hud-estado-baixa-iluminacao" title="Baixa Iluminação" style={{ borderColor: HEX_COR_PEAO[dados.cor], color: HEX_COR_PEAO[dados.cor] }} className="inline-flex w-fit self-start rounded border bg-zinc-950/90 px-1.5 py-0.5 text-[length:var(--hud-corpo,0.875rem)] leading-none shadow-[0_0_8px_rgba(0,0,0,0.7)]">
                    ◐
                  </span>
                ) : null}
                {dados.amedrontado ? (
                  <span data-testid="hud-estado-amedrontado" title="Amedrontado" style={{ borderColor: HEX_COR_PEAO[dados.cor], color: HEX_COR_PEAO[dados.cor] }} className="inline-flex w-fit self-start rounded border bg-zinc-950/90 px-1.5 py-0.5 text-[length:var(--hud-corpo,0.875rem)] leading-none shadow-[0_0_8px_rgba(248,113,113,0.35)]">
                    ⚠
                  </span>
                ) : null}
                {dados.protegido ? (
                  <span data-testid="hud-estado-protecao" title="Proteção" style={{ borderColor: HEX_COR_PEAO[dados.cor], color: HEX_COR_PEAO[dados.cor] }} className="inline-flex w-fit self-start rounded border bg-zinc-950/90 px-1.5 py-0.5 text-[length:var(--hud-corpo,0.875rem)] leading-none shadow-[0_0_8px_rgba(0,0,0,0.7)]">
                    🛡
                  </span>
                ) : null}
                {emReconexao ? (
                  <span
                    data-testid="hud-estado-reconectando"
                    title="Reconectando"
                    className="rounded border border-amber-500/30 bg-zinc-950/90 px-1.5 py-0.5 text-[length:var(--hud-corpo,0.875rem)] leading-none text-amber-300 shadow-[0_0_8px_rgba(0,0,0,0.7)]"
                  >
                    <span aria-hidden="true">⟳</span> reconectando
                  </span>
                ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── sup-centro: título (fora no compacto #230 — mínimo mobile) ── */}
      {emModoCompacto ? null : (
        <div className="absolute left-1/2 top-6 -translate-x-1/2">
          <h1
            data-testid="hud-titulo"
            className="font-display text-sm font-semibold uppercase tracking-[0.28em] text-zinc-100"
          >
            Flicker of Sanity
          </h1>
        </div>
      )}

      {/* ── sup-dir: cronômetro + volume visual + SAIR (sistema integral no compacto) ── */}
      <div
        data-testid="hud-controles-partida"
        style={{
          right: 'calc(1.5rem + env(safe-area-inset-right))',
          top: 'calc(1.5rem + env(safe-area-inset-top))',
        }}
        className={`absolute right-6 top-6 flex origin-top-right items-center gap-3 rounded bg-zinc-900/80 lg:scale-100 ${emModoCompacto ? 'scale-75 px-2 py-1' : 'scale-90 px-3 py-1.5'}`}
      >
        <CronometroDoHud emAndamento={emAndamento} emResultado={emResultado} iniciadaEm={iniciadaEm} />
        <span
          data-testid="hud-volume"
          role="img"
          aria-label="Volume"
          title="Volume"
          className="text-zinc-300"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2 6v4h2.5L8 13.5v-11L4.5 6H2z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M10 5.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        <button
          type="button"
          ref={botaoConfigRef}
          data-testid="guia-config-botao"
          aria-label="Configurações do guia"
          title="Configurações do guia"
          aria-expanded={guiaModalAberto}
          onClick={() => {
            if (guiaModalAberto) onFecharGuiaModal?.()
            else onAbrirGuiaModal?.()
          }}
          className="pointer-events-auto flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-zinc-700 px-2 text-zinc-300 hover:border-zinc-400 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          <span aria-hidden="true">⚙</span>
        </button>
        <button
          type="button"
          data-testid="hud-sair"
          onClick={() => {
            setSaidaEnviada(false)
            setConfirmandoSaida(true)
          }}
          className="pointer-events-auto min-h-[44px] min-w-[44px] rounded border border-amber-500/70 px-4 py-2 text-[length:var(--hud-rotulo,0.75rem)] leading-4 font-semibold uppercase tracking-[0.14em] text-amber-400 hover:border-amber-400 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          Sair
        </button>
      </div>
      {confirmandoSaida ? (
        <div
          data-testid="hud-confirmacao-saida"
          role="alertdialog"
          aria-modal="true"
          aria-label={emResultado ? 'Sair da partida' : 'Confirmar desistência da partida'}
          aria-describedby="hud-confirmacao-saida-descricao"
          style={{
            right: 'calc(1.5rem + env(safe-area-inset-right))',
            top: 'calc(5rem + env(safe-area-inset-top))',
            maxHeight: 'calc(100vh - 7rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
          }}
          className="pointer-events-auto absolute right-6 top-20 flex max-w-[min(20rem,calc(100vw-3rem))] flex-col gap-2 overflow-auto rounded bg-zinc-900 px-4 py-3 text-sm text-zinc-100 shadow-xl"
        >
          <p id="hud-confirmacao-saida-descricao">{saindo ? 'Enviando sua desistência ao servidor… Aguarde a confirmação da conexão.' : emResultado ? 'Sair da partida? Você voltará à página principal.' : 'Desistir da partida? Seu peão será removido e a equipe continua sem você.'}</p>
          <div className="flex gap-2">
            {saindo ? (
              <>
                {onSairMesmoAssim ? (
                  <button
                    type="button"
                    data-testid="hud-sair-mesmo-assim"
                    onClick={onSairMesmoAssim}
                    className="min-h-[44px] min-w-[44px] rounded border border-zinc-600 px-4 py-2 text-[length:var(--hud-rotulo,0.75rem)] leading-4 uppercase tracking-wider text-zinc-200 hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-amber-500"
                  >
                    Sair mesmo assim
                  </button>
                ) : null}
                {onCancelarSaida ? (
                  <button
                    type="button"
                    data-testid="hud-sair-cancelar"
                    autoFocus
                    onClick={() => {
                      // Volta ao confirmar: rearma a trava para a nova tentativa.
                      setSaidaEnviada(false)
                      onCancelarSaida()
                    }}
                    className="min-h-[44px] min-w-[44px] rounded border border-zinc-600 px-4 py-2 text-[length:var(--hud-rotulo,0.75rem)] leading-4 uppercase tracking-wider text-zinc-200 hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-amber-500"
                  >
                    Cancelar
                  </button>
                ) : null}
              </>
            ) : (
              <>
            <button
              type="button"
              data-testid="hud-sair-confirmar"
              disabled={saidaEnviada}
              onClick={() => {
                if (saidaEnviada) return
                setSaidaEnviada(true)
                onSair()
              }}
              className="min-h-[44px] min-w-[44px] rounded bg-amber-500 px-4 py-2 text-[length:var(--hud-rotulo,0.75rem)] leading-4 font-semibold uppercase tracking-wider text-zinc-900 hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-amber-500"
            >
              Confirmar
            </button>
            <button
              type="button"
              data-testid="hud-sair-cancelar"
              autoFocus
              onClick={() => setConfirmandoSaida(false)}
              className="min-h-[44px] min-w-[44px] rounded border border-zinc-600 px-4 py-2 text-[length:var(--hud-rotulo,0.75rem)] leading-4 uppercase tracking-wider text-zinc-200 hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-amber-500"
            >
              Cancelar
            </button>
              </>
            )}
          </div>
        </div>
      ) : null}
      {guiaModalAberto ? (
        <div
          data-testid="guia-config-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Configurações do guia"
          style={{
            right: 'calc(1.5rem + env(safe-area-inset-right))',
            top: 'calc(5rem + env(safe-area-inset-top))',
          }}
          className="pointer-events-auto absolute right-6 top-20 flex max-w-[min(18rem,calc(100vw-3rem))] flex-col gap-3 rounded bg-zinc-900 px-4 py-3 text-sm text-zinc-100 shadow-xl"
        >
          <span className="font-display text-[length:var(--hud-rotulo,0.75rem)] leading-4 font-semibold uppercase tracking-[0.28em] text-zinc-300">
            Guia do Jogador
          </span>
          <button
            type="button"
            ref={switchRef}
            data-testid="guia-switch"
            role="switch"
            aria-checked={guiaLigado}
            aria-label="Guia do Jogador"
            onClick={() => onMudarGuiaLigado?.(!guiaLigado)}
            className="flex min-h-[44px] items-center justify-between gap-3 rounded border border-zinc-700 px-3 py-2 hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            <span>Guia do Jogador</span>
            <span
              aria-hidden="true"
              data-ativo={guiaLigado ? 'true' : 'false'}
              className={`relative h-5 w-9 rounded-full transition-colors ${guiaLigado ? 'bg-cyan-500' : 'bg-zinc-600'}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${guiaLigado ? 'left-[1.125rem]' : 'left-0.5'}`}
              />
            </span>
          </button>
          <button
            type="button"
            data-testid="guia-config-fechar"
            onClick={() => onFecharGuiaModal?.()}
            className="min-h-[44px] rounded border border-zinc-600 px-4 py-2 text-[length:var(--hud-rotulo,0.75rem)] leading-4 uppercase tracking-wider text-zinc-200 hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            Fechar
          </button>
        </div>
      ) : null}

      {/* ── inf-esq: jogador local (retrato + Apelido + Sanidade + estados) ── */}
      <div
        style={{
          left: 'calc(1.5rem + env(safe-area-inset-left))',
          bottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
        }}
        className="absolute bottom-6 left-6 flex origin-bottom-left scale-90 flex-col gap-3 lg:scale-100"
      >
        <div data-testid="hud-jogador-local" data-jogador-id={jogadorLocal.jogadorId} className="flex items-center gap-3">
          <div className={`relative flex items-center justify-center ${emModoCompacto ? 'h-12 w-12' : 'h-20 w-20'}`}>
            {ehMeuTurno ? (
              <span
                data-testid="hud-anel-da-vez"
                aria-hidden="true"
                className="absolute inset-0 animate-pulse rounded-full border-2 border-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.5)]"
              />
            ) : null}
            <div
              role="img"
              aria-label={`Retrato de ${jogadorLocal.dados.apelido}${ehMeuTurno ? ', com a vez' : ''}`}
              data-compacto={emModoCompacto ? 'true' : undefined}
              className={`flex items-center justify-center overflow-hidden rounded-full border-2 bg-zinc-900/80 font-display font-semibold transition-colors duration-500 ${emModoCompacto ? 'h-12 w-12 text-base' : 'h-20 w-20 text-2xl'} ${
                ehMeuTurno ? 'border-amber-300/40' : 'border-zinc-700'
              }`}
            >
              <ConteudoDoAvatar
                apelido={jogadorLocal.dados.apelido}
                cor={jogadorLocal.dados.cor}
                imagemUrl={imagemPorJogador[jogadorLocal.jogadorId] ?? null}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-100">
              {jogadorLocal.dados.apelido}
              {emModoCompacto ? (
                <span data-testid="hud-local-estados-icones" aria-label="Estados do jogador local" className="flex items-center gap-1">
                  {iconesLocaisCompactos.map((icone) => (
                    <span
                      key={icone.chave}
                      data-testid="hud-local-estado-icone"
                      data-estado={icone.chave}
                      data-ativo={icone.ativo ? 'true' : 'false'}
                      title={icone.titulo}
                      aria-label={icone.ativo ? `${icone.titulo} ativo` : `${icone.titulo} inativo`}
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-sm text-sm leading-none ${icone.ativo ? 'opacity-100' : 'opacity-30 grayscale'}`}
                    >
                      {icone.simbolo}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            <span className="text-[length:var(--hud-rotulo,0.75rem)] leading-4 uppercase tracking-[0.18em] text-amber-300">Sanidade</span>
            <div
              data-testid="hud-sanidade"
              data-sanidade={String(jogadorLocal.dados.sanidade)}
              role="meter"
              aria-label={`Sanidade ${jogadorLocal.dados.sanidade} de 3`}
              aria-valuemin={0}
              aria-valuemax={3}
              aria-valuenow={jogadorLocal.dados.sanidade}
              className="flex gap-1"
            >
              {[0, 1, 2].map((indice) => (
                <span
                  key={indice}
                  data-testid="hud-sanidade-segmento"
                  data-preenchido={indice < jogadorLocal.dados.sanidade ? 'true' : 'false'}
                  aria-hidden="true"
                  style={indice < jogadorLocal.dados.sanidade ? { backgroundColor: HEX_COR_PEAO[jogadorLocal.dados.cor] } : undefined}
                  className={`h-2 rounded-sm ${emModoCompacto ? 'w-5' : 'w-8'} ${indice < jogadorLocal.dados.sanidade ? '' : 'bg-zinc-700'}`}
                />
              ))}
            </div>
          </div>
        </div>
        {emModoCompacto ? null : (
        <div className="flex gap-2">
          <div
            data-testid="hud-card-baixa-iluminacao"
            data-ativo={jogadorLocal.dados.emBaixaIluminacao ? 'true' : 'false'}
            role="status"
            aria-label={jogadorLocal.dados.emBaixaIluminacao ? 'Baixa Iluminação ativa' : 'Baixa Iluminação inativa'}
            className={`w-24 max-w-[6rem] break-words rounded-md border px-1.5 py-1.5 text-center text-[length:var(--hud-micro,0.625rem)] font-semibold uppercase leading-tight tracking-wider transition-all duration-500 ${
              jogadorLocal.dados.emBaixaIluminacao
                ? 'border-amber-400/70 bg-amber-400/10 text-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.35)]'
                : 'border-zinc-700/60 bg-zinc-950/70 text-zinc-500'
            }`}
          >
            <span
              aria-hidden="true"
              className={`block text-[length:var(--hud-corpo,0.875rem)] leading-5 ${jogadorLocal.dados.emBaixaIluminacao ? 'text-amber-300' : 'text-zinc-600'}`}
            >
              ◐
            </span>
            Baixa Iluminação
          </div>
          <div
            data-testid="hud-card-amedrontado"
            data-ativo={jogadorLocal.dados.amedrontado ? 'true' : 'false'}
            role="status"
            aria-label={jogadorLocal.dados.amedrontado ? 'Amedrontado ativo' : 'Amedrontado inativo'}
            className={`w-24 max-w-[6rem] break-words rounded-md border px-1.5 py-1.5 text-center text-[length:var(--hud-micro,0.625rem)] font-semibold uppercase leading-tight tracking-wider transition-all duration-500 ${
              jogadorLocal.dados.amedrontado
                ? 'border-red-400/70 bg-red-400/10 text-red-200 shadow-[0_0_16px_rgba(248,113,113,0.35)]'
                : 'border-zinc-700/60 bg-zinc-950/70 text-zinc-500'
            }`}
          >
            <span
              aria-hidden="true"
              className={`block text-[length:var(--hud-corpo,0.875rem)] leading-5 ${jogadorLocal.dados.amedrontado ? 'text-red-300' : 'text-zinc-600'}`}
            >
              ⚠
            </span>
            Amedrontado
          </div>
          <div
            data-testid="hud-card-protecao"
            data-ativo={jogadorLocal.dados.protegido ? 'true' : 'false'}
            role="status"
            aria-label={jogadorLocal.dados.protegido ? 'Proteção ativa' : 'Proteção inativa'}
            className={`w-24 max-w-[6rem] break-words rounded-md border px-1.5 py-1.5 text-center text-[length:var(--hud-micro,0.625rem)] font-semibold uppercase leading-tight tracking-wider transition-all duration-500 ${
              jogadorLocal.dados.protegido
                ? 'border-cyan-400/70 bg-cyan-400/10 text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.35)]'
                : 'border-zinc-700/60 bg-zinc-950/70 text-zinc-500'
            }`}
          >
            <span
              aria-hidden="true"
              className={`block text-[length:var(--hud-corpo,0.875rem)] leading-5 ${jogadorLocal.dados.protegido ? 'text-cyan-300' : 'text-zinc-600'}`}
            >
              🛡
            </span>
            Proteção
          </div>
        </div>
        )}
      </div>

      {/* ── Guia de turno (#441): card visual fixo pequeno com blur acima
          dos objetivos (inf-centro conquistas), sem interceptar cliques; a
          etapa é anunciada num nó vivo `sr-only` separado (o card visual é
          `aria-hidden` — um único anunciador evita duplo anúncio e
          re-anúncios de re-render) ── */}
      {etapaDoGuiaTexto !== null ? (
        <>
          <div
            style={{ bottom: emModoCompacto ? 'calc(5rem + env(safe-area-inset-bottom))' : 'calc(7rem + env(safe-area-inset-bottom))' }}
            className="pointer-events-none absolute left-1/2 -translate-x-1/2"
            aria-hidden="true"
          >
            <div
              data-testid="guia-de-turno"
              data-compacto={emModoCompacto ? 'true' : undefined}
              className={`pointer-events-none max-w-[16rem] rounded-md border border-cyan-300/40 bg-zinc-950/70 px-3 py-1.5 text-center font-semibold text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.25)] backdrop-blur-md ${emModoCompacto ? 'text-xs leading-4' : 'text-sm leading-5'}`}
            >
              {etapaDoGuiaTexto}
            </div>
          </div>
          <div
            data-testid="guia-de-turno-vivo"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {etapaDoGuiaTexto}
          </div>
        </>
      ) : null}

      {/* ── inf-centro: conquistas soltas abaixo do girar (Geradores | Caixa | Cartão; só ícones no compacto) ── */}
      <div
        data-testid="hud-conquistas"
        aria-label="Conquistas"
        data-compacto={emModoCompacto ? 'true' : undefined}
        style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        className={`absolute bottom-4 left-1/2 flex origin-bottom -translate-x-1/2 items-center lg:scale-100 ${emModoCompacto ? 'scale-75 gap-2' : 'scale-90 gap-4'}`}
      >
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            {Array.from({ length: ALVO_GERADORES_LIGADOS }, (_, indice) => {
              const acesa = indice < geradoresAcesos
              return (
                <div
                  key={`gerador-${indice}`}
                  data-testid="hud-conquista-gerador"
                  data-indice={String(indice)}
                  data-acesa={acesa ? 'true' : 'false'}
                  role="status"
                  aria-label={acesa ? `Gerador ${indice + 1} ligado` : `Gerador ${indice + 1} desligado`}
                  title={acesa ? `Gerador ${indice + 1} ligado` : `Gerador ${indice + 1}`}
                  className={`flex items-center justify-center rounded-full border-2 text-sm leading-none transition-all duration-500 ${emModoCompacto ? 'h-8 w-8' : 'h-10 w-10'} ${
                    acesa
                      ? 'border-amber-300 bg-amber-400/15 text-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.5)]'
                      : 'border-dashed border-zinc-700 bg-zinc-900/60 text-zinc-600 opacity-40'
                  }`}
                >
                  <span aria-hidden="true" className={`leading-none ${acesa ? 'drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]' : ''}`}>⚡</span>
                </div>
              )
            })}
          </div>
          {emModoCompacto ? null : (
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-400">
            Geradores
          </span>
          )}
        </div>
        {pecasRestantesNaCaixa !== null ? (
          <>
            <div data-testid="hud-divisor-caixa" aria-hidden="true" className="w-px self-stretch bg-zinc-700/60 mx-1" />
            <div className="flex flex-col items-center gap-1">
              <div
                data-testid="hud-caixa-contador"
                data-valor={String(pecasRestantesNaCaixa)}
                role="status"
                aria-label={`Caixa com ${pecasRestantesNaCaixa} peças restantes`}
                className={`flex items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/80 tabular-nums text-zinc-100 ${emModoCompacto ? 'h-8 min-w-8 px-2 text-xs' : 'h-10 min-w-10 px-2.5 text-sm'}`}
              >
                {pecasRestantesNaCaixa}
              </div>
              {emModoCompacto ? null : (
                <span className="font-display text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-400">Caixa</span>
              )}
            </div>
            <div data-testid="hud-divisor-caixa" aria-hidden="true" className="w-px self-stretch bg-zinc-700/60 mx-1" />
          </>
        ) : null}
        <div className="flex flex-col items-center gap-1">
          <div
            data-testid="hud-conquista-cartao"
            data-acesa={cartaoDeAcessoObtido ? 'true' : 'false'}
            role="status"
            aria-label={cartaoDeAcessoObtido ? 'Cartão de Acesso obtido' : 'Cartão de Acesso não obtido'}
            title={cartaoDeAcessoObtido ? 'Cartão de Acesso obtido' : 'Cartão de Acesso'}
            className={`flex items-center justify-center rounded-full border-2 text-sm leading-none transition-all duration-500 ${emModoCompacto ? 'h-8 w-8' : 'h-10 w-10'} ${
              cartaoDeAcessoObtido
                  ? 'border-emerald-300 bg-emerald-400/15 text-emerald-200 shadow-[0_0_16px_rgba(52,211,153,0.5)]'
                  : 'border-dashed border-zinc-700 bg-zinc-900/60 text-zinc-600 opacity-40'
            }`}
          >
            <span aria-hidden="true" className={`leading-none ${cartaoDeAcessoObtido ? 'drop-shadow-[0_0_6px_rgba(52,211,153,0.8)]' : ''}`}>▣</span>
          </div>
          {emModoCompacto ? null : (
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-400">
            Cartão
          </span>
          )}
        </div>
      </div>

      {/* ── inf-dir: Turno em fila CIRCULAR a partir do Jogador Ativo (#226):
          a leitura começa na vez atual e os próximos seguem a ordem de
          entrada da Sala com wrap (o ativo abre a fila em destaque); sem
          ativo (entre turnos) os slots seguem a ordem de entrada ── */}
      {ordemDoTurno.length > 0 ? (
        <div
          data-testid="hud-turno"
          aria-label="Turno"
          style={{
            right: 'calc(1.5rem + env(safe-area-inset-right))',
            bottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
          }}
          className={`absolute bottom-6 right-6 flex origin-bottom-right flex-col gap-2 bg-transparent px-1 py-1 lg:scale-100 ${emModoCompacto ? 'scale-75' : 'scale-90'}`}
        >
          <span className="text-right font-display text-[length:var(--hud-rotulo,0.75rem)] leading-4 font-semibold uppercase tracking-[0.28em] text-amber-200/90">
            Turno
          </span>
          <div className="flex items-center gap-1.5">
            {ordemDoTurno.map(({ jogadorId, dados }) => {
              const ehAtivo = jogadorId === jogadorAtivoId
              const presencaTurno: PresencaNaPartidaWire = (dados as { presenca?: PresencaNaPartidaWire }).presenca ?? 'conectado'
              const emReconexaoTurno = presencaTurno === 'em_reconexao'
              return (
                <div key={jogadorId} className={`relative flex items-center justify-center ${emModoCompacto ? 'h-8 w-8' : 'h-10 w-10'}`}>
                  {ehAtivo ? (
                    <span
                      data-testid="hud-turno-anel-da-vez"
                      aria-hidden="true"
                      className="absolute inset-0 animate-pulse rounded-lg border-2 border-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.55)]"
                    />
                  ) : null}
                  <div
                    data-testid={ehAtivo ? 'hud-turno-ativo' : 'hud-turno-proximo'}
                    data-jogador-id={jogadorId}
                    data-presenca={emReconexaoTurno ? 'em_reconexao' : undefined}
                    data-guia={ehAtivo && guiaAlvo === 'turno' ? 'true' : undefined}
                    role="img"
                    aria-label={`${ehAtivo ? `Vez de ${dados.apelido}` : `Próximo: ${dados.apelido}`}${emReconexaoTurno ? ', reconectando' : ''}`}
                    title={emReconexaoTurno ? `${dados.apelido} — reconectando` : dados.apelido}
                    data-compacto={emModoCompacto ? 'true' : undefined}
                    className={`flex items-center justify-center overflow-hidden rounded-lg border font-display text-xs transition-all duration-500 ${emModoCompacto ? 'h-8 w-8' : 'h-10 w-10'} ${
                      ehAtivo
                        ? 'border-amber-300/40 bg-zinc-800'
                        : 'border-zinc-800 bg-zinc-950 opacity-50 grayscale'
                    } ${emReconexaoTurno ? 'ring-2 ring-amber-400/70' : ''}`}
                  >
                    <ConteudoDoAvatar
                      apelido={dados.apelido}
                      cor={dados.cor}
                      imagemUrl={imagemPorJogador[jogadorId] ?? null}
                    />
                  </div>
                  {emReconexaoTurno ? (
                    <span
                      data-testid="hud-turno-reconectando"
                      data-jogador-id={jogadorId}
                      title="Reconectando"
                      className="absolute -bottom-1 -right-1 rounded bg-amber-500 px-1 py-0.5 text-[8px] font-bold leading-none text-zinc-900 shadow"
                    >
                      <span aria-hidden="true">⟳</span> reconectando
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
