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
} from './tabuleiro.ts';
import type {
  BordaCardinal,
  PeaoId,
  RecebidaId,
  TipoDePecaDeCaminho,
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

// --- Eventos servidor → cliente (3) ---

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

// --- Snapshot wire (ST-14) — projeção tipada sem runtime ---

export type EstadoDaPartidaWire = 'preparada' | 'em_andamento';

export type CorDoPeaoWire = 'branco' | 'vermelho' | 'azul' | 'amarelo';

export type TipoDaPecaWire =
  | 'inicial'
  | TipoDePecaDeCaminho
  | 'gerador'
  | 'sala_do_diretor'
  | 'sala_medica'
  | 'portao_de_saida';

export interface JogadorNoSnapshot {
  readonly jogadorId: string;
  readonly apelido: string;
  readonly cor: CorDoPeaoWire;
  readonly ordem: number;
  readonly peaoId: PeaoId;
  readonly primeiroTurnoPendente: boolean;
}

export interface PecaPosicionadaNoSnapshot {
  readonly pecaId: PecaId;
  readonly tipo: TipoDaPecaWire;
  readonly orientacao: Orientacao;
  readonly celula: Celula;
}

export interface PecaInicialNoSnapshot {
  readonly pecaId: PecaId;
  readonly tipo: 'inicial';
  readonly orientacao: Orientacao;
}

export interface PeaoNoSnapshot {
  readonly peaoId: PeaoId;
  readonly cor: CorDoPeaoWire;
  readonly pecaId: PecaId | null;
}

export interface RecebidaNoSnapshot {
  readonly recebidaId: RecebidaId;
  readonly bordaGeradora: BordaCardinal;
  readonly celulaAlvo: Celula;
  readonly pecaId: PecaId | null;
  readonly tipo: TipoDePecaDeCaminho | null;
  readonly orientacao: Orientacao;
}

export interface TabuleiroNoSnapshot {
  readonly posicionadas: readonly PecaPosicionadaNoSnapshot[];
  readonly iniciais: readonly PecaInicialNoSnapshot[];
  readonly peoes: readonly PeaoNoSnapshot[];
  readonly recebidas: readonly RecebidaNoSnapshot[];
  readonly pecaSelecionadaId: PecaId | null;
  readonly pecaEmManipulacaoId: PecaId | null;
  readonly peaoSelecionadoId: PeaoId | null;
}

export interface EstadoDaPartidaSnapshot {
  readonly tabuleiro: TabuleiroNoSnapshot;
  readonly jogadores: readonly JogadorNoSnapshot[];
  readonly jogadorAtivoId: string;
  readonly rodada: number;
  readonly pecaDoInicioDoTurnoId: PecaId | null;
  readonly posicaoConfirmada: boolean;
  readonly celulasIluminadas: readonly Celula[];
  readonly estado: EstadoDaPartidaWire;
}

export interface PartidaIniciadaEvento {
  readonly type: 'PARTIDA_INICIADA';
  readonly partidaId: string;
}

export interface EstadoDaPartidaEvento {
  readonly type: 'ESTADO_DA_PARTIDA';
  readonly snapshot: EstadoDaPartidaSnapshot;
}

export type PartidaEventoDoServidor =
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento
  | PartidaIniciadaEvento
  | EstadoDaPartidaEvento;

// --- Erro ---
// Alias documentativo — os 5 códigos de turno vivem em CodigoDeErroDoTabuleiro (./tabuleiro.ts:116-120)
// e viajam via ERRO_DO_TABULEIRO (SalaServerMessage via TabuleiroEventoDoServidor).
export type CodigoDeErroDaPartida = CodigoDeErroDoTabuleiro;
