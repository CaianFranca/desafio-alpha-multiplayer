import type { Server } from 'node:http';
import { WebSocketServer, type RawData } from 'ws';
import type { ClientMessage, ServerMessage } from './protocol.ts';

export function createWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket, request) => {
    console.log(`[ws] connect: ${request.socket.remoteAddress}`);

    socket.on('error', (error) => {
      console.error('[ws] error:', error.message);
    });

    socket.on('message', (data, isBinary) => {
      const reply = handleMessage(data);
      if (reply) {
        socket.send(JSON.stringify(reply), { binary: isBinary });
      }
    });

    socket.on('close', () => {
      console.log('[ws] disconnect');
    });
  });

  return wss;
}

function handleMessage(data: RawData): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    return null;
  }
  if (!isClientMessage(parsed)) {
    return null;
  }

  switch (parsed.type) {
    case 'PING':
      return { type: 'PONG' };
  }
}

function isClientMessage(value: unknown): value is ClientMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'PING'
  );
}