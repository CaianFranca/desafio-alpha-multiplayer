/**
 * Ciclo de vida da música de fundo da Partida (issue #403).
 *
 * Uma única instância de `Audio` (criada na montagem via `criarMusicaDeFundo`,
 * loop + volume do contrato ADR-0007): toca quando `emAndamento=true`, pausa
 * quando false, tenta o play já na montagem e de novo no primeiro gesto
 * (`pointerdown`/`keydown` — o autoplay pode bloquear a tentativa inicial; o
 * redirect Sala→Partida com reload invalida o gesto da Sala, por isso o
 * listener vive aqui). O listener de gesto é único e se remove após o
 * primeiro disparo (e na limpeza do efeito). No desmontar, remove listeners
 * pendentes e pausa — a música nunca vaza para fora da Partida.
 *
 * Independente por cliente/aba: cada montagem tem seu próprio `Audio`.
 * Falha de áudio nunca quebra: `tocar`/`parar` engolem erros.
 */

import { useEffect, useRef } from 'react'
import {
  criarMusicaDeFundo,
  pararMusicaDeFundo,
  tocarMusicaDeFundo,
} from './musicaDeFundo'

export function useMusicaDeFundo(emAndamento: boolean): void {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Instância única por montagem; no desmontar, pausa (nunca vaza).
  useEffect(() => {
    try {
      audioRef.current = criarMusicaDeFundo()
    } catch {
      audioRef.current = null
    }
    return () => {
      const audio = audioRef.current
      audioRef.current = null
      if (audio !== null) pararMusicaDeFundo(audio)
    }
  }, [])

  // Toca em andamento, pausa fora dele; retry único no primeiro gesto.
  useEffect(() => {
    const audio = audioRef.current
    if (audio === null) return
    if (!emAndamento) {
      pararMusicaDeFundo(audio)
      return
    }
    tocarMusicaDeFundo(audio)
    if (typeof window === 'undefined') return
    const tentarNoPrimeiroGesto = (): void => {
      window.removeEventListener('pointerdown', tentarNoPrimeiroGesto)
      window.removeEventListener('keydown', tentarNoPrimeiroGesto)
      tocarMusicaDeFundo(audio)
    }
    window.addEventListener('pointerdown', tentarNoPrimeiroGesto)
    window.addEventListener('keydown', tentarNoPrimeiroGesto)
    return () => {
      window.removeEventListener('pointerdown', tentarNoPrimeiroGesto)
      window.removeEventListener('keydown', tentarNoPrimeiroGesto)
    }
    // A instância é estável por montagem (vive no ref) — só `emAndamento`
    // re-dispara este efeito.
  }, [emAndamento])
}
