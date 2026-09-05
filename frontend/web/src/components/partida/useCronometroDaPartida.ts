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
  /**
   * Identificador da Partida para persistir o início em `sessionStorage`
   * (paliativo: sair e voltar na mesma aba retoma em vez de zerar).
   * Ausente/null mantém o comportamento legado zerado.
   */
  partidaId?: string | null
}

function chaveDoInicio(partidaId: string): string {
  return `hud-cronometro-inicio:${partidaId}`
}

function lerInicio(chave: string): number | null {
  try {
    const bruto = window.sessionStorage.getItem(chave)
    if (bruto === null) return null
    const valor = Number(bruto)
    return Number.isFinite(valor) && valor > 0 ? valor : null
  } catch {
    return null
  }
}

function segundosDesde(inicio: number, agora: number = Date.now()): number {
  return Math.max(0, Math.floor((agora - inicio) / 1000))
}

function segundosIniciais(partidaId: string | null | undefined): number {
  if (partidaId === null || partidaId === undefined || partidaId === '') return 0
  if (typeof window === 'undefined') return 0
  const inicio = lerInicio(chaveDoInicio(partidaId))
  return inicio === null ? 0 : segundosDesde(inicio)
}

/**
 * Cronômetro local da Partida (issue #226): conta segundos a partir da
 * entrada em andamento e congela no resultado. Somente leitura de tela —
 * não deriva do servidor nem afeta regras.
 */
export function useCronometroDaPartida({ emAndamento, emResultado, partidaId = null }: CronometroDaPartidaOptions): {
  texto: string
  segundos: number
} {
  // Remount da mesma partida retoma do marco persistido (sem setState em
  // efeito: o inicializador lê o `sessionStorage` de forma síncrona).
  const [segundos, setSegundos] = useState(() => segundosIniciais(partidaId))
  const contando = emAndamento && !emResultado

  useEffect(() => {
    // Resultado congela e dispensa o marco: sem intervalo e sem chave órfã.
    if (emResultado && partidaId !== null && partidaId !== undefined && partidaId !== '') {
      try {
        window.sessionStorage.removeItem(chaveDoInicio(partidaId))
      } catch {
        // Sem persistência: nada a limpar.
      }
      return
    }
    if (!contando) return
    if (partidaId === null || partidaId === undefined || partidaId === '') {
      const id = window.setInterval(() => {
        setSegundos((atual) => atual + 1)
      }, 1000)
      return () => {
        window.clearInterval(id)
      }
    }
    const chave = chaveDoInicio(partidaId)
    if (lerInicio(chave) === null) {
      try {
        window.sessionStorage.setItem(chave, String(Date.now()))
      } catch {
        // Sem persistência: o intervalo abaixo conta de forma incremental.
      }
    }
    const id = window.setInterval(() => {
      const marco = lerInicio(chave)
      if (marco === null) {
        setSegundos((atual) => atual + 1)
        return
      }
      setSegundos(segundosDesde(marco))
    }, 1000)
    return () => {
      window.clearInterval(id)
    }
  }, [contando, partidaId, emResultado])

  return { texto: formatarCronometroDaPartida(segundos), segundos }
}
