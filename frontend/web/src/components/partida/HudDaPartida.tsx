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
import { HEX_COR_PEAO, ALVO_GERADORES_LIGADOS } from '../../game/tabuleiro/contrato'
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

function ordenarPorOrdemDeEntrada(jogadorPorId: Readonly<Record<string, PercepcaoDeJogador>>): JogadorOrdenado[] {
  return Object.entries(jogadorPorId)
    .map(([jogadorId, dados]) => ({ jogadorId, dados }))
    .sort((a, b) => a.dados.ordem - b.dados.ordem)
}

/**
 * Fila circular do Turno a partir do Jogador Ativo (ordem de entrada da
 * Sala): o ativo abre a fila, os próximos seguem na ordem.
 */
function filaCircularDoTurno(
  jogadorPorId: Readonly<Record<string, PercepcaoDeJogador>>,
  jogadorAtivoId: string | null,
): JogadorOrdenado[] {
  const ordenados = ordenarPorOrdemDeEntrada(jogadorPorId)
  if (ordenados.length === 0) return ordenados
  const indiceDoAtivo = ordenados.findIndex((j) => j.jogadorId === jogadorAtivoId)
  if (indiceDoAtivo <= 0) return ordenados
  return [...ordenados.slice(indiceDoAtivo), ...ordenados.slice(0, indiceDoAtivo)]
}

const CLASSE_CARD = 'rounded bg-zinc-900/80 text-zinc-200'

export function HudDaPartida({
  jogadorPorId,
  jogadorAtivoId,
  jogadorLocalId,
  geradoresLigados,
  cartaoDeAcessoObtido,
  emAndamento,
  emResultado,
  partidaId = null,
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
  const adversarios = ordenados.filter((j) => j.jogadorId !== local.jogadorId)
  const filaDoTurno = filaCircularDoTurno(jogadorPorId, jogadorAtivoId)
  const [turnoAtivo, ...proximosDoTurno] = filaDoTurno
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
        className="absolute left-4 top-4 flex origin-top-left scale-90 flex-col gap-2 lg:scale-100"
      >
        {adversarios.map(({ jogadorId, dados }) => {
          const ehAtivo = jogadorId === jogadorAtivoId
          return (
            <div key={jogadorId} className="flex items-center gap-1.5">
              <div
                data-testid="hud-avatar-adversario"
                data-jogador-id={jogadorId}
                data-sanidade={String(dados.sanidade)}
                data-ativo={ehAtivo ? 'true' : 'false'}
                data-em-baixa={dados.emBaixaIluminacao ? 'true' : undefined}
                data-amedrontado={dados.amedrontado ? 'true' : undefined}
                role="img"
                aria-label={`${dados.apelido}, Sanidade ${dados.sanidade} de 3${dados.emBaixaIluminacao ? ', em Baixa Iluminação' : ''}${dados.amedrontado ? ', Amedrontado' : ''}${ehAtivo ? ', com a vez' : ''}`}
                title={dados.apelido}
                className={`flex h-11 w-11 items-center justify-center rounded-full border-2 font-display text-sm font-semibold ${
                  ehAtivo ? 'border-amber-400' : 'border-amber-400/60'
                } ${dados.sanidade === 0 ? 'opacity-60' : ''}`}
                style={{ backgroundColor: '#1c1c1f', color: HEX_COR_PEAO[dados.cor] ?? '#fff' }}
              >
                {iniciaisDoApelido(dados.apelido)}
              </div>
              <div className="flex flex-col gap-0.5" aria-hidden="true">
                {dados.emBaixaIluminacao ? (
                  <span data-testid="hud-estado-baixa-iluminacao" title="Baixa Iluminação" className="rounded bg-zinc-900/80 px-1 text-[10px] text-amber-300">
                    ◐
                  </span>
                ) : null}
                {dados.amedrontado ? (
                  <span data-testid="hud-estado-amedrontado" title="Amedrontado" className="rounded bg-zinc-900/80 px-1 text-[10px] text-red-400">
                    ⚠
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── sup-centro: título ── */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2">
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
        className="absolute right-4 top-4 flex origin-top-right scale-90 items-center gap-3 rounded bg-zinc-900/80 px-3 py-1.5 lg:scale-100"
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
          className="pointer-events-auto absolute right-4 top-16 flex flex-col gap-2 rounded bg-zinc-900 px-4 py-3 text-sm text-zinc-100 shadow-xl"
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
      <div className="absolute bottom-4 left-4 flex origin-bottom-left scale-90 flex-col gap-2 lg:scale-100">
        <div data-testid="hud-jogador-local" data-jogador-id={local.jogadorId} className="flex items-center gap-3">
          <div
            role="img"
            aria-label={`Retrato de ${local.dados.apelido}`}
            className="flex h-16 w-16 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900/80 font-display text-xl font-semibold"
            style={{ color: HEX_COR_PEAO[local.dados.cor] ?? '#fff' }}
          >
            {iniciaisDoApelido(local.dados.apelido)}
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
            className={`${CLASSE_CARD} px-3 py-1.5 text-center text-xs ${
              local.dados.emBaixaIluminacao ? 'text-amber-300' : 'opacity-40'
            }`}
          >
            <span aria-hidden="true" className="block text-sm">◐</span>
            Baixa Iluminação
          </div>
          <div
            data-testid="hud-card-amedrontado"
            data-ativo={local.dados.amedrontado ? 'true' : 'false'}
            role="status"
            aria-label={local.dados.amedrontado ? 'Amedrontado ativo' : 'Amedrontado inativo'}
            className={`${CLASSE_CARD} px-3 py-1.5 text-center text-xs ${
              local.dados.amedrontado ? 'text-red-400' : 'opacity-40'
            }`}
          >
            <span aria-hidden="true" className="block text-sm">⚠</span>
            Amedrontado
          </div>
        </div>
      </div>

      {/* ── inf-centro: 4 conquistas redondas (3 Geradores + Cartão) ── */}
      <div
        data-testid="hud-conquistas"
        aria-label="Conquistas"
        className="absolute bottom-4 left-1/2 flex origin-bottom -translate-x-1/2 scale-90 items-center gap-3 lg:scale-100"
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

      {/* ── inf-dir: Turno (ativo em destaque + próximos na ordem) ── */}
      {turnoAtivo ? (
        <div
          data-testid="hud-turno"
          aria-label="Turno"
          className={`${CLASSE_CARD} absolute bottom-4 right-4 flex origin-bottom-right scale-90 flex-col gap-2 px-3 py-2 lg:scale-100`}
        >
          <span className="text-right text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
            Turno
          </span>
          <div className="flex items-center gap-1.5">
            <div
              data-testid="hud-turno-ativo"
              data-jogador-id={turnoAtivo.jogadorId}
              role="img"
              aria-label={`Vez de ${turnoAtivo.dados.apelido}`}
              title={turnoAtivo.dados.apelido}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-400 bg-zinc-800 font-display text-xs font-semibold"
              style={{ color: HEX_COR_PEAO[turnoAtivo.dados.cor] ?? '#fff' }}
            >
              {iniciaisDoApelido(turnoAtivo.dados.apelido)}
            </div>
            {proximosDoTurno.map(({ jogadorId, dados }) => (
              <div
                key={jogadorId}
                data-testid="hud-turno-proximo"
                data-jogador-id={jogadorId}
                role="img"
                aria-label={`Próximo: ${dados.apelido}`}
                title={dados.apelido}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 font-display text-[10px] opacity-60"
                style={{ color: HEX_COR_PEAO[dados.cor] ?? '#fff' }}
              >
                {iniciaisDoApelido(dados.apelido)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
