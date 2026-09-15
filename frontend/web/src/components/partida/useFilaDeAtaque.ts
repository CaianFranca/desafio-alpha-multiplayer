/**
 * Fila de animação do ataque dos monstros (issue #385 — fila sequencial na
 * ordem de atacantes do wire).
 *
 * Evento-driven como a limpeza/encaixe: o `ATAQUE_RESOLVIDO` NÃO despacha o
 * estado na hora — a PartidaPage entrega evento+contexto aqui e o driver
 * aplica cada fatia (`reduzirFatiaDoAtaque`, via `aplicarFatiaDoAtaque`) no
 * instante da chegada do próprio slot (`DURACAO_DISPARO_ATAQUE_MS` após o
 * disparo), com guarda de snapshot-seq (pula se `seqSnapshot` mudou — mesmo
 * padrão dos turnos segurados). Sem vítimas/protegidos na fatia, nada a
 * aplicar. Cada slot resolve por completo (animação, som, consequências) na
 * ordem do wire e só após seu fim o próximo entra em telegraph — com mais de
 * um atacante a virada de turno espera a fila drenar.
 *
 * Cada item abre com o telegraph silencioso de 1s (contorno vermelho pulsante
 * na peça do monstro, sem som nem consequência) e só depois o monstro soa no
 * gesto de disparo (sempre, mesmo sem vítimas); tremor e defesa soam na
 * chegada (`DURACAO_DISPARO_ATAQUE_MS`) só com alvo do próprio alcance; o
 * anúncio ao leitor (`ataque_com_penalidade`) sai na chegada somente se a
 * fatia tem vítimas — sem vítimas, silêncio.
 *
 * Cegueira e sumiço antes da vez (follow-up + review PR #399): o lote real
 * do engine chega Iluminação → Limpeza → Ataque — ou seja, a limpeza do
 * mesmo gatilho chega ANTES de a fila existir. Por isso `POSICAO_CONFIRMADA`
 * abre uma "janela de gatilho" (marcador explícito — `queueMicrotask` não
 * atravessa mensagens WS, cada `onmessage` é um macrotask próprio):
 * `CELULAS_ILUMINADAS`/`LIMPEZA_APLICADA` seguintes vão ao buffer da janela
 * (sem som/trigger); se `ATAQUE_RESOLVIDO` chegar antes do fechamento, o
 * buffer entra na fila (libera na chegada do Vulto, ou ao drenar sem Vulto);
 * senão, libera em ordem no fechamento — auto-fecho de
 * `DURACAO_JANELA_GATILHO_MS` sem ataque (o lote aplica ao confirmar) ou a
 * virada de turno — compondo com fila ativa de ataque anterior. Com a fila ativa (segunda onda
 * pós-Baixa, virada), o seguro direto abaixo segue valendo, na ordem de
 * chegada. Snapshot (`ESTADO_DA_PARTIDA`) e `PARTIDA_TERMINADA` aplicam na
 * hora pela PartidaPage e cancelam a fila + descartam janela e segurados
 * (snapshot é autoridade).
 *
 * Bloqueio da entrada do turno: `TURNO_INICIADO` e `TURNO_ENCERRADO` com a
 * fila ativa são segurados e liberados ao drenar, na ordem de chegada (lag
 * deliberado por decisão do usuário de ~2,3s/3,9s, telegraph incluso — pacing
 * do jogo) — só a virada de turno é atingida; fora da fila, tudo passa direto.
 * Snapshot mais novo invalida turnos segurados (a autoridade já projetou a
 * vez — sem regressão); o unmount descarta fila e segurados explicitamente
 * (o snapshot reconcilia ao remontar). A peça do monstro volta ao normal ao
 * fim de cada slot e ao drenar: o overlay desmonta sem marcas.
 *
 * Ataque tardio (edge documentado, sem re-seguro): o `ATAQUE_RESOLVIDO` que
 * chega com o turno já iniciado anima sobre o turno vivo — os segurados só
 * valem para a virada que chega com a fila ativa; re-segurar o turno em
 * curso mentiria sobre o estado (a vez projetada já é a autoridade).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AtaqueResolvidoWireEvento,
  Celula,
  CelulasIluminadasWireEvento,
  LimpezaAplicadaWireEvento,
  TurnoEncerradoEvento,
  TurnoIniciadoEvento,
} from '@flicker/shared'
import {
  DURACAO_ATAQUE_POR_ATACANTE_MS,
  DURACAO_BASE_ATAQUE_MS,
  DURACAO_DISPARO_ATAQUE_MS,
  DURACAO_JANELA_GATILHO_MS,
  DURACAO_TELEGRAPH_ATAQUE_MS,
} from '../../game/tabuleiro/animacao'
import {
  coreografarAtaque,
  type ContextoDaCoreografiaDoAtaque,
  type FatiaDoAtaque,
  type ItemCoreografadoDoAtaque,
} from '../../game/tabuleiro/ataque'
import { tocarDefesaDoAtaque, tocarSomDoMonstro, tocarTremorDoAtaque } from './somDoAtaque'
import type { MotivoDeRecusa } from './somDeRecusa'

/** Estágio do item corrente: telegraph silencioso ou disparo com consequência. */
export type EstagioDoAtaqueExibido = 'telegraph' | 'ataque'

