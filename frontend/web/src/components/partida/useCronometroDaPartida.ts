import { useEffect, useState } from 'react'

/**
 * Formata segundos corridos como MM:SS; a partir de 1h usa H:MM:SS (hora sem
 * zero à esquerda) — cronômetro do HUD, issues #226/#259.
 */
export function formatarCronometroDaPartida(totalSegundos: number): string {
  const horas = Math.floor(totalSegundos / 3600)
  const minutos = Math.floor((totalSegundos % 3600) / 60)
  const segundos = totalSegundos % 60
  const mmss = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`
  return horas > 0 ? `${horas}:${mmss}` : mmss
}

interface CronometroDaPartidaOptions {
  /** A partida entrou em andamento (inicia a contagem). */
  emAndamento: boolean
  /** A partida terminou (congela a contagem no valor corrente). */
  emResultado: boolean
  /**
   * Marco autoritativo do início da Partida (epoch ms, issue #259), vindo do
   * snapshot ou de `PARTIDA_INICIADA`. `null`/ausente mantém o cronômetro em
   * `00:00` (partida ainda sem marco) — nunca conta a partir do mount local.
   */
  iniciadaEm?: number | null
}

/**
 * Segundos corridos desde o marco do servidor. Defensivo: marco ausente,
 * não finito ou não positivo devolve 0 (sem origem inventada); epoch no
 * futuro é clampado em 0 (skew negativo).
 */
function segundosDesde(iniciadaEm: number | null | undefined, agora: number = Date.now()): number {
  if (
    iniciadaEm === null ||
    iniciadaEm === undefined ||
    !Number.isFinite(iniciadaEm) ||
    iniciadaEm <= 0
  ) {
    return 0
  }
  return Math.max(0, Math.floor((agora - iniciadaEm) / 1000))
}

/**
 * Cronômetro da Partida (issue #259): deriva do marco autoritativo do
 * servidor, recomputado a cada segundo de `Date.now()`, e congela no
 * resultado. Como todos os Jogadores partilham o mesmo `iniciadaEm`, o HUD
 * mostra o mesmo MM:SS (ou H:MM:SS a partir de 1h) e a retomada (sair/voltar,
 * recarregar) não reinicia.
 * Somente leitura de tela — o marco não afeta regras.
 */
export function useCronometroDaPartida({
  emAndamento,
  emResultado,
  iniciadaEm = null,
}: CronometroDaPartidaOptions): {
  texto: string
  segundos: number
} {
  // Estado inicial síncrono do marco: já no primeiro render mostra o tempo
  // decorrido (sem flash de 00:00 e sem depender de efeito).
  const [segundos, setSegundos] = useState(() => segundosDesde(iniciadaEm))
  const contando = emAndamento && !emResultado

  useEffect(() => {
    // Resultado congela: recomputa uma última vez do marco e para — sem timer.
    if (emResultado) {
      setSegundos(segundosDesde(iniciadaEm))
      return
    }
    if (!contando) return
    // Recomputa imediatamente (o marco pode chegar depois do mount) e a cada
    // segundo; sempre de `Date.now()` — nunca incremento local acumulado.
    setSegundos(segundosDesde(iniciadaEm))
    const id = window.setInterval(() => {
      setSegundos(segundosDesde(iniciadaEm))
    }, 1000)
    return () => {
      window.clearInterval(id)
    }
  }, [contando, iniciadaEm, emResultado])

  return { texto: formatarCronometroDaPartida(segundos), segundos }
}
