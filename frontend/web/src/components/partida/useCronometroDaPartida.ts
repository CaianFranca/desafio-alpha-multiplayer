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

/**
 * Segundos restantes até o deadline absoluto (issue #430): teto da fração
 * (o display só zera quando o marco passa de fato) com piso em 0 (deadline
 * estourado mostra 00:00 até o servidor encerrar a vez). Deadline ausente,
 * não finito ou não positivo = 0 (sem origem inventada — o chamador esconde
 * o indicador nesses casos).
 */
export function segundosRestantesPara(
  deadlineDoTurnoEm: number | null | undefined,
  agora: number = agoraAtual(),
): number {
  if (
    deadlineDoTurnoEm === null ||
    deadlineDoTurnoEm === undefined ||
    !Number.isFinite(deadlineDoTurnoEm) ||
    deadlineDoTurnoEm <= 0
  ) {
    return 0
  }
  return Math.max(0, Math.ceil((deadlineDoTurnoEm - agora) / 1000))
}

interface ContagemRegressivaDoTurnoOptions {
  /** A partida está em andamento (a contagem corre). */
  emAndamento: boolean
  /** A partida terminou (o indicador some — sem vez após o término). */
  emResultado: boolean
  /**
   * Deadline absoluto do turno vigente (epoch ms, autoridade do
   * game-server, issue #430), vindo do TURNO_INICIADO / aviso final / snapshot.
   * `null`/ausente = sem relógio (pausa, Amedrontado, entre turnos).
   */
  deadlineDoTurnoEm?: number | null
}

/**
 * Contagem regressiva do turno (issue #430): deriva do deadline absoluto do
 * servidor, recomputada a cada segundo de `Date.now()`. Como todos os
 * Jogadores partilham o mesmo deadline, o HUD mostra o mesmo MM:SS sem
 * eventos por segundo do servidor; reload/re-admissão reconciliam pelo
 * snapshot (sem reiniciar, sem re-tocar bipes — a unicidade do som é do
 * evento TURNO_AVISO_30S, não daqui). Somente leitura de tela.
 */
export function useContagemRegressivaDoTurno({
  emAndamento,
  emResultado,
  deadlineDoTurnoEm = null,
}: ContagemRegressivaDoTurnoOptions): {
  texto: string
  restantes: number
} {
  const contando = emAndamento && !emResultado
  // Mesma assinatura de relógio do cronômetro crescente: refresh imediato na
  // entrada (deadline pode chegar depois do mount) + intervalo de 1s.
  const [agora, setAgora] = useState(agoraAtual)

  useEffect(() => {
    if (!contando) return
    const refreshId = window.setTimeout(() => {
      setAgora(agoraAtual())
    }, 0)
    const id = window.setInterval(() => {
      setAgora(agoraAtual())
    }, 1000)
    return () => {
      window.clearTimeout(refreshId)
      window.clearInterval(id)
    }
  }, [contando, deadlineDoTurnoEm])

  const restantes = segundosRestantesPara(deadlineDoTurnoEm, agora)

  return { texto: formatarCronometroDaPartida(restantes), restantes }
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

/** Leitura do relógio de parede fora do render (mantém o render puro). */
function agoraAtual(): number {
  return Date.now()
}

/**
 * Segundos corridos desde o marco do servidor. Defensivo: marco ausente,
 * não finito ou não positivo devolve 0 (sem origem inventada); epoch no
 * futuro é clampado em 0 (skew negativo).
 */
function segundosDesde(iniciadaEm: number | null | undefined, agora: number = agoraAtual()): number {
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
  const contando = emAndamento && !emResultado
  // Leitura do relógio atualizada a cada tick; a última leitura ativa é
  // mantida quando a contagem para (congelamento no resultado).
  const [agora, setAgora] = useState(agoraAtual)

  useEffect(() => {
    if (!contando) return
    // Refresh imediato (review PR #374): `iniciadaEm` pode chegar depois do
    // mount (broadcast PARTIDA_INICIADA), e o `agora` capturado no mount fica
    // stale até o próximo tick. O timeout 0 sincroniza o relógio na entrada
    // do efeito sem setState síncrono no corpo (react-hooks/set-state-in-
    // effect); o intervalo mantém a assinatura de relógio a cada segundo.
    const refreshId = window.setTimeout(() => {
      setAgora(agoraAtual())
    }, 0)
    const id = window.setInterval(() => {
      setAgora(agoraAtual())
    }, 1000)
    return () => {
      window.clearTimeout(refreshId)
      window.clearInterval(id)
    }
  }, [contando, iniciadaEm])

  const segundos = segundosDesde(iniciadaEm, agora)

  return { texto: formatarCronometroDaPartida(segundos), segundos }
}
