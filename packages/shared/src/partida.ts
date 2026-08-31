// Protocolo WS da Partida — Turnos e loop — DTOs tipados compartilhados via @flicker/shared.
// Vocabulário canônico: Jogador Ativo, Turno, Rodada, Passagem de Vez, Primeiro Turno, Confirmação de Posição, Encerramento do Turno (CONTEXT.md:179-207).
// Apenas type/interface, sem runtime, sem validação, sem dependência de @flicker/engine.
//
// Fronteira shared (DTO de transporte) vs engine (domínio): propositalmente
// divergem para desacoplar wire do modelo interno. Sync manual quando engine evolui.
//   Comandos (shared wire + jogadorId <-> engine tipo + ator):
//   shared type:'SELECIONAR_PECA' + jogadorId <-> engine tipo:'selecionar_peca' + ator
//   shared type:'GIRAR_PECA' + jogadorId <-> engine tipo:'girar_peca' + ator
//   shared type:'POSICIONAR_PECA' + jogadorId <-> engine tipo:'posicionar_peca' + ator
//   shared type:'FINALIZAR_MANIPULACAO' + jogadorId <-> engine tipo:'finalizar_manipulacao' + ator
//   shared type:'SELECIONAR_PEAO' + jogadorId <-> engine tipo:'selecionar_peao' + ator
//   shared type:'POSICIONAR_PEAO' + jogadorId <-> engine tipo:'posicionar_peao' + ator
//   shared type:'ESCOLHER_VAGA_DA_PECA_RECEBIDA' + jogadorId <-> engine tipo:'escolher_vaga_da_peca_recebida' + ator — issue #138
//   shared type:'ESCOLHER_TIPO_DA_PECA_RECEBIDA' + jogadorId <-> engine tipo:'escolher_tipo_da_peca_recebida' + ator — legado ST-10, removido do domínio pela #138 (limpeza wire na #140/#143)
//   shared type:'MOVER_PEAO' + jogadorId <-> engine tipo:'mover_peao' + ator
//   shared type:'PERMANECER' + jogadorId <-> engine tipo:'permanecer' + ator
//   shared type:'CONFIRMAR_POSICAO_DO_PEAO' + jogadorId <-> engine tipo:'confirmar_posicao_do_peao' + ator
//   shared type:'ENCERRAR_TURNO' + jogadorId <-> engine tipo:'encerrar_turno' + ator
//   Eventos:
//   shared type:'TURNO_INICIADO' { jogadorId, rodada } <-> engine tipo:'turno_iniciado' { jogadorId, rodada }
//   shared type:'TURNO_ENCERRADO' { jogadorId } <-> engine tipo:'turno_encerrado' { jogadorId }
//   shared type:'POSICAO_CONFIRMADA' { jogadorId, peaoId, pecaId } <-> engine tipo:'posicao_confirmada' { jogadorId, peaoId, pecaId }
//   shared type:'PECA_SORTEADA' { pecaId, tipoDaPeca, orientacao } <-> engine tipo:'peca_sorteada' idem — emitido pelo Recebimento da #138 (e pelo sorteio unitário da Caixa)
//   shared type:'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO' { recebidaId, borda, celulaAlvo } <-> engine tipo:'vaga_da_peca_recebida_escolhida' idem — issue #138
//   (Estes dois eventos novos vivem nesta união, e não em
//   PeaoEventoDoServidor/TabuleiroEventoDoServidor, porque são o contrato do
//   canal de Partida — o canal alvo do ST-11 — e as uniões antigas têm
//   switches exaustivos no frontend legado, intocado pela #138.)
//   shared type:'CELULAS_ILUMINADAS' { celulas } <-> engine tipo:'celulas_iluminadas' { celulas }
//   shared type:'LIMPEZA_APLICADA' { pecasRemovidas } <-> engine tipo:'limpeza_aplicada' { pecasRemovidas }
//   Erros: CodigoDeErroDaPartida alias de CodigoDeErroDoTabuleiro (./tabuleiro.ts:116-120) — FORA_DA_VEZ etc via ERRO_DO_TABULEIRO (SalaServerMessage via TabuleiroEventoDoServidor).
//   shared type:UPPER_SNAKE no wire vs engine tipo:snake no domínio; campos em camelCase nos dois lados
//
// Reuso: importa PecaId de ./tabuleiro.ts e PeaoId de ./peoes.ts; não duplica tipos base.
// Sem runtime/validação/sem @flicker/engine — apenas DTOs.

import type {
  Celula,
  CodigoDeErroDoTabuleiro,
  Orientacao,
  PecaId,
  SentidoDeRotacao,
  TipoDePecaDaCaixa,
} from './tabuleiro.ts';
import type {
  PeaoId,
  RecebidaId,
  BordaCardinal,
  TipoDePecaDeCaminho,
  VagaDaPecaRecebidaEscolhidaEvento,
} from './peoes.ts';

// --- Comandos cliente → servidor (11) ---

export interface SelecionarPecaPartidaComando {
  readonly type: 'SELECIONAR_PECA';
  readonly jogadorId: string;
  readonly pecaId: PecaId;
}

