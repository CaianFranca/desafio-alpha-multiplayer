/**
 * HUD definitivo da Partida (issue #226, spec pai #224) — 6 regiões sobre o
 * Ambiente de Jogo, somente leitura do modelo existente, sem card de Proteção.
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
 */

import { useState } from 'react'
import { HEX_COR_PEAO, ALVO_GERADORES_LIGADOS, type CorDoPeao } from '../../game/tabuleiro/contrato'
import type { PercepcaoDeJogador } from '../../game/tabuleiro/reducao'
import { useCronometroDaPartida } from './useCronometroDaPartida'

export interface HudDaPartidaProps {
  /** Projeção jogadorId → dados de exibição (snapshot + deltas, somente leitura). */
  jogadorPorId: Readonly<Record<string, PercepcaoDeJogador>>
  /** Jogador com a vez (null entre turnos). */
  jogadorAtivoId: string | null
  /** Jogador local (Sessão autenticada); null quando desconhecido. */
  jogadorLocalId: string | null
  /** pecaIds dos Geradores ligados (o length acende as conquistas). */
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
  /** Retorno à Sala de origem (SAIR com confirmação). */
  onSair: () => void
}

interface JogadorOrdenado {
  jogadorId: string
  dados: PercepcaoDeJogador
}

/** Iniciais do Apelido para o avatar placeholder (cor do peão). */
function iniciaisDoApelido(apelido: string): string {
  const letras = apelido.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ0-9]/g, '')
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
}: HudDaPartidaProps) {
  const [confirmandoSaida, setConfirmandoSaida] = useState(false)
  const { texto: tempo, segundos } = useCronometroDaPartida({ emAndamento, emResultado, partidaId })

  const ordenados = ordenarPorOrdemDeEntrada(jogadorPorId)
  // Sem snapshot o HUD fica oculto (sem dados inventados — critério #226).
  if (ordenados.length === 0) return null

  const local =
    (jogadorLocalId !== null ? ordenados.find((j) => j.jogadorId === jogadorLocalId) : undefined) ??
    ordenados.find((j) => j.jogadorId === jogadorAtivoId) ??
    ordenados[0]
  // Anel da vez: só pisca quando a vez é de fato do jogador local.
  const ehMinhaVez =
    jogadorLocalId !== null &&
    local.jogadorId === jogadorLocalId &&
    jogadorAtivoId === jogadorLocalId
  const adversarios = ordenados.filter((j) => j.jogadorId !== local.jogadorId)
  const geradoresAcesos = Math.min(geradoresLigados.length, ALVO_GERADORES_LIGADOS)

  return (
    <div
      data-testid="hud-da-partida"
      aria-label="HUD da Partida"
      className="pointer-events-none absolute inset-0 z-30"
    >
      {/* ── sup-esq: adversários em pilha vertical de avatares circulares ── */}
      <div
        data-testid="hud-outros-jogadores"
        aria-label="Outros jogadores"
        className="absolute left-6 top-6 flex origin-top-left scale-90 flex-col gap-2 lg:scale-100"
      >
        {adversarios.map(({ jogadorId, dados }) => {
          const ehAtivo = jogadorId === jogadorAtivoId
          return (
            <div key={jogadorId} className="flex items-center gap-1.5">
              <div className="relative flex h-14 w-14 items-center justify-center">
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
                  role="img"
                aria-label={`${dados.apelido}, Sanidade ${dados.sanidade} de 3${dados.emBaixaIluminacao ? ', em Baixa Iluminação' : ''}${dados.amedrontado ? ', Amedrontado' : ''}`}
                title={dados.apelido}
                  className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-zinc-950 font-display text-base font-semibold shadow-[0_0_10px_rgba(0,0,0,0.8)] transition-all duration-500 ${
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
                  <span data-testid="hud-estado-baixa-iluminacao" title="Baixa Iluminação" className="rounded border border-amber-500/30 bg-zinc-950/90 px-1.5 py-0.5 text-sm leading-none text-amber-300 shadow-[0_0_8px_rgba(0,0,0,0.7)]">
                    ◐
                  </span>
                ) : null}
                {dados.amedrontado ? (
                  <span data-testid="hud-estado-amedrontado" title="Amedrontado" className="rounded border border-red-500/30 bg-zinc-950/90 px-1.5 py-0.5 text-sm leading-none text-red-400 shadow-[0_0_8px_rgba(248,113,113,0.35)]">
                    ⚠
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── sup-centro: título ── */}
      <div className="absolute left-1/2 top-6 -translate-x-1/2">
        <h1
          data-testid="hud-titulo"
          className="font-display text-sm font-semibold uppercase tracking-[0.28em] text-zinc-100"
        >
          Flicker of Sanity
        </h1>
      </div>

      {/* ── sup-dir: cronômetro + volume visual + SAIR ── */}
      <div
        data-testid="hud-controles-partida"
        className="absolute right-6 top-6 flex origin-top-right scale-90 items-center gap-3 rounded bg-zinc-900/80 px-3 py-1.5 lg:scale-100"
      >
        <span
          data-testid="hud-cronometro"
          data-segundos={String(segundos)}
          role="timer"
          aria-label={`Tempo de partida: ${tempo}`}
          className="text-sm tabular-nums text-zinc-100"
        >
          {tempo}
        </span>
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
          className="pointer-events-auto rounded border border-amber-500/70 px-3 py-0.5 text-xs font-semibold uppercase tracking-[0.14em] text-amber-400 hover:border-amber-400 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          Sair
        </button>
      </div>
      {confirmandoSaida ? (
        <div
          data-testid="hud-confirmacao-saida"
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirmar saída da partida"
          className="pointer-events-auto absolute right-6 top-20 flex flex-col gap-2 rounded bg-zinc-900 px-4 py-3 text-sm text-zinc-100 shadow-xl"
        >
          <p>Sair da partida e voltar à sala?</p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="hud-sair-confirmar"
              onClick={onSair}
              className="rounded bg-amber-500 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-900 hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-amber-500"
            >
              Confirmar
            </button>
            <button
              type="button"
              data-testid="hud-sair-cancelar"
              onClick={() => setConfirmandoSaida(false)}
              className="rounded border border-zinc-600 px-4 py-1 text-xs uppercase tracking-wider text-zinc-200 hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-amber-500"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {/* ── inf-esq: jogador local (retrato + Apelido + Sanidade + estados) ── */}
      <div className="absolute bottom-6 left-6 flex origin-bottom-left scale-90 flex-col gap-3 lg:scale-100">
        <div data-testid="hud-jogador-local" data-jogador-id={local.jogadorId} className="flex items-center gap-3">
          <div className="relative flex h-20 w-20 items-center justify-center">
            {ehMinhaVez ? (
              <span
                data-testid="hud-anel-da-vez"
                aria-hidden="true"
                className="absolute inset-0 animate-pulse rounded-full border-2 border-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.5)]"
              />
            ) : null}
            <div
              role="img"
              aria-label={`Retrato de ${local.dados.apelido}${ehMinhaVez ? ', com a vez' : ''}`}
              className={`flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 bg-zinc-900/80 font-display text-2xl font-semibold transition-colors duration-500 ${
                ehMinhaVez ? 'border-amber-300/40' : 'border-zinc-700'
              }`}
            >
              <ConteudoDoAvatar
                apelido={local.dados.apelido}
                cor={local.dados.cor}
                imagemUrl={imagemPorJogador[local.jogadorId] ?? null}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-100">
              {local.dados.apelido}
            </span>
            <span className="text-xs uppercase tracking-[0.18em] text-amber-300">Sanidade</span>
            <div
              data-testid="hud-sanidade"
              data-sanidade={String(local.dados.sanidade)}
              role="meter"
              aria-label={`Sanidade ${local.dados.sanidade} de 3`}
              aria-valuemin={0}
              aria-valuemax={3}
              aria-valuenow={local.dados.sanidade}
              className="flex gap-1"
            >
              {[0, 1, 2].map((indice) => (
                <span
                  key={indice}
                  data-testid="hud-sanidade-segmento"
                  data-preenchido={indice < local.dados.sanidade ? 'true' : 'false'}
                  aria-hidden="true"
                  className={`h-2 w-8 rounded-sm ${indice < local.dados.sanidade ? 'bg-amber-400' : 'bg-zinc-700'}`}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <div
            data-testid="hud-card-baixa-iluminacao"
            data-ativo={local.dados.emBaixaIluminacao ? 'true' : 'false'}
            role="status"
            aria-label={local.dados.emBaixaIluminacao ? 'Baixa Iluminação ativa' : 'Baixa Iluminação inativa'}
            className={`w-24 max-w-[6rem] break-words rounded-md border px-1.5 py-1.5 text-center text-[10px] font-semibold uppercase leading-tight tracking-wider transition-all duration-500 ${
              local.dados.emBaixaIluminacao
                ? 'border-amber-400/70 bg-amber-400/10 text-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.35)]'
                : 'border-zinc-700/60 bg-zinc-950/70 text-zinc-500'
            }`}
          >
            <span
              aria-hidden="true"
              className={`block text-sm ${local.dados.emBaixaIluminacao ? 'text-amber-300' : 'text-zinc-600'}`}
            >
              ◐
            </span>
            Baixa Iluminação
          </div>
          <div
            data-testid="hud-card-amedrontado"
            data-ativo={local.dados.amedrontado ? 'true' : 'false'}
            role="status"
            aria-label={local.dados.amedrontado ? 'Amedrontado ativo' : 'Amedrontado inativo'}
            className={`w-24 max-w-[6rem] break-words rounded-md border px-1.5 py-1.5 text-center text-[10px] font-semibold uppercase leading-tight tracking-wider transition-all duration-500 ${
              local.dados.amedrontado
                ? 'border-red-400/70 bg-red-400/10 text-red-200 shadow-[0_0_16px_rgba(248,113,113,0.35)]'
                : 'border-zinc-700/60 bg-zinc-950/70 text-zinc-500'
            }`}
          >
            <span
              aria-hidden="true"
              className={`block text-sm ${local.dados.amedrontado ? 'text-red-300' : 'text-zinc-600'}`}
            >
              ⚠
            </span>
            Amedrontado
          </div>
        </div>
      </div>

      {/* ── inf-centro: 4 conquistas redondas (3 Geradores + Cartão) ── */}
      <div
        data-testid="hud-conquistas"
        aria-label="Conquistas"
        className="absolute bottom-6 left-1/2 flex origin-bottom -translate-x-1/2 scale-90 items-center gap-3 lg:scale-100"
      >
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
              className={`flex h-11 w-11 items-center justify-center rounded-full border text-sm ${
                acesa
                  ? 'border-amber-400 bg-amber-400/20 text-amber-300'
                  : 'border-zinc-700 bg-zinc-900/80 text-zinc-600 opacity-40'
              }`}
            >
              <span aria-hidden="true">⚡</span>
            </div>
          )
        })}
        <div
          data-testid="hud-conquista-cartao"
          data-acesa={cartaoDeAcessoObtido ? 'true' : 'false'}
          role="status"
          aria-label={cartaoDeAcessoObtido ? 'Cartão de Acesso obtido' : 'Cartão de Acesso não obtido'}
          title={cartaoDeAcessoObtido ? 'Cartão de Acesso obtido' : 'Cartão de Acesso'}
          className={`flex h-11 w-11 items-center justify-center rounded-full border text-sm ${
            cartaoDeAcessoObtido
              ? 'border-emerald-400 bg-emerald-400/20 text-emerald-300'
              : 'border-zinc-700 bg-zinc-900/80 text-zinc-600 opacity-40'
          }`}
        >
          <span aria-hidden="true">▣</span>
        </div>
      </div>

      {/* ── inf-dir: Turno em slots fixos (ordem de entrada): só o anel da
          vez transita entre os jogadores, ninguém muda de lugar ── */}
      {ordenados.length > 0 ? (
        <div
          data-testid="hud-turno"
          aria-label="Turno"
          className="absolute bottom-6 right-6 flex origin-bottom-right scale-90 flex-col gap-2 bg-transparent px-1 py-1 lg:scale-100"
        >
          <span className="text-right font-display text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/90">
            Turno
          </span>
          <div className="flex items-center gap-1.5">
            {ordenados.map(({ jogadorId, dados }) => {
              const ehAtivo = jogadorId === jogadorAtivoId
              return (
                <div key={jogadorId} className="relative flex h-10 w-10 items-center justify-center">
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
                    className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border font-display text-xs transition-all duration-500 ${
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
