// Protocolo WS mínimo do stub (ADR-0001).
// Tipos de mensagem compartilhados via @flicker/shared, tipados de um lado só.

export interface PingMessage {
  type: 'PING';
}

export interface PongMessage {
  type: 'PONG';
}

export type ClientMessage = PingMessage;

export type ServerMessage = PongMessage;
