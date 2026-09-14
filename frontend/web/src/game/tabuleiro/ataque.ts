/**
 * Coreografia do ataque dos monstros (issue #385) — 100% pura.
 *
 * Deriva do `ATAQUE_RESOLVIDO` + modelo PRÉ-despacho a fila sequencial de
 * itens (um por atacante, Espectro antes do Vulto — ordem estável; mesmo tipo
 * mantém a ordem de `atacantes`, que o engine emite na ordem de
 * posicionamento): telegraph silencioso de
 * 1s com contorno vermelho na peça do monstro, depois gesto de disparo antes
 * da reação em cadeia. O Vulto ondula por camadas de distância toroidal da
 * célula do monstro (ADR-0012: na borda, a onda atravessa para o lado oposto;
 * todas as direções em paralelo dentro da camada); o
 * Espectro reage junto nas adjacentes (sem stagger). A consequência é fatiada
 * por dono do alcance (`peoesAtingidos`/`peoesProtegidos` do atacante) — só a
 * revelação visual; o reducer aplica cada fatia na chegada do próprio slot
 * (via `reduzirFatiaDoAtaque`), nunca tudo na hora.
 *
 * Fatiamento por tipo (decisão do usuário, follow-up da #385): o Vulto só
 * causa Baixa Iluminação; o Espectro só perda de Sanidade/Amedrontado
 * (espelho do funil do engine, partida.ts — penalidades por tipo). Jogador
 * atingido pelos dois revela a sanidade no slot do Espectro e a Baixa no
 * slot do Vulto. A proteção consumida (`protegidos`) revela no primeiro slot
 * cujo alcance contém o peão (ordem Espectro→Vulto).
 *
 * Reação por peça do alcance: sem peão pula (sem sair da célula); com peão
 * treme junto sem pular; protegido recebe só escudo (sem tremor nem
 * debilitação — a onda percorre a peça normalmente); sem peça, sem reação.
 * `pecasNoAlcance` é observacional/opcional (issue #384): payload legado sem
 * o campo ativa o fallback (sem onda, sem quebra) — sons, fila e bloqueio
 * funcionam igual. Nenhum julgamento de regra no cliente.
 */

import type { AtaqueResolvidoWireEvento, EstadoResultanteNoAtaque } from '@flicker/shared'
import { chaveCelula, LADO_DA_GRADE, normalizarCelula, type Celula } from './contrato'
import {
  DURACAO_BASE_ATAQUE_MS,
  DURACAO_ATAQUE_POR_ATACANTE_MS,
  DURACAO_ONDA_VULTO_CAMADA_MS,
  DURACAO_TELEGRAPH_ATAQUE_MS,
} from './animacao'

/** Reação visual de uma peça do alcance — só revela, nunca julga. */
export type ReacaoDePecaNoAtaque = 'pulo' | 'tremor' | 'escudo'

/**
 * Camada de distância (toroidal, ADR-0012) da peça do monstro — eixo da onda
 * do Vulto (`atrasoMs = camada × token`); o Espectro reage junto (atraso 0).
 */
export type CamadaDaOnda = number

export interface PecaReagindoNoAtaque {
  readonly pecaId: string
  readonly reacao: ReacaoDePecaNoAtaque
  /** Camada de distância (toroidal, ADR-0012) da peça do monstro — eixo da onda. */
  readonly camada: CamadaDaOnda
  /**
   * Atraso da onda até esta peça: Vulto = camada × token (direções em
   * paralelo dentro da camada); Espectro = 0 (adjacentes juntas).
   */
  readonly atrasoMs: number
}

