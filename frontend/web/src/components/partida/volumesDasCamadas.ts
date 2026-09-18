/**
 * Camadas de volume da Partida (issue #438, spec-mãe #435).
 *
 * Três camadas independentes — música de fundo, efeitos default e efeitos de
 * monstro — cada uma em [0, 1] (padrão 1; zero silencia a camada), persistidas
 * no navegador em chaves globais `flicker:volume:*` (não por partida).
 * Leitura/escrita defensivas com `try/catch`: armazenamento indisponível
 * (SSR, modo privado) degrada para o padrão sem quebrar a Partida.
 *
 * Contrato de volume (ADR-0007, estendido): cada ponto de som aplica
 * `audio.volume = camada × VOLUME_BASE_*`, lendo a camada NO MOMENTO do
 * toque (nunca cacheada no import) — o slider do modal vale de imediato.
 * `VOLUME_MASTER_PARTIDA` (const 1) é legado removido: os mestres agora são
 * estas três camadas.
 *
 * Música desabilitada (issue #403 OPEN, sem `musica-de-fundo.mp3` na main):
 * `MUSICA_DE_FUNDO_DISPONIVEL = false` mantém o slider visível mas disabled
 * com hint; o valor persiste mesmo disabled. Quando a #403 pousar (asset +
 * player), esta constante vira `true` e o player lê `obterVolumeDeMusica()`
 * sem recostura dos pontos de som.
 */

import { useCallback, useEffect, useState } from 'react'

/** Camada de volume: música de fundo, efeitos default ou efeitos de monstro. */
export type CamadaDeVolume = 'musica' | 'efeitos' | 'monstros'

/** Chaves globais de persistência (não por partida — decisão aprovada). */
export const CHAVE_VOLUME_POR_CAMADA: Record<CamadaDeVolume, string> = {
  musica: 'flicker:volume:musica',
  efeitos: 'flicker:volume:efeitos',
  monstros: 'flicker:volume:monstros',
}

/** Camada padrão: cheia (1). Ausência/valor inválido no storage volta aqui. */
export const VOLUME_PADRAO_DA_CAMADA = 1

/**
 * Música de fundo disponível? Falso até a #403 pousar (asset
 * `musica-de-fundo.mp3` + player). Seam único: o modal desabilita o slider
 * de música enquanto falso; o player futuro lê `obterVolumeDeMusica()`.
 */
export const MUSICA_DE_FUNDO_DISPONIVEL = false

/** Prende o volume em [0, 1]; NaN/não-numérico volta ao padrão. */
export function prenderVolumeDaCamada(valor: number): number {
  if (typeof valor !== 'number' || Number.isNaN(valor)) return VOLUME_PADRAO_DA_CAMADA
  return Math.min(1, Math.max(0, valor))
}

/**
 * Lê a camada do `localStorage` (puro onde dá: só efeito colateral de
 * leitura defensiva). Sem chave/valor inválido/storage indisponível → 1.
 */
export function obterVolumeDaCamada(camada: CamadaDeVolume): number {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return VOLUME_PADRAO_DA_CAMADA
    }
    const bruto = window.localStorage.getItem(CHAVE_VOLUME_POR_CAMADA[camada])
    if (bruto === null) return VOLUME_PADRAO_DA_CAMADA
    const numero = Number(bruto)
    if (Number.isNaN(numero)) return VOLUME_PADRAO_DA_CAMADA
    return prenderVolumeDaCamada(numero)
  } catch {
    return VOLUME_PADRAO_DA_CAMADA
  }
}

/**
 * Persiste a camada (prendendo em [0, 1]). Falha de escrita = no-op
 * silencioso. Retorna o valor efetivamente gravado (preso).
 */
export function definirVolumeDaCamada(camada: CamadaDeVolume, valor: number): number {
  const preso = prenderVolumeDaCamada(valor)
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      window.localStorage.setItem(CHAVE_VOLUME_POR_CAMADA[camada], String(preso))
    }
  } catch {
    // Sem persistência desta vez; o valor em memória do hook segue valendo.
  }
  return preso
}

/** Atalhos de leitura por camada (o ponto de som chama no momento do toque). */
export function obterVolumeDeMusica(): number {
  return obterVolumeDaCamada('musica')
}

/** Atalho de leitura da camada de efeitos default (momento do toque). */
export function obterVolumeDeEfeitos(): number {
  return obterVolumeDaCamada('efeitos')
}

/** Atalho de leitura da camada de monstros (momento do toque). */
export function obterVolumeDeMonstros(): number {
  return obterVolumeDaCamada('monstros')
}

/**
 * Hook do slider do modal: estado vivo da camada + escrita persistente.
 * Sincroniza entre abas via evento `storage` (mesma chave, outro documento).
 */
export function useVolumeDaCamada(camada: CamadaDeVolume): readonly [number, (valor: number) => void] {
  // A camada é fixa por instância de slider e o modal remonta a cada
  // abertura: o inicializador lê o storage uma vez, sem efeito de sync.
  const [volume, setVolume] = useState<number>(() => obterVolumeDaCamada(camada))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const chave = CHAVE_VOLUME_POR_CAMADA[camada]
    const aoMudarStorage = (evento: StorageEvent): void => {
      if (evento.key !== null && evento.key !== chave) return
      setVolume(obterVolumeDaCamada(camada))
    }
    window.addEventListener('storage', aoMudarStorage)
    return () => window.removeEventListener('storage', aoMudarStorage)
  }, [camada])

  const definir = useCallback(
    (valor: number) => {
      setVolume(definirVolumeDaCamada(camada, valor))
    },
    [camada],
  )

  return [volume, definir] as const
}
