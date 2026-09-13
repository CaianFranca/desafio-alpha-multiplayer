/**
 * Fila de animação do ataque dos monstros (issue #385).
 *
 * Evento-driven como a limpeza/encaixe: o `ATAQUE_RESOLVIDO` despacha o
 * estado na hora (reducer, na PartidaPage) e enfileira aqui só a revelação —
 * um item por atacante, na ordem de `atacantes`, drenando sequencialmente.
 * O monstro soa no gesto de disparo (sempre, mesmo sem vítimas); tremida e
 * defesa soam na chegada (`DURACAO_DISPARO_ATAQUE_MS`) só com alvo.
 *
 * Bloqueio da entrada do turno: `TURNO_INICIADO` com a fila ativa é segurado
 * e liberado ao drenar (lag deliberado ~1,3s/1,9s) — só a entrada do turno é
 * atingida; limpeza/encaixe/encerramento passam direto. Snapshot mais novo
 * invalida turnos segurados (a autoridade já projetou a vez — sem regressão).
 * A peça do monstro volta ao normal ao fim: o overlay desmonta sem marcas.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AtaqueResolvidoWireEvento, TurnoIniciadoEvento } from '@flicker/shared'
import {
  DURACAO_ATAQUE_POR_ATACANTE_MS,
  DURACAO_BASE_ATAQUE_MS,
  DURACAO_DISPARO_ATAQUE_MS,
} from '../../game/tabuleiro/animacao'
import {
  coreografarAtaque,
  type ContextoDaCoreografiaDoAtaque,
  type ItemCoreografadoDoAtaque,
} from '../../game/tabuleiro/ataque'
import { tocarDefesaDoAtaque, tocarSomDoMonstro, tocarTremidaDoAtaque } from './somDoAtaque'

export interface AtaqueExibido {
  readonly item: ItemCoreografadoDoAtaque
  readonly key: number
}

interface TurnoSegurado {
  readonly evento: TurnoIniciadoEvento
  readonly seqSnapshot: number
}

export function useFilaDeAtaque(
  liberarTurnoSegurado: (evento: TurnoIniciadoEvento) => void,
): {
  readonly ataqueExibido: AtaqueExibido | null
  readonly enfileirarAtaque: (
    evento: AtaqueResolvidoWireEvento,
    contexto: ContextoDaCoreografiaDoAtaque,
  ) => void
  readonly segurarTurnoSeEmAtaque: (evento: TurnoIniciadoEvento) => boolean
  readonly notificarSnapshot: () => void
  readonly cancelarAtaque: () => void
} {
  const [ataqueExibido, setAtaqueExibido] = useState<AtaqueExibido | null>(null)
  const filaRef = useRef<ItemCoreografadoDoAtaque[]>([])
  const emAndamentoRef = useRef(false)
  const timersRef = useRef<number[]>([])
  const turnosSeguradosRef = useRef<TurnoSegurado[]>([])
  const seqSnapshotRef = useRef(0)
  const keyRef = useRef(0)
  // Recursão do driver via ref (mesmo padrão de `desconectarRef` na
  // PartidaPage): o timer sempre chama a versão mais recente, sem
  // recriar callbacks nem re-subscrever o socket.
  const exibirProximoRef = useRef<(primeiro: boolean) => void>(() => undefined)
  // `liberarTurnoSegurado` troca por render sem recriar o driver: ref estável.
  const liberarRef = useRef(liberarTurnoSegurado)
  useEffect(() => {
    liberarRef.current = liberarTurnoSegurado
  }, [liberarTurnoSegurado])
  // Unmount limpa os timers (sem vazamento entre testes/páginas).
  useEffect(
    () => () => {
      for (const id of timersRef.current) window.clearTimeout(id)
      timersRef.current = []
    },
    [],
  )

  const agendar = useCallback((ms: number, fn: () => void): void => {
    const id = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id)
      fn()
    }, ms)
    timersRef.current.push(id)
  }, [])

  const exibirProximo = useCallback(
    (primeiro: boolean): void => {
      const atual = filaRef.current.shift()
      if (atual === undefined) {
        emAndamentoRef.current = false
        setAtaqueExibido(null)
        // Drenou: libera a entrada do turno segurada, na ordem de chegada.
        // Snapshot mais novo já projetou a vez — o segurado vira no-op.
        const segurados = turnosSeguradosRef.current
        turnosSeguradosRef.current = []
        for (const segurado of segurados) {
          if (segurado.seqSnapshot !== seqSnapshotRef.current) continue
          liberarRef.current(segurado.evento)
        }
        return
      }
      keyRef.current += 1
      setAtaqueExibido({ item: atual, key: keyRef.current })
      // Gesto de disparo soa na hora — sempre, mesmo sem vítimas (só monstro).
      tocarSomDoMonstro(atual.tipo)
      // Feedback no alvo no instante da chegada: tremida só com atingido,
      // defesa só com protegido.
      agendar(DURACAO_DISPARO_ATAQUE_MS, () => {
        if (atual.temAtingido) tocarTremidaDoAtaque()
        if (atual.temProtegido) tocarDefesaDoAtaque()
      })
      // Primeiro item carrega a base (~1,3s com 1 monstro, ~1,9s com 2).
      agendar(
        primeiro
          ? DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS
          : DURACAO_ATAQUE_POR_ATACANTE_MS,
        () => exibirProximoRef.current(false),
      )
    },
    [agendar],
  )
  useEffect(() => {
    exibirProximoRef.current = exibirProximo
  }, [exibirProximo])

  const enfileirarAtaque = useCallback(
    (evento: AtaqueResolvidoWireEvento, contexto: ContextoDaCoreografiaDoAtaque): void => {
      const itens = coreografarAtaque(evento, contexto)
      if (itens.length === 0) return
      const ocioso = !emAndamentoRef.current
      filaRef.current.push(...itens)
      if (ocioso) {
        emAndamentoRef.current = true
        exibirProximo(true)
      }
    },
    [exibirProximo],
  )

  const segurarTurnoSeEmAtaque = useCallback((evento: TurnoIniciadoEvento): boolean => {
    if (!emAndamentoRef.current) return false
    turnosSeguradosRef.current.push({ evento, seqSnapshot: seqSnapshotRef.current })
    return true
  }, [])

  const notificarSnapshot = useCallback((): void => {
    seqSnapshotRef.current += 1
  }, [])

  const cancelarAtaque = useCallback((): void => {
    for (const id of timersRef.current) window.clearTimeout(id)
    timersRef.current = []
    filaRef.current = []
    turnosSeguradosRef.current = []
    emAndamentoRef.current = false
    setAtaqueExibido(null)
  }, [])

  return { ataqueExibido, enfileirarAtaque, segurarTurnoSeEmAtaque, notificarSnapshot, cancelarAtaque }
}