export interface AtaqueExibido {
  readonly item: ItemCoreografadoDoAtaque
  readonly key: number
  readonly estagio: EstagioDoAtaqueExibido
}

interface TurnoSegurado {
  readonly evento: TurnoIniciadoEvento | TurnoEncerradoEvento
  readonly seqSnapshot: number
}

/** Iluminação/limpeza chegada com a fila ativa, à espera da chegada do Vulto. */
interface LimpezaSegurada {
  readonly evento: CelulasIluminadasWireEvento | LimpezaAplicadaWireEvento
  readonly seqSnapshot: number
  /**
   * Fotografia pecaId→célula no instante do seguro (modelo pré-despacho): a
   * limpeza pode aplicar antes de o ataque chegar (auto-fecho da janela) —
   * a onda do coreógrafo usa para varrer as removidas (só lacunas).
   */
  readonly celulas: ReadonlyMap<string, Celula>
}

interface ItemNaFila {
  readonly item: ItemCoreografadoDoAtaque
  readonly seqSnapshot: number
}

export interface OpcoesDaFilaDeAtaque {
  readonly liberarTurnoSegurado: (evento: TurnoIniciadoEvento | TurnoEncerradoEvento) => void
  /** Aplica a fatia do slot no modelo (PartidaPage despacha `FATIA_DE_ATAQUE`). */
  readonly aplicarFatiaDoAtaque: (fatia: FatiaDoAtaque) => void
  /** Anúncio ao leitor no slot (só com vítimas na fatia). */
  readonly anunciarRecusa: (motivo: MotivoDeRecusa) => void
  /** Libera iluminação/limpeza segurada (modelo + trigger + som, na PartidaPage). */
  readonly liberarLimpezaSegurada: (
    evento: CelulasIluminadasWireEvento | LimpezaAplicadaWireEvento,
  ) => void
}

