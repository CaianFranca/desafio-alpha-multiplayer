/**
 * Projeção do snapshot wire para o modelo do cliente (issue #156, ST-14) —
 * módulo dedicado da reconciliação autoritativa (review PR #189).
 *
 * O canal da Partida entrega `ESTADO_DA_PARTIDA` com o snapshot completo do
 * engine; `aplicarSnapshot` substitui o modelo local pelas projeções do wire e
 * preserva o que o snapshot não carrega (a fase de movimento do turno em
 * andamento). As Peças Iniciais da mesa vêm do próprio snapshot (#143).
 * Sem recalcular iluminação/limpeza: o motor é a autoridade.
 */

import {
  chaveCelula,
  type Celula as CelulaContrato,
  type CorDoPeao,
  type PecaDaMesa,
  type PecaPosicionada,
  type PeaoDaExibicao,
  type PeaoId,
  type TipoDaPeca,
} from './contrato'
import type { EstadoDoTabuleiroNoCliente } from './reducao'
import type { PendenciaNoCliente } from './interacaoPeoes'
import type { Celula, EstadoDaPartidaSnapshot } from '@flicker/shared'

/**
 * Reparo defensivo de reload (issue #258) — ver comentário no corpo de
 * `aplicarSnapshot`. Fora da divergência provada (seleção de Inicial
 * ausente das duas listas) devolve a entrada intocada: a autoridade do
 * snapshot é preservada no caminho comum.
 */
function repararInicialEmFoco(
  estado: EstadoDoTabuleiroNoCliente,
  snapshot: EstadoDaPartidaSnapshot,
  iniciais: readonly PecaDaMesa[],
  posicionadas: readonly PecaPosicionada[],
): readonly PecaDaMesa[] {
  const emFoco = snapshot.tabuleiro.pecaSelecionadaId
  if (emFoco === null || !/^inicial-[1-4]$/.test(emFoco)) return iniciais
  if (iniciais.some((p) => p.pecaId === emFoco)) return iniciais
  if (posicionadas.some((p) => p.pecaId === emFoco)) return iniciais
  const local = estado.iniciais.find((p) => p.pecaId === emFoco)
  const reparada: PecaDaMesa = {
    pecaId: emFoco,
    tipo: 'inicial' as const,
    orientacao: local?.orientacao ?? 0,
  }
  // Insere na ordem canônica (a lista do motor preserva `inicial-1..4` na
  // ordem; o reparo preenche a lacuna sem reordenar o que a foto trouxe).
  const ordem = Number(emFoco.split('-')[1])
  const indice = iniciais.findIndex((p) => Number(p.pecaId.split('-')[1]) > ordem)
  if (indice === -1) return [...iniciais, reparada]
  return [...iniciais.slice(0, indice), reparada, ...iniciais.slice(indice)]
}

/**
 * Aplica um snapshot do servidor ao estado do cliente, produzindo um novo
 * estado. Mapeia posicionadas, iniciais, peões, celulasIluminadas,
 * pecaSelecionadaId/pecaEmManipulacaoId/peaoSelecionadoId,
 * recebidas→recebidasPendentes, jogadores→peaoPorJogador+jogadorPorId (com
 * sanidade/estados — ST-15, #174 — e a Proteção da Sala Médica, #227),
 * jogadorAtivoId/rodada/posicaoConfirmada,
 * as Peças Iniciais da mesa (#143) e a baseline dos objetivos globais —
 * pecasRestantesNaCaixa/geradoresLigados/cartaoDeAcessoObtido (issue #145).
 */