/** Um atacante da fila — Espectro antes do Vulto (ordem estável). */
export interface ItemCoreografadoDoAtaque {
  readonly pecaId: string
  readonly tipo: 'vulto' | 'espectro'
  readonly pecasNoAlcance: readonly string[]
  readonly reacoes: readonly PecaReagindoNoAtaque[]
  /** Há atingido deste atacante na chegada → tremor. */
  readonly temAtingido: boolean
  /** Há protegido deste atacante na chegada → defesa (sem tremor). */
  readonly temProtegido: boolean
  /**
   * Dono da consequência (issue #385, follow-up): peões atingidos DENTRO do
   * alcance deste atacante (`peoesNoAlcance × peoesAtingidos` globais) — o
   * visual revela por slot; peão no alcance de dois monstros aparece nos dois
   * itens (a fatia de estado abaixo divide por tipo).
   */
  readonly peoesAtingidos: readonly string[]
  /**
   * Peões protegidos DENTRO do alcance deste atacante
   * (`peoesNoAlcance × protegidos` globais, resolvidos a peão via contexto) —
   * só no PRIMEIRO slot (ordem Espectro→Vulto) cujo alcance contém o peão; os
   * demais slots silenciam (sem defesa dupla pelo mesmo consumo).
   */
  readonly peoesProtegidos: readonly string[]
  /**
   * Fatia de estado deste slot (issue #385, follow-up da ordem): o driver
   * aplica via `reduzirFatiaDoAtaque` na chegada do slot — Espectro revela
   * sanidade/Amedrontado, Vulto revela Baixa Iluminação (a redução mascara por
   * tipo); proteção consumida só no primeiro slot do alcance. Fatia vazia
   * (sem vítimas nem protegidos) = nada a aplicar.
   */
  readonly fatia: FatiaDoAtaque
}

/**
 * Fatia de estado de um slot do ataque (issue #385, follow-up da ordem) —
 * subconjunto do `ATAQUE_RESOLVIDO` aplicado na chegada do slot via
 * `reduzirFatiaDoAtaque` (valores RESULTANTES, absolutos e idempotentes).
 */
export interface FatiaDoAtaque {
  /** Tipo do dono do slot — a redução aplica só os campos dele. */
  readonly tipo: 'vulto' | 'espectro'
  /**
   * Resultantes dos jogadores cujo peão está no alcance deste atacante e foi
   * atingido (filtro por `peaoPorJogador × peoesNoAlcance × peoesAtingidos`;
   * mapeamento desconhecido inclui por defesa — a projeção absoluta é
   * idempotente). O mesmo jogador pode aparecer na fatia dos dois monstros
   * (sanidade no slot Espectro, Baixa no slot Vulto).
   */
  readonly estadosAplicados: readonly EstadoResultanteNoAtaque[]
  /**
   * Proteção consumida revelada neste slot: só o primeiro slot (ordem
   * Espectro→Vulto) cujo alcance contém o peão; mapeamento desconhecido ou
   * fora de todos os alcances cai no primeiro item (nunca se perde consumo).
   */
  readonly protegidos: readonly string[]
}

/**
 * Estado visual do ataque (issue #385, follow-up): prop única que trafega
 * `PartidaPage → AmbienteDeJogo → AmbienteCena + TabuleiroMirrorDOM →
 * Tabuleiro` (o `Tabuleiro` deriva as props por célula para a `Celula`).
 * Tudo null fora do slot ativo (apaga sem marcas ao drenar).
 */
export interface EstadoVisualDoAtaque {
  /** Peça do monstro em telegraph (contorno 3D + marca DOM); null fora do pulso. */
  readonly pecaIdEmTelegraph: string | null
  /**
   * Reações das peças no alcance no estágio de ataque (pecaId → reação do
   * coreógrafo; os chips do overlay seguem como legenda). Null fora do disparo.
   */
  readonly reacoesDoAtaque: ReadonlyMap<string, PecaReagindoNoAtaque> | null
  /** Peça do atacante no estágio de disparo (gesto de escala + flash). */
  readonly pecaIdEmDisparo: string | null
}

/**
 * Deslocamento XZ do tremor no instante `tMs` (issue #385, follow-up): mesma
 * cadência da peça sob `tremor` e do peão que treme junto — só no XZ (o peão
 * nunca pula). Pura (sem WebGL/clock): os chamadores (`GrupoDaReacao` em
 * `PecaPlaceholder`, `TremorDoPeao` em `PeaoVisual`) passam o tempo pós-atraso
 * da onda e aplicam o par no `position`.
 */
export function poseDoTremorXZ(tMs: number): readonly [number, number] {
  return [
    0.05 * Math.sin((tMs * Math.PI * 2) / 90),
    0.05 * Math.cos((tMs * Math.PI * 2) / 110),
  ]
}

/**
 * Subconjunto do modelo PRÉ-despacho necessário à coreografia (somente
 * leitura): dono de cada peão, posição dos peões e células das peças.
 */
export interface ContextoDaCoreografiaDoAtaque {
  readonly peaoPorJogador: Readonly<Record<string, string>>
  readonly peoes: readonly { readonly peaoId: string; readonly celula: Celula | null }[]
  readonly posicionadas: readonly { readonly pecaId: string; readonly celula: Celula }[]
}

