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
 * recebidas→recebidasPendentes, jogadores→peaoPorJogador+jogadorPorId e
 * jogadorAtivoId/rodada/posicaoConfirmada — preservando a reserva.
 */
export function aplicarSnapshot(
  estado: EstadoDoTabuleiroNoCliente,
  snapshot: EstadoDaPartidaSnapshot,
): EstadoDoTabuleiroNoCliente {
  const posicionadas: readonly PecaPosicionada[] = snapshot.tabuleiro.posicionadas.map((p) => ({
    pecaId: p.pecaId,
    tipo: p.tipo as unknown as TipoDaPeca,
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
      cor: peao.cor as unknown as CorDoPeao,
      celula: celula ? { linha: celula.linha, coluna: celula.coluna } : null,
    }
  })

  const recebidasPendentes: readonly PendenciaNoCliente[] = snapshot.tabuleiro.recebidas.map(
    (r) =>
      ({
        recebidaId: r.recebidaId,
        pecaId: r.pecaId,
        tipoDaPeca: r.tipo as unknown as string,
        vaga: r.vaga,
        celulaAlvo: r.celulaAlvo
          ? { linha: r.celulaAlvo.linha, coluna: r.celulaAlvo.coluna }
          : null,
        // orientacao do snapshot não faz parte de PendenciaNoCliente, mas fica
        // disponível via cast se necessário; o cliente ignora.
        orientacao: r.orientacao,
      }) as unknown as PendenciaNoCliente,
  )

  const peaoPorJogador: Record<string, string> = {}
  const jogadorPorId: Record<string, { apelido: string; cor: CorDoPeao }> = {}
  for (const j of snapshot.jogadores) {
    peaoPorJogador[j.jogadorId] = j.peaoId
    jogadorPorId[j.jogadorId] = { apelido: j.apelido, cor: j.cor as unknown as CorDoPeao }
  }

  const pecasDeRecebimento: Record<string, TipoDaPeca> = { ...estado.pecasDeRecebimento }
  for (const r of snapshot.tabuleiro.recebidas) {
    pecasDeRecebimento[r.pecaId] = r.tipo as unknown as TipoDaPeca
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
    movimentouNoTurno: false,
    posicaoConfirmadaNoTurno: snapshot.posicaoConfirmada,
    peaoPorJogador,
    jogadorPorId,
  }
}
