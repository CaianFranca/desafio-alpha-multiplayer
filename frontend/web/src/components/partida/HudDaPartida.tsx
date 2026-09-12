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

import { useMemo, useState } from 'react'
import { HEX_COR_PEAO, ALVO_GERADORES_LIGADOS, type CorDoPeao } from '../../game/tabuleiro/contrato'
import type { PercepcaoDeJogador } from '../../game/tabuleiro/reducao'
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
  /** Partida em andamento (cronômetro conta). */
  emAndamento: boolean
  /** Partida em resultado (cronômetro congela). */
  emResultado: boolean
  /**
   * Identificador da Partida (paliativo do cronômetro: persiste o início em
   * `sessionStorage` para retomar ao sair e voltar na mesma aba).
   */
  partidaId?: string | null
  /**
   * Foto por jogador (jogadorId → URL); ausente/null mantém as iniciais.
   * Ainda sem fonte no snapshot — prop pronta para quando o servidor expor.
   */
  imagemPorJogador?: Readonly<Record<string, string | null | undefined>>
  /** Desistência da Partida (issue #290): envia DESISTIR_DA_PARTIDA e sai à principal. */
  onSair: () => void
  /**
   * Força o modo compacto (issue #230): true = compacto, false = integral.
   * null/undefined = deriva do viewport (paisagem-celular 800x360). Seam no
   * ponto mais alto para testes com viewport mockado.
   */
  compacto?: boolean | null
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
  if (imagemUrl) {
    return (
      <img
        src={imagemUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-full w-full object-cover"
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
 * confinado a este subcomponente, então re-renderiza só o MM:SS — as 6
 * regiões não reconciliam a cada segundo.
 */
function CronometroDoHud({
  emAndamento,
  emResultado,
  partidaId = null,
}: {
  emAndamento: boolean
  emResultado: boolean
  partidaId?: string | null
}) {
  const { texto: tempo, segundos } = useCronometroDaPartida({ emAndamento, emResultado, partidaId })
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
  emAndamento,
  emResultado,
  partidaId = null,
  imagemPorJogador = {},
  onSair,
  compacto = null,
}: HudDaPartidaProps) {
  const [confirmandoSaida, setConfirmandoSaida] = useState(false)
  const emModoCompacto = useViewportCompacto(compacto)

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
  // Anel da vez: só pisca quando a vez é de fato do jogador local.
  const ehMinhaVez =
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
          return (
            <div key={jogadorId} className="flex items-center gap-1.5">
              <div className={`relative flex items-center justify-center ${emModoCompacto ? 'h-10 w-10' : 'h-14 w-14'}`}>
                <svg
                  viewBox="0 0 56 56"
                  aria-hidden="true"
                  data-testid="hud-anel-sanidade"
                  data-jogador-id={jogadorId}
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
                      className={
                        indice < dados.sanidade
                          ? 'stroke-amber-400'
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
                  role="img"
                aria-label={`${dados.apelido}, Sanidade ${dados.sanidade} de 3${dados.emBaixaIluminacao ? ', em Baixa Iluminação' : ''}${dados.amedrontado ? ', Amedrontado' : ''}${dados.protegido ? ', protegido' : ''}`}
                title={dados.apelido}
                  data-compacto={emModoCompacto ? 'true' : undefined}
                  className={`flex items-center justify-center overflow-hidden rounded-full bg-zinc-950 font-display font-semibold shadow-[0_0_10px_rgba(0,0,0,0.8)] transition-all duration-500 ${emModoCompacto ? 'h-8 w-8 text-xs' : 'h-12 w-12 text-base'} ${
                    dados.amedrontado
                      ? 'opacity-70 grayscale'
                      : dados.emBaixaIluminacao
                        ? 'brightness-75 saturate-50'
                        : ''
                  }`}
                >
                  <ConteudoDoAvatar
                    apelido={dados.apelido}
                    cor={dados.cor}
                    imagemUrl={imagemPorJogador[jogadorId] ?? null}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-0.5" aria-hidden="true">
                {dados.emBaixaIluminacao ? (
                  <span data-testid="hud-estado-baixa-iluminacao" title="Baixa Iluminação" className="rounded border border-amber-500/30 bg-zinc-950/90 px-1.5 py-0.5 text-[length:var(--hud-corpo,0.875rem)] leading-none text-amber-300 shadow-[0_0_8px_rgba(0,0,0,0.7)]">
                    ◐
                  </span>
                ) : null}
                {dados.amedrontado ? (
                  <span data-testid="hud-estado-amedrontado" title="Amedrontado" className="rounded border border-red-500/30 bg-zinc-950/90 px-1.5 py-0.5 text-[length:var(--hud-corpo,0.875rem)] leading-none text-red-400 shadow-[0_0_8px_rgba(248,113,113,0.35)]">
                    ⚠
                  </span>
                ) : null}
                {dados.protegido ? (
                  <span data-testid="hud-estado-protecao" title="Proteção" className="rounded border border-cyan-500/30 bg-zinc-950/90 px-1.5 py-0.5 text-[length:var(--hud-corpo,0.875rem)] leading-none text-cyan-300 shadow-[0_0_8px_rgba(0,0,0,0.7)]">
                    🛡
                  </span>
                ) : null}
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
        <CronometroDoHud emAndamento={emAndamento} emResultado={emResultado} partidaId={partidaId} />
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
          data-testid="hud-sair"
          onClick={() => setConfirmandoSaida(true)}
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
          aria-label="Confirmar desistência da partida"
          aria-describedby="hud-confirmacao-saida-descricao"
          style={{
            right: 'calc(1.5rem + env(safe-area-inset-right))',
            top: 'calc(5rem + env(safe-area-inset-top))',
            maxHeight: 'calc(100vh - 7rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
          }}
          className="pointer-events-auto absolute right-6 top-20 flex max-w-[min(20rem,calc(100vw-3rem))] flex-col gap-2 overflow-auto rounded bg-zinc-900 px-4 py-3 text-sm text-zinc-100 shadow-xl"
        >
          <p id="hud-confirmacao-saida-descricao">Desistir da partida? Seu peão será removido e a equipe continua sem você.</p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="hud-sair-confirmar"
              onClick={onSair}
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
          </div>
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
            {ehMinhaVez ? (
              <span
                data-testid="hud-anel-da-vez"
                aria-hidden="true"
                className="absolute inset-0 animate-pulse rounded-full border-2 border-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.5)]"
              />
            ) : null}
            <div
              role="img"
              aria-label={`Retrato de ${jogadorLocal.dados.apelido}${ehMinhaVez ? ', com a vez' : ''}`}
              data-compacto={emModoCompacto ? 'true' : undefined}
              className={`flex items-center justify-center overflow-hidden rounded-full border-2 bg-zinc-900/80 font-display font-semibold transition-colors duration-500 ${emModoCompacto ? 'h-12 w-12 text-base' : 'h-20 w-20 text-2xl'} ${
                ehMinhaVez ? 'border-amber-300/40' : 'border-zinc-700'
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
                  className={`h-2 rounded-sm ${emModoCompacto ? 'w-5' : 'w-8'} ${indice < jogadorLocal.dados.sanidade ? 'bg-amber-400' : 'bg-zinc-700'}`}
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

      {/* ── inf-centro: conquistas soltas abaixo do girar (Geradores + Cartão; só ícones no compacto) ── */}
      <div
        data-testid="hud-conquistas"
        aria-label="Conquistas"
        data-compacto={emModoCompacto ? 'true' : undefined}
        style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        className={`absolute bottom-4 left-1/2 flex origin-bottom -translate-x-1/2 items-start lg:scale-100 ${emModoCompacto ? 'scale-75 gap-2' : 'scale-90 gap-4'}`}
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
                    role="img"
                    aria-label={ehAtivo ? `Vez de ${dados.apelido}` : `Próximo: ${dados.apelido}`}
                    title={dados.apelido}
                    data-compacto={emModoCompacto ? 'true' : undefined}
                    className={`flex items-center justify-center overflow-hidden rounded-lg border font-display text-xs transition-all duration-500 ${emModoCompacto ? 'h-8 w-8' : 'h-10 w-10'} ${
                      ehAtivo
                        ? 'border-amber-300/40 bg-zinc-800'
                        : 'border-zinc-800 bg-zinc-950 opacity-50 grayscale'
                    }`}
                  >
                    <ConteudoDoAvatar
                      apelido={dados.apelido}
                      cor={dados.cor}
                      imagemUrl={imagemPorJogador[jogadorId] ?? null}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
