/**
 * Transição do ataque dos monstros (issue #385) — overlay DOM evento-driven.
 *
 * Espelha o padrão da `TransicaoLimpeza`/`TransicaoEncaixe`: só o trigger da
 * fila (`ataque` vindo do `useFilaDeAtaque`) renderiza; estado final
 * pixel-igual ao reducer (o overlay desmonta ao drenar — a peça do monstro
 * volta ao normal sem marcas acumuladas). `aria-hidden`: pura revelação
 * visual; o estado do jogo já foi aplicado na hora pelo reducer.
 *
 * Etiqueta do estágio (`data-estagio`): `telegraph` (pulso silencioso de 1s,
 * só o selo "prepara ataque" — sem sons nem reações) precede o `ataque`
 * (gesto de disparo, `ataque-disparo`, + reação em cadeia `ataque-reacao`
 * por peça do alcance): `pulo` (sem peão), `tremor` (com peão, sem pular) e
 * `escudo` (protegido — sem tremor). Os chips seguem como legenda dos mesmos
 * dados que a cena 3D e o espelho DOM revelam (`data-reacao` na peça). O
 * stagger da onda vive no `animationDelay` do item (`atrasoMs` do coreógrafo:
 * Vulto por camadas, Espectro junto). Com movimento reduzido, legenda
 * estática (mesmos chips sem `animate-*` e sem `animationDelay`; sons e
 * bloqueio seguem — o lag é pacing do jogo).
 */

import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import type { AtaqueExibido } from './useFilaDeAtaque'
import type { ReacaoDePecaNoAtaque } from '../../game/tabuleiro/ataque'

const CLASSE_POR_REACAO: Record<ReacaoDePecaNoAtaque, string> = {
  pulo: 'animate-bounce border-amber-300/70 text-amber-200',
  tremor: 'ataque-tremor border-red-400/70 text-red-200',
  escudo: 'ataque-escudo border-sky-300/80 text-sky-100',
}

/**
 * Classes estáticas sob movimento reduzido (issue #385, follow-up): mesma
 * legenda, sem `animate-*` (sem quique/tremor/brilho) — borda e texto do
 * vocabulário de cada reação; o stagger (`animationDelay`) também sai.
 */
const CLASSE_ESTATICA_POR_REACAO: Record<ReacaoDePecaNoAtaque, string> = {
  pulo: 'border-amber-300/70 text-amber-200',
  tremor: 'border-red-400/70 text-red-200',
  escudo: 'border-sky-300/80 text-sky-100',
}

const ROTULO_POR_REACAO: Record<ReacaoDePecaNoAtaque, string> = {
  pulo: 'pulo',
  tremor: 'tremor',
  escudo: 'escudo',
}

export function TransicaoAtaque({ ataque }: { ataque: AtaqueExibido | null }) {
  const reduce = usePrefersReducedMotion()
  if (ataque === null) return null
  const { item, key, estagio } = ataque
  const rotuloMonstro = item.tipo === 'vulto' ? 'Vulto' : 'Espectro'
  // Movimento reduzido: legenda estática em vez de nada (sons e bloqueio
  // seguem — o lag é pacing do jogo): sem `animate-*` e sem `animationDelay`.
  const estatico = reduce
  return (
    <div
      data-testid="ataque-coreografia"
      data-atacante={item.pecaId}
      data-tipo={item.tipo}
      data-key={key}
      data-estagio={estagio}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-24"
    >
      <div
        key={key}
        className="flex flex-col items-center gap-2 rounded-lg bg-black/60 px-4 py-2"
      >
        {estagio === 'telegraph' ? (
          <div
            data-testid="ataque-telegraph"
            data-peca-id={item.pecaId}
            data-tipo={item.tipo}
            className={
              estatico
                ? 'text-sm font-semibold tracking-wide text-red-300'
                : 'animate-pulse text-sm font-semibold tracking-wide text-red-300'
            }
          >
            {`${rotuloMonstro} prepara ataque`}
          </div>
        ) : (
          <>
            <div
              data-testid="ataque-disparo"
              data-peca-id={item.pecaId}
              data-tipo={item.tipo}
              className={
                estatico
                  ? 'text-sm font-semibold tracking-wide text-purple-200'
                  : 'animate-pulse text-sm font-semibold tracking-wide text-purple-200'
              }
            >
              {`${rotuloMonstro} ataca`}
            </div>
            {item.reacoes.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-1">
                {item.reacoes.map((reacao) => (
                  <div
                    key={reacao.pecaId}
                    data-testid="ataque-reacao"
                    data-peca-id={reacao.pecaId}
                    data-reacao={reacao.reacao}
                    data-camada={reacao.camada}
                    style={estatico ? undefined : { animationDelay: `${reacao.atrasoMs}ms` }}
                    className={`rounded border px-2 py-0.5 text-xs ${estatico ? CLASSE_ESTATICA_POR_REACAO[reacao.reacao] : CLASSE_POR_REACAO[reacao.reacao]}`}
                  >
                    {ROTULO_POR_REACAO[reacao.reacao]}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
