/**
 * Projeção do snapshot wire para o modelo do cliente (issue #156, ST-14) —
 * módulo dedicado da reconciliação autoritativa (review PR #189).
 *
 * O canal da Partida entrega `ESTADO_DA_PARTIDA` com o snapshot completo do
 * engine; `aplicarSnapshot` substitui o modelo local pelas projeções do wire e
 * preserva o que o snapshot não carrega (reserva e a fase de movimento do
 * turno em andamento). Sem recalcular iluminação/limpeza: o motor é a
 * autoridade.
 */

import type {
  Celula as CelulaContrato,
  CorDoPeao,
  PecaPosicionada,
  PeaoDaExibicao,
  TipoDaPeca,
} from './contrato'
import type { EstadoDoTabuleiroNoCliente } from './reducao'
import type { PendenciaNoCliente } from './interacaoPeoes'
import type { Celula, EstadoDaPartidaSnapshot } from '@flicker/shared'

/**
 * Aplica um snapshot do servidor ao estado do cliente, produzindo um novo
 * estado. Mapeia posicionadas, peões, celulasIluminadas,
 * pecaSelecionadaId/pecaEmManipulacaoId/peaoSelecionadoId,
 * recebidas→recebidasPendentes, jogadores→peaoPorJogador+jogadorPorId (com
 * sanidade/estados — ST-15, #174) e jogadorAtivoId/rodada/posicaoConfirmada —
 * preservando a reserva.
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

  const mapPos = new Map<string, CelulaContrato>(
    posicionadas.map((p) => [p.pecaId, p.celula] as const),
  )

  const peoes: readonly PeaoDaExibicao[] = snapshot.tabuleiro.peoes.map((peao) => {
    const celula = peao.pecaId !== null ? (mapPos.get(peao.pecaId) ?? null) : null
    return {
      peaoId: peao.peaoId,
      cor: peao.cor,
      celula: celula ? { linha: celula.linha, coluna: celula.coluna } : null,
    }
  })

  // Pos-#138 toda Recebida do snapshot e da forma sorteada: map direto para
  // PendenciaDaPecaSorteada, sem cast. `orientacao` do snapshot nao e copiado
  // — nao faz parte da pendencia; o cliente a ignora fora da Reserva.
  const recebidasPendentes: readonly PendenciaNoCliente[] = snapshot.tabuleiro.recebidas.map(
    (r): PendenciaNoCliente => ({
      recebidaId: r.recebidaId,
      pecaId: r.pecaId,
      tipoDaPeca: r.tipo,
      vaga: r.vaga,
      celulaAlvo: r.celulaAlvo
        ? { linha: r.celulaAlvo.linha, coluna: r.celulaAlvo.coluna }
        : null,
    }),
  )

  const peaoPorJogador: Record<string, string> = {}
  const jogadorPorId: Record<string, { apelido: string; cor: CorDoPeao; sanidade: number; emBaixaIluminacao: boolean; amedrontado: boolean }> = {}
  for (const j of snapshot.jogadores) {
    peaoPorJogador[j.jogadorId] = j.peaoId
    // Snapshot carrega sanidade/estados (issue #173) com normalização
    // defensiva no server, mas clientes com estado persistido antigo podem
    // receber payload incompleto via WS replay — replicamos fallback defensivo
    // (server: snapshot.ts:41) para não gravar undefined no modelo.
    const sanidade = (j as { sanidade?: number }).sanidade ?? 3
    const emBaixaIluminacao = (j as { emBaixaIluminacao?: boolean }).emBaixaIluminacao ?? false
    const amedrontado = (j as { amedrontado?: boolean }).amedrontado ?? sanidade === 0
    jogadorPorId[j.jogadorId] = {
      apelido: j.apelido,
      cor: j.cor,
      sanidade,
      emBaixaIluminacao,
      amedrontado,
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

  return {
    reserva: estado.reserva,
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
    // (late-join no meio do turno perderia a fase 'confirmar').
    movimentouNoTurno: estado.movimentouNoTurno,
    posicaoConfirmadaNoTurno: snapshot.posicaoConfirmada,
    peaoPorJogador,
    jogadorPorId,
  }
}
