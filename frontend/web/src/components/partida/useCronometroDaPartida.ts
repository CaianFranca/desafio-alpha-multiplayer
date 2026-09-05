import { useEffect, useState } from 'react'

/** Formata segundos corridos como MM:SS (cronômetro local do HUD, issue #226). */
export function formatarCronometroDaPartida(totalSegundos: number): string {
  const minutos = Math.floor(totalSegundos / 60)
  const segundos = totalSegundos % 60
  return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`
}

interface CronometroDaPartidaOptions {
  /** A partida entrou em andamento (inicia a contagem). */
  emAndamento: boolean
  /** A partida terminou (congela a contagem no valor atual). */
  emResultado: boolean
}

/**
 * Cronômetro local da Partida (issue #226): conta segundos a partir da
 * entrada em andamento e congela no resultado. Somente leitura de tela —
 * não deriva do servidor nem afeta regras.
 */
export function useCronometroDaPartida({ emAndamento, emResultado }: CronometroDaPartidaOptions): {
  texto: string
  segundos: number
} {
  const [segundos, setSegundos] = useState(0)
  const contando = emAndamento && !emResultado

  useEffect(() => {
    if (!contando) return
    const id = window.setInterval(() => {
      setSegundos((atual) => atual + 1)
    }, 1000)
    return () => {
      window.clearInterval(id)
    }
  }, [contando])

  return { texto: formatarCronometroDaPartida(segundos), segundos }
}