function distanciaToroidal(a: Celula, b: Celula): number {
  // Toroidal (ADR-0012, espelho de `normalizarCelula` do engine): na borda, a
  // onda atravessa para o lado oposto — o eixo por `LADO_DA_GRADE` encurta o
  // delta que cruza a fronteira. Normaliza antes (coordenada sempre na grade).
  const na = normalizarCelula(a)
  const nb = normalizarCelula(b)
  const deltaLinha = Math.abs(na.linha - nb.linha)
  const deltaColuna = Math.abs(na.coluna - nb.coluna)
  return (
    Math.min(deltaLinha, LADO_DA_GRADE - deltaLinha) +
    Math.min(deltaColuna, LADO_DA_GRADE - deltaColuna)
  )
}

/**
 * Duração total da fila com N atacantes (lag deliberado por decisão do
 * usuário, issue #385 — pacing do jogo, não bug de performance):
 * base + N × (telegraph + slot) — ~2,3s com 1 monstro, ~3,9s com 2
 * (cada telegraph de 1s é silencioso e estende o bloqueio da entrada).
 * Zero sem atacantes.
 */
export function duracaoDaFilaDeAtaque(quantidadeDeAtacantes: number): number {
  if (quantidadeDeAtacantes <= 0) return 0
  return (
    DURACAO_BASE_ATAQUE_MS +
    quantidadeDeAtacantes * (DURACAO_TELEGRAPH_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
  )
}

/**
 * Coreografa o ataque em fila sequencial por atacante (Espectro antes do
 * Vulto, ordem estável — mesmo tipo mantém a ordem de `atacantes`, que o
 * engine emite na ordem de posicionamento). O estado do jogo aplica cada
 * fatia na chegada do próprio slot (via `reduzirFatiaDoAtaque` no driver);
 * isto só revela.
 */
export function coreografarAtaque(
  evento: Pick<
    AtaqueResolvidoWireEvento,
    'atacantes' | 'peoesAtingidos' | 'protegidos' | 'estadosAplicados'
  >,
  contexto: ContextoDaCoreografiaDoAtaque,
): ItemCoreografadoDoAtaque[] {
  const atingidos = new Set(evento.peoesAtingidos)
  const peoesProtegidos = new Set<string>()
  for (const jogadorId of evento.protegidos) {
    const peaoId = contexto.peaoPorJogador[jogadorId]
    if (peaoId !== undefined) peoesProtegidos.add(peaoId)
  }
  const celulaPorPeca = new Map<string, Celula>()
  for (const p of contexto.posicionadas) celulaPorPeca.set(p.pecaId, p.celula)

  // Ordem estável Espectro→Vulto (decisão do usuário, follow-up da #385): o
  // Espectro resolve por completo primeiro e só após seu fim o Vulto entra em
  // telegraph. `Array.sort` é estável — mesmo tipo preserva a ordem do engine.
  const ordemEstavel = evento.atacantes
    .map((atacante, indice) => ({ atacante, indice }))
    .sort(
      (a, b) =>
        (a.atacante.tipo === 'espectro' ? 0 : 1) - (b.atacante.tipo === 'espectro' ? 0 : 1) ||
        a.indice - b.indice,
    )

  const itens: ItemCoreografadoDoAtaque[] = ordemEstavel.map(({ atacante }) => {
    // Fallback legado (rolling deploy / replay sem #384): sem o campo não há
    // onda — o item ainda soa (monstro) e ocupa seu slot na fila.
    const pecasNoAlcance = atacante.pecasNoAlcance ?? []
    const peoesNoAlcance = new Set(atacante.peoesNoAlcance)
    const peoesAtingidos: string[] = []
    const peoesProtegidosDoAtacante: string[] = []
    for (const peaoId of peoesNoAlcance) {
      if (atingidos.has(peaoId)) peoesAtingidos.push(peaoId)
      if (peoesProtegidos.has(peaoId)) peoesProtegidosDoAtacante.push(peaoId)
    }
    const temAtingido = peoesAtingidos.length > 0
    const celulaDoMonstro = celulaPorPeca.get(atacante.pecaId) ?? null
    const reacoes = pecasNoAlcance.map((pecaId, indice) => {
      const celula = celulaPorPeca.get(pecaId) ?? null
      const chave = celula !== null ? chaveCelula(celula) : null
      const peoesNaPeca =
        chave !== null
          ? contexto.peoes.filter((p) => p.celula !== null && chaveCelula(p.celula) === chave)
          : []
      const protegidoAqui = peoesNaPeca.some((p) => peoesProtegidos.has(p.peaoId))
      const reacao: ReacaoDePecaNoAtaque =
        protegidoAqui ? 'escudo' : peoesNaPeca.length > 0 ? 'tremor' : 'pulo'
      // Camada real (toroidal, ADR-0012) quando as duas células são
      // conhecidas; fallback à ordem canônica do engine quando não (sem quebra).
      const camada =
        celulaDoMonstro !== null && celula !== null
          ? distanciaToroidal(celulaDoMonstro, celula)
          : indice
      return {
        pecaId,
        reacao,
        camada,
        atrasoMs: atacante.tipo === 'vulto' ? camada * DURACAO_ONDA_VULTO_CAMADA_MS : 0,
      }
    })
    return {
      pecaId: atacante.pecaId,
      tipo: atacante.tipo,
      pecasNoAlcance,
      reacoes,
      temAtingido,
      // `temProtegido` deriva da lista fatiada abaixo (só o primeiro slot do
      // alcance soa a defesa) — placeholder até o fatiamento.
      temProtegido: peoesProtegidosDoAtacante.length > 0,
      peoesAtingidos,
      peoesProtegidos: peoesProtegidosDoAtacante,
      // Fatia provisória (protegidos ainda sem dedupe): o bloco abaixo
      // resolve o primeiro-slot e preenche `estadosAplicados` por alcance.
      fatia: {
        tipo: atacante.tipo,
        estadosAplicados: [],
        protegidos: [],
      },
    }
  })

  // Fatiamento puro por atacante (follow-up da #385):
  // - `estadosAplicados`: cada slot leva os resultantes dos jogadores cujo
  //   peão está no SEU alcance e foi atingido (a redução mascara por tipo:
  //   Espectro aplica sanidade/Amedrontado, Vulto aplica Baixa). Jogador
  //   atingido pelos dois aparece nas duas fatias; mapeamento
  //   jogador→peão desconhecido inclui por defesa (projeção absoluta é
  //   idempotente — revelar cedo no fallback é melhor que perder o estado).
  // - `protegidos`: cada consumo revela SÓ no primeiro slot (ordem
  //   Espectro→Vulto) cujo alcance contém o peão; sem mapeamento ou fora de
  //   todos os alcances, cai no primeiro item (nunca se perde consumo).
  const peaoPorJogador = contexto.peaoPorJogador
  const alcances = itens.map(
    (item, indice) => new Set(ordemEstavel[indice]!.atacante.peoesNoAlcance),
  )
  const protegidosPorSlot: string[][] = itens.map(() => [])
  evento.protegidos.forEach((jogadorId) => {
    const peaoId = peaoPorJogador[jogadorId]
    const indice = peaoId !== undefined ? alcances.findIndex((alcance) => alcance.has(peaoId)) : -1
    protegidosPorSlot[indice >= 0 ? indice : 0]?.push(jogadorId)
  })
  return itens.map((item, indice) => {
    const alcance = alcances[indice]!
    const estadosAplicados = evento.estadosAplicados.filter((aplicado) => {
      const peaoId = peaoPorJogador[aplicado.jogadorId]
      if (peaoId === undefined) return true
      return alcance.has(peaoId) && atingidos.has(peaoId)
    })
    const protegidos = protegidosPorSlot[indice] ?? []
    // Dono da defesa por peão: o peão protegido soa só no slot que revela o
    // consumo (primeiro do alcance); nos demais, o escudo visual segue sem som.
    const peoesProtegidosAqui = item.peoesProtegidos.filter((peaoId) =>
      protegidos.some((jogadorId) => peaoPorJogador[jogadorId] === peaoId),
    )
    return {
      ...item,
      // A defesa soa só no slot que revela o consumo (primeiro do alcance) —
      // a flag segue a fatia para cobrir o fallback sem mapeamento (sem peão
      // conhecido a listar, mas com consumo a revelar).
      temProtegido: protegidos.length > 0,
      peoesProtegidos: peoesProtegidosAqui,
      fatia: { tipo: item.tipo, estadosAplicados, protegidos },
    }
  })
}
