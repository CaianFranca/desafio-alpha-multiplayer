import type { EstadoDaPartidaSnapshot } from '@flicker/shared'

export type CorDoRoster = 'branco' | 'vermelho' | 'azul' | 'amarelo'

export function jogador(
  id: string,
  apelido: string,
  cor: CorDoRoster,
  ordem: number,
) {
  return {
    jogadorId: id,
    apelido,
    cor,
    ordem,
    peaoId: `peao-${cor}`,
    primeiroTurnoPendente: false,
    sanidade: 3,
    emBaixaIluminacao: false,
    amedrontado: false,
    protegido: false,
  }
}

export function snapshotComJogadores(
  jogadores: EstadoDaPartidaSnapshot['jogadores'],
  peoesDoTabuleiro?: EstadoDaPartidaSnapshot['tabuleiro']['peoes'],
): EstadoDaPartidaSnapshot {
  const peoes =
    peoesDoTabuleiro ??
    jogadores.map((j) => ({
      peaoId: j.peaoId,
      cor: j.cor,
      pecaId: null,
    }))
  return {
    tabuleiro: {
      posicionadas: [],
      iniciais: [],
      peoes,
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 83,
    },
    jogadores,
    jogadorAtivoId: jogadores[0]?.jogadorId ?? 'j1',
    rodada: 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
  } as unknown as EstadoDaPartidaSnapshot
}