export interface GirarPecaPartidaComando {
  readonly type: 'GIRAR_PECA';
  readonly jogadorId: string;
  readonly pecaId: PecaId;
  readonly sentido: SentidoDeRotacao;
}

export interface PosicionarPecaPartidaComando {
  readonly type: 'POSICIONAR_PECA';
  readonly jogadorId: string;
  readonly pecaId: PecaId;
  readonly celula: Celula;
}

export interface FinalizarManipulacaoPartidaComando {
  readonly type: 'FINALIZAR_MANIPULACAO';
  readonly jogadorId: string;
}

export interface SelecionarPeaoPartidaComando {
  readonly type: 'SELECIONAR_PEAO';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
}

export interface PosicionarPeaoPartidaComando {
  readonly type: 'POSICIONAR_PEAO';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
  readonly celula: Celula;
}

/**
 * Escolha do tipo da Recebida (legado ST-10).
 *
 * @deprecated O domínio #138 removeu a escolha de tipo: o cliente escolhe a
 * VAGA de cada peça já sorteada (EscolherVagaDaPecaRecebidaPartidaComando).
 * Permanece na união até a limpeza do wire legado (#140/#143).
 */
export interface EscolherTipoDaPecaRecebidaPartidaComando {
  readonly type: 'ESCOLHER_TIPO_DA_PECA_RECEBIDA';
  readonly jogadorId: string;
  readonly recebidaId: RecebidaId;
  readonly tipoDaPeca: TipoDePecaDeCaminho;
}

// Escolha da vaga (issue #138): uma escolha POR peça sorteada — a borda
// indicada deve ser uma vaga disponível da Peça sob o Peão selecionado.
export interface EscolherVagaDaPecaRecebidaPartidaComando {
  readonly type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA';
  readonly jogadorId: string;
  readonly recebidaId: RecebidaId;
  readonly borda: BordaCardinal;
}

export interface MoverPeaoPartidaComando {
  readonly type: 'MOVER_PEAO';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
  readonly celula: Celula;
}

export interface PermanecerPartidaComando {
  readonly type: 'PERMANECER';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
}

export interface ConfirmarPosicaoDoPeaoComando {
  readonly type: 'CONFIRMAR_POSICAO_DO_PEAO';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
}

export interface EncerrarTurnoComando {
  readonly type: 'ENCERRAR_TURNO';
  readonly jogadorId: string;
}

export type PartidaComandoDoCliente =
  | SelecionarPecaPartidaComando
  | GirarPecaPartidaComando
  | PosicionarPecaPartidaComando
  | FinalizarManipulacaoPartidaComando
  | SelecionarPeaoPartidaComando
  | PosicionarPeaoPartidaComando
  | EscolherVagaDaPecaRecebidaPartidaComando
  | MoverPeaoPartidaComando
  | PermanecerPartidaComando
  | ConfirmarPosicaoDoPeaoComando
  | EncerrarTurnoComando
  // Legado ST-10, fora do domínio desde a #138 (limpeza na #140/#143).
  | EscolherTipoDaPecaRecebidaPartidaComando;

// --- Eventos servidor → cliente (5 + 2 da issue #138) ---

export interface TurnoIniciadoEvento {
  readonly type: 'TURNO_INICIADO';
  readonly jogadorId: string;
  readonly rodada: number;
}

export interface TurnoEncerradoEvento {
  readonly type: 'TURNO_ENCERRADO';
  readonly jogadorId: string;
}

export interface PosicaoConfirmadaEvento {
  readonly type: 'POSICAO_CONFIRMADA';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
  readonly pecaId: PecaId;
}

// Uma peça retirada da Caixa por sorteio (issue #138: uma por peça do
// Recebimento; a primitiva unitária sortearDaCaixa também a emite).
export interface PecaSorteadaEvento {
  readonly type: 'PECA_SORTEADA';
  readonly pecaId: PecaId;
  readonly tipoDaPeca: TipoDePecaDaCaixa;
  readonly orientacao: Orientacao;
}

// Reexportado de ./peoes.ts (conceito de Recebida): a escolha da vaga fixa a
// borda e a célula-alvo da pendência e seleciona a Peça sorteada.
export type { VagaDaPecaRecebidaEscolhidaEvento };

export interface CelulasIluminadasEvento {
  readonly type: 'CELULAS_ILUMINADAS';
  readonly celulas: readonly { readonly linha: number; readonly coluna: number }[];
}

export interface LimpezaAplicadaWireEvento {
  readonly type: 'LIMPEZA_APLICADA';
  readonly pecasRemovidas: readonly string[];
}

export type PartidaEventoDoServidor =
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento
  | CelulasIluminadasEvento
  | LimpezaAplicadaWireEvento
  | PecaSorteadaEvento
  | VagaDaPecaRecebidaEscolhidaEvento;

// --- Erro ---
// Alias documentativo — os 5 códigos de turno vivem em CodigoDeErroDoTabuleiro (./tabuleiro.ts:116-120)
// e viajam via ERRO_DO_TABULEIRO (SalaServerMessage via TabuleiroEventoDoServidor).
export type CodigoDeErroDaPartida = CodigoDeErroDoTabuleiro;