export function useFilaDeAtaque({
  liberarTurnoSegurado,
  aplicarFatiaDoAtaque,
  anunciarRecusa,
  liberarLimpezaSegurada,
}: OpcoesDaFilaDeAtaque): {
  readonly ataqueExibido: AtaqueExibido | null
  /** Peça do monstro em telegraph (contorno 3D + espelho DOM); null fora do pulso. */
  readonly pecaIdEmTelegraph: string | null
  readonly enfileirarAtaque: (
    evento: AtaqueResolvidoWireEvento,
    contexto: ContextoDaCoreografiaDoAtaque,
  ) => void
  /** Segura a virada de turno (início ou encerramento) com a fila ativa. */
  readonly segurarTurnoSeEmAtaque: (
    evento: TurnoIniciadoEvento | TurnoEncerradoEvento,
  ) => boolean
  /** Segura iluminação/limpeza com a fila ativa (libera na chegada do Vulto). */
  readonly segurarLimpezaSeEmAtaque: (
    evento: CelulasIluminadasWireEvento | LimpezaAplicadaWireEvento,
    celulas?: ReadonlyMap<string, Celula>,
  ) => boolean
  /** Abre a janela de gatilho da confirmação (o lote real chega antes do ataque). */
  readonly abrirJanelaDeGatilho: () => void
  /**
   * Segura iluminação/limpeza na janela aberta do gatilho (sem som/trigger).
   * Tem precedência sobre o seguro da fila — o fechamento compõe com ele.
   */
  readonly segurarNaJanelaSeAberta: (
    evento: CelulasIluminadasWireEvento | LimpezaAplicadaWireEvento,
    celulas?: ReadonlyMap<string, Celula>,
  ) => boolean
  /** Fecha a janela entregando o buffer à fila (libera na chegada do Vulto). */
  readonly entregarJanelaAoAtaque: () => void
  /** Fecha a janela sem ataque: libera o buffer em ordem (compõe com fila ativa). */
  readonly fecharJanelaDeGatilho: () => void
  readonly notificarSnapshot: () => void
  readonly cancelarAtaque: () => void
} {
  const [ataqueExibido, setAtaqueExibido] = useState<AtaqueExibido | null>(null)
  const filaRef = useRef<ItemNaFila[]>([])
  const emAndamentoRef = useRef(false)
  const timersRef = useRef<number[]>([])
  const turnosSeguradosRef = useRef<TurnoSegurado[]>([])
  const limpezasSeguradasRef = useRef<LimpezaSegurada[]>([])
  // Janela de gatilho da confirmação (review PR #399, Bloqueante 1): marcador
  // explícito aberto em `POSICAO_CONFIRMADA` — o buffer segura a
  // iluminação/limpeza do mesmo lote até o ataque (entrega à fila) ou a
  // virada de turno (libera em ordem) fechar.
  const janelaDeGatilhoRef = useRef(false)
  const limpezasNaJanelaRef = useRef<LimpezaSegurada[]>([])
  // Retidas do fecho sem ataque (fix pós-review PR #399 — onda cega no
  // ataque tardio): o auto-fecho aplica a limpeza e esvazia o buffer — mas um
  // ATAQUE_RESOLVIDO tardio do mesmo gatilho (sem TURNO no meio) ainda precisa
  // varrer as removidas. Guarda pecaId→célula pré-limpeza (ids = chaves).
  // Expira em: nova janela (outro lote), virada de turno, snapshot, dreno com
  // uso (enfileirar consome), cancelar/unmount.
  const celulasRetidasRef = useRef(new Map<string, Celula>())
  const seqSnapshotRef = useRef(0)
  const keyRef = useRef(0)
  // Recursão do driver via ref (mesmo padrão de `desconectarRef` na
  // PartidaPage): o timer sempre chama a versão mais recente, sem
  // recriar callbacks nem re-subscrever o socket.
  const exibirProximoRef = useRef<(ePrimeiroDaFila: boolean) => void>(() => undefined)
  // Callbacks da PartidaPage trocam por render sem recriar o driver: refs estáveis.
  const liberarTurnoRef = useRef(liberarTurnoSegurado)
  const aplicarFatiaRef = useRef(aplicarFatiaDoAtaque)
  const anunciarRef = useRef(anunciarRecusa)
  const liberarLimpezaRef = useRef(liberarLimpezaSegurada)
  useEffect(() => {
    liberarTurnoRef.current = liberarTurnoSegurado
    aplicarFatiaRef.current = aplicarFatiaDoAtaque
    anunciarRef.current = anunciarRecusa
    liberarLimpezaRef.current = liberarLimpezaSegurada
  }, [liberarTurnoSegurado, aplicarFatiaDoAtaque, anunciarRecusa, liberarLimpezaSegurada])
  // Unmount descarta tudo explicitamente (timers, fila, janela, segurados e
  // retidas — sem vazamento entre testes/páginas; o snapshot reconcilia ao
  // remontar).
  useEffect(
    () => () => {
      for (const id of timersRef.current) window.clearTimeout(id)
      timersRef.current = []
      filaRef.current = []
      turnosSeguradosRef.current = []
      limpezasSeguradasRef.current = []
      janelaDeGatilhoRef.current = false
      limpezasNaJanelaRef.current = []
      celulasRetidasRef.current.clear()
      emAndamentoRef.current = false
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

  const liberarLimpezasSeguradas = useCallback((): void => {
    const seguradas = limpezasSeguradasRef.current
    limpezasSeguradasRef.current = []
    for (const segurada of seguradas) {
      if (segurada.seqSnapshot !== seqSnapshotRef.current) continue
      liberarLimpezaRef.current(segurada.evento)
    }
  }, [])

  const exibirProximo = useCallback(
    (ePrimeiroDaFila: boolean): void => {
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
          liberarTurnoRef.current(segurado.evento)
        }
        // Sem Vulto na fila (ou sobras pós-Vulto): o restante da
        // iluminação/limpeza segurada libera ao drenar, em ordem.
        liberarLimpezasSeguradas()
        return
      }
      keyRef.current += 1
      const key = keyRef.current
      // Telegraph silencioso de 1s: contorno vermelho na peça, sem som nem
      // consequência — a revelação (sons + overlay de ataque) só após o pulso.
      setAtaqueExibido({ item: atual.item, key, estagio: 'telegraph' })
      agendar(DURACAO_TELEGRAPH_ATAQUE_MS, () => {
        setAtaqueExibido({ item: atual.item, key, estagio: 'ataque' })
        // Gesto de disparo soa após o pulso — sempre, mesmo sem vítimas.
        tocarSomDoMonstro(atual.item.tipo)
        // Chegada ao alvo: a fatia do slot aplica no modelo (guarda de
        // snapshot-seq — snapshot mais novo invalida a fatia, a autoridade já
        // projetou), o anúncio sai só com vítimas na fatia, e a
        // iluminação/limpeza segurada libera junto na chegada do Vulto.
        agendar(DURACAO_DISPARO_ATAQUE_MS, () => {
          if (atual.seqSnapshot !== seqSnapshotRef.current) return
          const fatia = atual.item.fatia
          if (fatia.estadosAplicados.length > 0 || fatia.protegidos.length > 0) {
            aplicarFatiaRef.current(fatia)
          }
          if (fatia.estadosAplicados.length > 0) {
            anunciarRef.current('ataque_com_penalidade')
          }
          if (atual.item.temAtingido) tocarTremorDoAtaque()
          if (atual.item.temProtegido) tocarDefesaDoAtaque()
          // Último Vulto libera (review PR #399, item 3): com [Vulto, Vulto]
          // a limpeza segura até a chegada do 2º — o 1º ainda tem Vulto
          // restante em `filaRef`; o dreno segue como rede de segurança.
          if (
            atual.item.tipo === 'vulto' &&
            !filaRef.current.some((pendente) => pendente.item.tipo === 'vulto')
          ) {
            liberarLimpezasSeguradas()
          }
        })
        // Custo base só no primeiro da fila (~2,3s com 1 monstro, ~3,9s com
        // 2, telegraph incluso); os seguintes ocupam só o slot. O contorno
        // apaga ao entrar no disparo.
        agendar(
          ePrimeiroDaFila
            ? DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS
            : DURACAO_ATAQUE_POR_ATACANTE_MS,
          () => exibirProximoRef.current(false),
        )
      })
    },
    [agendar, liberarLimpezasSeguradas],
  )
  useEffect(() => {
    exibirProximoRef.current = exibirProximo
  }, [exibirProximo])

  const enfileirarAtaque = useCallback(
    (evento: AtaqueResolvidoWireEvento, contexto: ContextoDaCoreografiaDoAtaque): void => {
      // Retidas do fecho sem ataque (onda cega no ataque tardio): ids das
      // removidas + células pré-limpeza das seguradas — um ATAQUE tardio do
      // mesmo gatilho (sem TURNO no meio) ainda varre as removidas. Drena no
      // uso (enfileirar consome); o resto expira adiante.
      const retidas = celulasRetidasRef.current
      const removidasSeguradas = limpezasSeguradasRef.current.flatMap((segurada) =>
        segurada.evento.type === 'LIMPEZA_APLICADA' ? segurada.evento.pecasRemovidas : [],
      )
      for (const pecaId of retidas.keys()) {
        if (!removidasSeguradas.includes(pecaId)) removidasSeguradas.push(pecaId)
      }
      // Células pré-limpeza fotografadas nos seguros (fix pós-PR #399): a
      // limpeza pode já ter aplicado (auto-fecho da janela) quando o ataque
      // chega — a onda usa para varrer as removidas (só lacunas).
      const celulasPreLimpeza = new Map<string, Celula>()
      for (const segurada of limpezasSeguradasRef.current) {
        for (const [pecaId, celula] of segurada.celulas) {
          if (!celulasPreLimpeza.has(pecaId)) celulasPreLimpeza.set(pecaId, celula)
        }
      }
      for (const [pecaId, celula] of retidas) {
        if (!celulasPreLimpeza.has(pecaId)) celulasPreLimpeza.set(pecaId, celula)
      }
      retidas.clear()
      const itens = coreografarAtaque(evento, contexto, removidasSeguradas, celulasPreLimpeza)
      // Sem slot (wire sem atacantes — o engine só emite com ao menos um
      // Monstro): nada anima e nenhum driver passa a rodar — a limpeza
      // segurada (incluindo janela recém-entregue) libera em ordem em vez
      // de aguardar uma chegada que nunca vem.
      if (itens.length === 0) {
        liberarLimpezasSeguradas()
        return
      }
      const seqSnapshot = seqSnapshotRef.current
      const ocioso = !emAndamentoRef.current
      filaRef.current.push(...itens.map((item) => ({ item, seqSnapshot })))
      if (ocioso) {
        emAndamentoRef.current = true
        exibirProximo(true)
      }
    },
    [exibirProximo, liberarLimpezasSeguradas],
  )

  const segurarTurnoSeEmAtaque = useCallback(
    (evento: TurnoIniciadoEvento | TurnoEncerradoEvento): boolean => {
      // Virada expira as retidas do fecho sem ataque: outro turno, outro
      // lote — removidas antigas não assombram ondas futuras.
      celulasRetidasRef.current.clear()
      if (!emAndamentoRef.current) return false
      turnosSeguradosRef.current.push({ evento, seqSnapshot: seqSnapshotRef.current })
      return true
    },
    [],
  )

  const segurarLimpezaSeEmAtaque = useCallback(
    (
      evento: CelulasIluminadasWireEvento | LimpezaAplicadaWireEvento,
      celulas: ReadonlyMap<string, Celula> = new Map(),
    ): boolean => {
      if (!emAndamentoRef.current) return false
      limpezasSeguradasRef.current.push({ evento, seqSnapshot: seqSnapshotRef.current, celulas })
      return true
    },
    [],
  )

  const fecharJanelaRef = useRef<() => void>(() => undefined)
  const janelaTimerRef = useRef<number | null>(null)
  const cancelarTimerDaJanela = useCallback((): void => {
    if (janelaTimerRef.current !== null) {
      window.clearTimeout(janelaTimerRef.current)
      timersRef.current = timersRef.current.filter((t) => t !== janelaTimerRef.current)
      janelaTimerRef.current = null
    }
  }, [])

  const abrirJanelaDeGatilho = useCallback((): void => {
    // Reabertura (dupla confirmação sem fechar — não esperada no wire):
    // descarta o timer anterior antes de rearmar.
    cancelarTimerDaJanela()
    // Lote novo expira as retidas do lote anterior.
    celulasRetidasRef.current.clear()
    janelaDeGatilhoRef.current = true
    // Auto-fecho (fix pós-PR #399): o lote real chega no mesmo burst (ms) —
    // sem ATAQUE no prazo, o lote aplica ao confirmar em vez de segurar até
    // a virada de turno. O timer morre em entregar/fechar/cancelar/unmount.
    agendar(DURACAO_JANELA_GATILHO_MS, () => {
      janelaTimerRef.current = null
      fecharJanelaRef.current()
    })
    janelaTimerRef.current = timersRef.current[timersRef.current.length - 1] ?? null
  }, [agendar, cancelarTimerDaJanela])

  const segurarNaJanelaSeAberta = useCallback(
    (
      evento: CelulasIluminadasWireEvento | LimpezaAplicadaWireEvento,
      celulas: ReadonlyMap<string, Celula> = new Map(),
    ): boolean => {
      if (!janelaDeGatilhoRef.current) return false
      limpezasNaJanelaRef.current.push({ evento, seqSnapshot: seqSnapshotRef.current, celulas })
      return true
    },
    [],
  )

  const entregarJanelaAoAtaque = useCallback((): void => {
    cancelarTimerDaJanela()
    janelaDeGatilhoRef.current = false
    const emJanela = limpezasNaJanelaRef.current
    limpezasNaJanelaRef.current = []
    for (const segurada of emJanela) {
      if (segurada.seqSnapshot !== seqSnapshotRef.current) continue
      limpezasSeguradasRef.current.push(segurada)
    }
  }, [cancelarTimerDaJanela])

  const fecharJanelaDeGatilho = useCallback((): void => {
    cancelarTimerDaJanela()
    if (!janelaDeGatilhoRef.current && limpezasNaJanelaRef.current.length === 0) return
    janelaDeGatilhoRef.current = false
    const emJanela = limpezasNaJanelaRef.current
    limpezasNaJanelaRef.current = []
    for (const segurada of emJanela) {
      if (segurada.seqSnapshot !== seqSnapshotRef.current) continue
      // Compõe com fila ativa de ataque anterior: segura junto; sem fila,
      // libera em ordem pelo caminho direto (modelo + trigger + som) e retém
      // as fotos — um ataque tardio do mesmo gatilho ainda varre as removidas.
      if (emAndamentoRef.current) {
        limpezasSeguradasRef.current.push(segurada)
      } else {
        for (const [pecaId, celula] of segurada.celulas) {
          if (!celulasRetidasRef.current.has(pecaId)) {
            celulasRetidasRef.current.set(pecaId, celula)
          }
        }
        liberarLimpezaRef.current(segurada.evento)
      }
    }
  }, [cancelarTimerDaJanela])
  useEffect(() => {
    fecharJanelaRef.current = fecharJanelaDeGatilho
  }, [fecharJanelaDeGatilho])

  const notificarSnapshot = useCallback((): void => {
    seqSnapshotRef.current += 1
    // Snapshot é autoridade total: fotos antigas expiram.
    celulasRetidasRef.current.clear()
  }, [])

  const cancelarAtaque = useCallback((): void => {
    cancelarTimerDaJanela()
    for (const id of timersRef.current) window.clearTimeout(id)
    timersRef.current = []
    filaRef.current = []
    turnosSeguradosRef.current = []
    limpezasSeguradasRef.current = []
    janelaDeGatilhoRef.current = false
    limpezasNaJanelaRef.current = []
    celulasRetidasRef.current.clear()
    emAndamentoRef.current = false
    setAtaqueExibido(null)
  }, [cancelarTimerDaJanela])

  const pecaIdEmTelegraph = ataqueExibido !== null && ataqueExibido.estagio === 'telegraph'
    ? ataqueExibido.item.pecaId
    : null

  return {
    ataqueExibido,
    pecaIdEmTelegraph,
    enfileirarAtaque,
    segurarTurnoSeEmAtaque,
    segurarLimpezaSeEmAtaque,
    abrirJanelaDeGatilho,
    segurarNaJanelaSeAberta,
    entregarJanelaAoAtaque,
    fecharJanelaDeGatilho,
    notificarSnapshot,
    cancelarAtaque,
  }
}
