/**
 * Transição do ataque dos monstros (issue #385) — overlay DOM evento-driven.
 *
 * Espelha o padrão da `TransicaoLimpeza`/`TransicaoEncaixe`: só o trigger da
 * fila (`ataque` vindo do `useFilaDeAtaque`) renderiza; estado final
 * pixel-igual ao reducer (o overlay desmonta ao drenar — a peça do monstro
 * volta ao normal sem marcas acumuladas). `aria-hidden`: pura revelação
 * visual; o estado do jogo já foi aplicado na hora pelo reducer.
 *
 * Gesto de disparo (selo do monstro, `ataque-disparo`) precede a reação em
 * cadeia (`ataque-reacao` por peça do alcance): `pulo` (sem peão),
 * `tremor` (com peão, sem pular) e `escudo` (protegido — sem tremor). O
 * stagger da onda vive no `animationDelay` do item (`atrasoMs` do coreógrafo:
 * Vulto por camadas, Espectro junto). Com movimento reduzido, sem visual
 * (sons e bloqueio seguem — o lag é pacing do jogo).
 */

import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import type { AtaqueExibido } from './useFilaDeAtaque'
import type { ReacaoDePecaNoAtaque } from '../../game/tabuleiro/ataque'

const CLASSE_POR_REACAO: Record<ReacaoDePecaNoAtaque, string> = {
  pulo: 'animate-bounce border-amber-300/70 text-amber-200',
  tremor: 'ataque-tremor border-red-400/70 text-red-200',
  escudo: 'ataque-escudo border-sky-300/80 text-sky-100',
}

const ROTULO_POR_REACAO: Record<ReacaoDePecaNoAtaque, string> = {
  pulo: 'salto',
  tremor: 'tremor',
  escudo: 'escudo',
}

export function TransicaoAtaque({ ataque }: { ataque: AtaqueExibido | null }) {
  const reduce = usePrefersReducedMotion()
  if (ataque === null || reduce) return null
  const { item, key } = ataque
  const rotuloMonstro = item.tipo === 'vulto' ? 'Vulto' : 'Espectro'
  return (
    <div
      data-testid="ataque-coreografia"
      data-atacante={item.pecaId}
      data-tipo={item.tipo}
      data-key={key}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-24"
    >
      <div
        key={key}
        className="flex flex-col items-center gap-2 rounded-lg bg-black/60 px-4 py-2"
      >
        <div
          data-testid="ataque-disparo"
          data-peca-id={item.pecaId}
          data-tipo={item.tipo}
          className="animate-pulse text-sm font-semibold tracking-wide text-purple-200"
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
                style={{ animationDelay: `${reacao.atrasoMs}ms` }}
                className={`rounded border px-2 py-0.5 text-xs ${CLASSE_POR_REACAO[reacao.reacao]}`}
              >
                {ROTULO_POR_REACAO[reacao.reacao]}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
