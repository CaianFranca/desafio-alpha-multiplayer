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
//   shared type:'ESCOLHER_TIPO_DA_PECA_RECEBIDA' + jogadorId <-> engine tipo:'escolher_tipo_da_peca_recebida' + ator
//   shared type:'MOVER_PEAO' + jogadorId <-> engine tipo:'mover_peao' + ator
//   shared type:'PERMANECER' + jogadorId <-> engine tipo:'permanecer' + ator
//   shared type:'CONFIRMAR_POSICAO_DO_PEAO' + jogadorId <-> engine tipo:'confirmar_posicao_do_peao' + ator
//   shared type:'ENCERRAR_TURNO' + jogadorId <-> engine tipo:'encerrar_turno' + ator
//   Eventos:
//   shared type:'TURNO_INICIADO' { jogadorId, rodada } <-> engine tipo:'turno_iniciado' { jogadorId, rodada }
//   shared type:'TURNO_ENCERRADO' { jogadorId } <-> engine tipo:'turno_encerrado' { jogadorId }
//   shared type:'POSICAO_CONFIRMADA' { jogadorId, peaoId, pecaId } <-> engine tipo:'posicao_confirmada' { jogadorId, peaoId, pecaId }
//   shared type:'CELULAS_ILUMINADAS' { celulas } <-> engine tipo:'celulas_iluminadas' { celulas }
//   shared type:'LIMPEZA_APLICADA' { pecasRemovidas } <-> engine tipo:'limpeza_aplicada' { pecasRemovidas }
//   Erros: CodigoDeErroDaPartida alias de CodigoDeErroDoTabuleiro (./tabuleiro.ts:116-120) — FORA_DA_VEZ etc via ERRO_DO_TABULEIRO (SalaServerMessage via TabuleiroEventoDoServidor).
//   shared type:UPPER_SNAKE no wire vs engine tipo:snake no domínio; campos em camelCase nos dois lados
//
// Reuso: importa PecaId de ./tabuleiro.ts e PeaoId de ./peoes.ts; não duplica tipos base.
// Sem runtime/validação/sem @flicker/engine — apenas DTOs.

import type { Celula, CodigoDeErroDoTabuleiro, PecaId, SentidoDeRotacao } from './tabuleiro.ts';
import type { PeaoId, RecebidaId, TipoDePecaDeCaminho } from './peoes.ts';

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

export interface EscolherTipoDaPecaRecebidaPartidaComando {
  readonly type: 'ESCOLHER_TIPO_DA_PECA_RECEBIDA';
  readonly jogadorId: string;
  readonly recebidaId: RecebidaId;
  readonly tipoDaPeca: TipoDePecaDeCaminho;
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
  | EscolherTipoDaPecaRecebidaPartidaComando
  | MoverPeaoPartidaComando
  | PermanecerPartidaComando
  | ConfirmarPosicaoDoPeaoComando
  | EncerrarTurnoComando;

// --- Eventos servidor → cliente (5) ---

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
  | LimpezaAplicadaWireEvento;

// --- Erro ---
// Alias documentativo — os 5 códigos de turno vivem em CodigoDeErroDoTabuleiro (./tabuleiro.ts:116-120)
// e viajam via ERRO_DO_TABULEIRO (SalaServerMessage via TabuleiroEventoDoServidor).
export type CodigoDeErroDaPartida = CodigoDeErroDoTabuleiro;
