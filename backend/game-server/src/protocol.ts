// Protocolo WS mínimo do game-server (stub).
// Referência inicial para o futuro packages/shared (ADR-0001).

export interface PingMessage {
  type: 'PING';
}

export interface PongMessage {
  type: 'PONG';
}

export type ClientMessage = PingMessage;

export type ServerMessage = PongMessage;