// Protocolo WS mínimo do stub (ADR-0001).
// Tipos de mensagem compartilhados via @flicker/shared, tipados de um lado só.

import type { SalaComandoDoCliente, SalaEventoDoServidor } from './sala.ts';
import type { EncaminhamentoEventoDoServidor } from './encaminhamento.ts';

export interface PingMessage {
  type: 'PING';
}

export interface PongMessage {
  type: 'PONG';
}

export type SalaClientMessage = SalaComandoDoCliente;
export type SalaServerMessage = SalaEventoDoServidor | EncaminhamentoEventoDoServidor;

export type ClientMessage = PingMessage | SalaClientMessage;

export type ServerMessage = PongMessage | SalaServerMessage;
