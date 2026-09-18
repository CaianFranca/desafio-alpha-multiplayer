/**
 * Modal de volume da Partida (issue #438, spec-mãe #435).
 *
 * Abre pelo botão de som do HUD (`hud-volume`): diálogo central com 3
 * sliders — música de fundo, efeitos default e efeitos de monstro — cada um
 * sobre sua camada (`volumesDasCamadas.ts`, persistida no navegador).
 * Fecha por X, clique no backdrop ou ESC. Sem botão de configuração.
 *
 * Padrão de modal do repo: `role="dialog"` + `aria-modal="true"`, fundo
 * `fixed inset-0 z-50 bg-black/70`, responsivo ao modo compacto (largura
 * fluida com margem — 800x360 mantém os 3 sliders operáveis).
 */

import { useEffect } from 'react'
import {
  MUSICA_DE_FUNDO_DISPONIVEL,
  useVolumeDaCamada,
} from './volumesDasCamadas'

export interface ModalDeVolumeProps {
  /** Fecha o modal (X, backdrop ou ESC). */
  aoFechar: () => void
}

function ControleDeCamada({
  testid,
  rotulo,
  descricao,
  valor,
  aoMudar,
  desabilitado = false,
  dicaDesabilitado = null,
}: {
  testid: string
  rotulo: string
  descricao: string
  valor: number
  aoMudar: (valor: number) => void
  desabilitado?: boolean
  dicaDesabilitado?: string | null
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[length:var(--hud-rotulo,0.75rem)] font-semibold uppercase leading-4 tracking-[0.14em] text-zinc-100">
          {rotulo}
        </span>
        <span aria-hidden="true" className="text-xs tabular-nums text-zinc-400">
          {Math.round(valor * 100)}%
        </span>
      </span>
      <input
        type="range"
        data-testid={testid}
        aria-label={rotulo}
        aria-describedby={`${testid}-descricao`}
        min={0}
        max={1}
        step={0.01}
        value={valor}
        disabled={desabilitado}
        onChange={(evento) => aoMudar(Number(evento.target.value))}
        className="pointer-events-auto w-full accent-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
      />
      <span id={`${testid}-descricao`} className="text-xs leading-4 text-zinc-400">
        {desabilitado && dicaDesabilitado !== null ? dicaDesabilitado : descricao}
      </span>
    </label>
  )
}

export function ModalDeVolume({ aoFechar }: ModalDeVolumeProps) {
  const [musica, definirMusica] = useVolumeDaCamada('musica')
  const [efeitos, definirEfeitos] = useVolumeDaCamada('efeitos')
  const [monstros, definirMonstros] = useVolumeDaCamada('monstros')

  // Fecha por ESC (keydown com cleanup — sem listener vazando após fechar).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') aoFechar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aoFechar])

  return (
    <div
      data-testid="volume-backdrop"
      onClick={aoFechar}
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        data-testid="volume-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Volume da Partida"
        onClick={(evento) => evento.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded bg-zinc-900 px-5 py-4 shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.28em] text-zinc-100">
            Volume
          </h2>
          <button
            type="button"
            data-testid="volume-fechar"
            aria-label="Fechar volume"
            autoFocus
            onClick={aoFechar}
            className="pointer-events-auto min-h-[44px] min-w-[44px] rounded border border-zinc-600 px-3 py-1 text-sm leading-5 text-zinc-200 hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            X
          </button>
        </div>
        <ControleDeCamada
          testid="volume-slider-musica"
          rotulo="Música"
          descricao="Música de fundo da Partida."
          valor={musica}
          aoMudar={definirMusica}
          desabilitado={!MUSICA_DE_FUNDO_DISPONIVEL}
          dicaDesabilitado="Música indisponível — a faixa ainda não foi publicada."
        />
        <ControleDeCamada
          testid="volume-slider-efeitos"
          rotulo="Efeitos"
          descricao="Recusa, encaixe, conquistas, peão, limpeza e chat."
          valor={efeitos}
          aoMudar={definirEfeitos}
        />
        <ControleDeCamada
          testid="volume-slider-monstros"
          rotulo="Monstros"
          descricao="Uivo, trovão, tremor e defesa dos ataques."
          valor={monstros}
          aoMudar={definirMonstros}
        />
      </div>
    </div>
  )
}
