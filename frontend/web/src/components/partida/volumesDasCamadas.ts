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
 * Música habilitada (issue #403 CLOSED, `musica-de-fundo.mp3` em
 * `frontend/web/media/`): `MUSICA_DE_FUNDO_DISPONIVEL = true` deixa o slider
 * operável; o player lê `obterVolumeDeMusica()` sem recostura dos pontos
 * de som.
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

/** Evento intra-aba para mudanças de camada (storage só dispara cross-tab). */
export const EVENTO_VOLUME_CAMADA = 'flicker:volume-change'

/**
 * Música de fundo disponível? Verdadeiro desde a #403 (asset
 * `musica-de-fundo.mp3` + player já na main). O modal habilita o slider
 * de música; o player lê `obterVolumeDeMusica()`.
 */
export const MUSICA_DE_FUNDO_DISPONIVEL = true

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
 * silencioso. Retorna o valor efetivamente gravado (preso). Dispara
 * `EVENTO_VOLUME_CAMADA` para atualizar áudio já em loop na mesma aba
 * (storage só dispara cross-tab).
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
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(EVENTO_VOLUME_CAMADA, { detail: { camada, valor: preso } }))
    }
  } catch {
    // Evento intra-aba opcional — nunca quebra.
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
 * Sincroniza entre abas via `storage` e intra-aba via `EVENTO_VOLUME_CAMADA`.
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
    const aoMudarLocal = (evento: Event): void => {
      const detalhe = (evento as CustomEvent<{ camada: CamadaDeVolume; valor: number }>).detail
      if (detalhe !== undefined && detalhe.camada !== camada) return
      setVolume(obterVolumeDaCamada(camada))
    }
    window.addEventListener('storage', aoMudarStorage)
    window.addEventListener(EVENTO_VOLUME_CAMADA, aoMudarLocal)
    return () => {
      window.removeEventListener('storage', aoMudarStorage)
      window.removeEventListener(EVENTO_VOLUME_CAMADA, aoMudarLocal)
    }
  }, [camada])

  const definir = useCallback(
    (valor: number) => {
      setVolume(definirVolumeDaCamada(camada, valor))
    },
    [camada],
  )

  return [volume, definir] as const
}
