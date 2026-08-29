// Protocolo WS mínimo do stub (ADR-0001).
// Tipos de mensagem compartilhados via @flicker/shared, tipados de um lado só.

import type { SalaComandoDoCliente, SalaEventoDoServidor } from './sala.ts';
import type { EncaminhamentoEventoDoServidor, PartidaId } from './encaminhamento.ts';
import type { TabuleiroComandoDoCliente, TabuleiroEventoDoServidor } from './tabuleiro.ts';

export interface PingMessage {
  type: 'PING';
}

export interface PongMessage {
  type: 'PONG';
}

// --- Admissão (game-server WS) ---

export interface AdmissaoAceitaEvento {
  readonly type: 'ADMISSAO_ACEITA';
  readonly jogadorId: string;
  readonly apelido: string;
  readonly partidaId: PartidaId;
}

export type CodigoDeErroDeAdmissao =
  | 'SESSAO_INVALIDA'
  | 'SERVER_ID_INVALIDO'
  | 'PARTIDA_NAO_ENCONTRADA'
  | 'JOGADOR_FORA_DO_ROSTER'
  | 'PARTIDA_ID_AUSENTE';

export interface AdmissaoRejeitadaEvento {
  readonly type: 'ADMISSAO_REJEITADA';
  readonly codigo: CodigoDeErroDeAdmissao;
  readonly motivo: string;
}

export type AdmissaoEventoDoServidor = AdmissaoAceitaEvento | AdmissaoRejeitadaEvento;

// --- Union types ---
export type SalaClientMessage = SalaComandoDoCliente | TabuleiroComandoDoCliente;
export type SalaServerMessage =
  | SalaEventoDoServidor
  | EncaminhamentoEventoDoServidor
  | TabuleiroEventoDoServidor;

export type ClientMessage = PingMessage | SalaClientMessage;

export type ServerMessage = PongMessage | SalaServerMessage | AdmissaoEventoDoServidor;
