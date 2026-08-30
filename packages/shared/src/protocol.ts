// Protocolo WS mínimo do stub (ADR-0001).
// Tipos de mensagem compartilhados via @flicker/shared, tipados de um lado só.

import type { SalaComandoDoCliente, SalaEventoDoServidor } from './sala.ts';
import type { EncaminhamentoEventoDoServidor, PartidaId } from './encaminhamento.ts';
import type { TabuleiroComandoDoCliente, TabuleiroEventoDoServidor } from './tabuleiro.ts';
import type { PeaoComandoDoCliente, PeaoEventoDoServidor } from './peoes.ts';

export interface PingMessage {
  type: 'PING';
}

export interface PongMessage {
  type: 'PONG';
}

export type SalaClientMessage =
  | SalaComandoDoCliente
  | TabuleiroComandoDoCliente
  | PeaoComandoDoCliente;
export type SalaServerMessage =
  | SalaEventoDoServidor
  | EncaminhamentoEventoDoServidor
  | TabuleiroEventoDoServidor
  | PeaoEventoDoServidor;

export type ClientMessage = PingMessage | SalaClientMessage;

export type ServerMessage = PongMessage | SalaServerMessage | AdmissaoEventoDoServidor;