export function aplicarSnapshot(
  estado: EstadoDoTabuleiroNoCliente,
  snapshot: EstadoDaPartidaSnapshot,
): EstadoDoTabuleiroNoCliente {
  const posicionadas: readonly PecaPosicionada[] = snapshot.tabuleiro.posicionadas.map((p) => ({
    pecaId: p.pecaId,
    tipo: p.tipo,
    orientacao: p.orientacao,
    celula: { linha: p.celula.linha, coluna: p.celula.coluna },
  }))

  // Peças Iniciais ainda não encaixadas (issue #143): a lista do motor é a
  // autoridade — recarregar reconstrói a mesa sem seed local.
  // Roster N=2..4 (#284): espelha só as N iniciais do roster; com o servidor
  // ainda em 4 e N=2, projetar as 4 criava indicadores fantasmas do ausente.
  const quantidadeSnapshot = snapshot.jogadores.length
  const iniciaisDoRosterBase: readonly PecaDaMesa[] = snapshot.tabuleiro.iniciais.map((p) => ({
    pecaId: p.pecaId,
    tipo: 'inicial' as const,
    orientacao: p.orientacao,
  }))
  const iniciaisDoSnapshot: readonly PecaDaMesa[] =
    quantidadeSnapshot >= 2 && quantidadeSnapshot <= 4
      ? iniciaisDoRosterBase.slice(0, quantidadeSnapshot)
      : iniciaisDoRosterBase

  // Reparo defensivo de reload (issue #258): a Inicial em foco
  // (`pecaSelecionadaId`) está nas `iniciais` por invariante do engine —
  // selecionar exige a peça na mesa e posicionar a move para
  // `posicionadas`. Seleção pendente sem a peça em NENHUMA das duas listas
  // prova divergência da foto com o estado real: devolve SÓ a peça em foco
  // à mesa (nunca a lista cheia, nunca peça já posicionada, nunca peça da
  // Caixa — só `inicial-1..4`). A orientação reaproveita o giro local
  // (confirmado antes do F5; a foto não a carrega para a peça ausente).
  // Foto consistente (H2: inicial já encaixada) não dispara o reparo.
  const iniciais = repararInicialEmFoco(estado, snapshot, iniciaisDoSnapshot, posicionadas)

  const mapPos = new Map<string, CelulaContrato>(
    posicionadas.map((p) => [p.pecaId, p.celula] as const),
  )

  // Roster variável N=2..4: mantém SÓ os peões dos jogadores do snapshot
  // (peaoId da ordem de entrada) — nunca os N primeiros do array. Com o
  // servidor ainda em 4 e N=2, o slice por posição exibia cores erradas e
  // quebrava "peão na cor da minha ordem de entrada" (#281 história 4).
  // Fallback defensivo: sem peaoId correspondente (snapshot vazio/antigo),
  // mantém a lista cheia em vez de esvaziar a mesa.
  const peaoIdsDosJogadores = new Set(snapshot.jogadores.map((j) => j.peaoId))
  const peoesFiltrados = snapshot.tabuleiro.peoes.filter((peao) => peaoIdsDosJogadores.has(peao.peaoId))
  const peoes: readonly PeaoDaExibicao[] = (peoesFiltrados.length > 0 ? peoesFiltrados : snapshot.tabuleiro.peoes)
    .map((peao) => {
      const celula = peao.pecaId !== null ? (mapPos.get(peao.pecaId) ?? null) : null
      return {
        peaoId: peao.peaoId,
        cor: peao.cor,
        celula: celula ? { linha: celula.linha, coluna: celula.coluna } : null,
      }
    })

  // Toda Recebida do snapshot é da forma sorteada (#138): map direto para
  // PendenciaNoCliente, sem cast. `orientacao` da peça é copiado para que a
  // bandeja da Caixa reexiba a corrente com a rotação correta ao recarregar.
  const recebidasPendentes: readonly PendenciaNoCliente[] = snapshot.tabuleiro.recebidas.map(
    (r): PendenciaNoCliente => ({
      recebidaId: r.recebidaId,
      pecaId: r.pecaId,
      tipoDaPeca: r.tipo,
      vaga: r.vaga,
      celulaAlvo: r.celulaAlvo
        ? { linha: r.celulaAlvo.linha, coluna: r.celulaAlvo.coluna }
        : null,
      orientacao: r.orientacao,
    }),
  )

  const peaoPorJogador: Record<string, string> = {}
  const jogadorPorId: Record<string, { apelido: string; cor: CorDoPeao; sanidade: number; emBaixaIluminacao: boolean; amedrontado: boolean; protegido: boolean; ordem: number }> = {}
  for (const j of snapshot.jogadores) {
    peaoPorJogador[j.jogadorId] = j.peaoId
    // Snapshot carrega sanidade/estados (issue #173) e a Proteção da Sala
    // Médica (issue #227) com normalização defensiva no server, mas clientes
    // com estado persistido antigo podem receber payload incompleto via WS
    // replay — replicamos fallback defensivo (server: snapshot.ts:41) para
    // não gravar undefined no modelo.
    const sanidade = (j as { sanidade?: number }).sanidade ?? 3
    const emBaixaIluminacao = (j as { emBaixaIluminacao?: boolean }).emBaixaIluminacao ?? false
    const amedrontado = (j as { amedrontado?: boolean }).amedrontado ?? sanidade === 0
    const protegido = (j as { protegido?: boolean }).protegido ?? false
    jogadorPorId[j.jogadorId] = {
      apelido: j.apelido,
      cor: j.cor,
      sanidade,
      emBaixaIluminacao,
      amedrontado,
      protegido,
      // Ordem de entrada na Sala (issue #226): alimenta a fila circular do
      // Turno no HUD; o wire sempre carrega (fallback defensivo 0).
      ordem: (j as { ordem?: number }).ordem ?? 0,
    }
  }

  const pecasDeRecebimento: Record<string, TipoDaPeca> = { ...estado.pecasDeRecebimento }
  for (const r of snapshot.tabuleiro.recebidas) {
    pecasDeRecebimento[r.pecaId] = r.tipo
  }

  const celulasIluminadas: readonly Celula[] = snapshot.celulasIluminadas.map((c) => ({
    linha: c.linha,
    coluna: c.coluna,
  }))

  // Fila de chegada por célula (issue #298): reconstruída na ordem da lista
  // do motor (`snapshot.tabuleiro.peoes` mapeado acima — ordem canônica de
  // inserção). O snapshot não preserva a sequência histórica de pousos, então
  // recarregar aproxima a ordem pela lista do motor (limitação de reload
  // documentada no estado); o índice só define o desempate visual.
  const ordemDeChegadaPorChave: Record<string, PeaoId[]> = {}
  for (const peao of peoes) {
    if (peao.celula === null) continue
    const chave = chaveCelula(peao.celula)
    ;(ordemDeChegadaPorChave[chave] ??= []).push(peao.peaoId)
  }

  return {
    iniciais,
    posicionadas,
    pecaSelecionadaId: snapshot.tabuleiro.pecaSelecionadaId,
    pecaEmManipulacaoId: snapshot.tabuleiro.pecaEmManipulacaoId,
    peoes,
    recebidasPendentes,
    peaoSelecionadoId: snapshot.tabuleiro.peaoSelecionadoId,
    pecasDeRecebimento,
    celulasIluminadas,
    jogadorAtivoId: snapshot.jogadorAtivoId,
    rodada: snapshot.rodada,
    // A wire do snapshot não carrega a fase de movimento do turno: re-
    // sincronizar não pode sobrescrever o que os deltas já aprenderam
    // (late-join no meio do turno perderia a fase 'confirmar'). Exceção
    // mínima e conservadora (revisão PR #199): se o snapshot traz a Posição
    // Confirmada, o peão do turno necessariamente já se moveu (confirmar
    // vem depois de mover) — fixar `true` evita um estado local
    // contraditório (confirmada sem movimento) na retomada.
    movimentouNoTurno: snapshot.posicaoConfirmada ? true : estado.movimentouNoTurno,
    posicaoConfirmadaNoTurno: snapshot.posicaoConfirmada,
    peaoPorJogador,
    jogadorPorId,
    // Baseline autoritativa dos objetivos globais (issue #145): o snapshot
    // SUBSTITUI (não faz merge) — reconexão sem recarregamento reconcilia a
    // contagem da Caixa e os contadores de conquista com o engine.
    // Normalização defensiva no mesmo padrão da sanidade acima: snapshots
    // produzidos por binário anterior à #145 não trazem os campos — `null`
    // mantém a contagem oculta (sem baseline), as listas/flags partem
    // neutras.
    pecasRestantesNaCaixa: snapshot.tabuleiro.pecasRestantesNaCaixa ?? null,
    geradoresLigados: snapshot.geradoresLigados ?? [],
    cartaoDeAcessoObtido: snapshot.cartaoDeAcessoObtido ?? false,
    ordemDeChegadaPorChave,
    quantidadeDeJogadores: quantidadeSnapshot > 0 ? quantidadeSnapshot : null,
  }
}
