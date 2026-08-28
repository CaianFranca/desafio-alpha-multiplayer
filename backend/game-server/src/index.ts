import http from 'node:http';
import { getConfig } from '@flicker/config';
import type { ServerId } from '@flicker/shared';
import { createApp } from './app.ts';
import { criarWebSocketServer } from './ws/ws.ts';
import { redisClient } from './config/redis.ts';
import type { ContextoDoGameServer } from './contexto.ts';
import {
  iniciarHeartbeat,
  pararHeartbeat,
  removerRegistro,
  resolverServerId,
  type GameServerRegistro,
  type HeartbeatHandle,
} from './redis/registro.ts';

const { gameServerPort, partidaPreparadaTtlSegundos, gameServerHeartbeatIntervalMs, gameServerHeartbeatTtlMs, gameServerId: configServerId, jwtSecret } = getConfig();
const serverId: ServerId = resolverServerId(configServerId) as ServerId;
const contexto: ContextoDoGameServer = { redis: redisClient, serverId, jwtSecret, partidaPreparadaTtlSegundos };
const app = createApp(contexto);

const server = http.createServer(app);

criarWebSocketServer(server, contexto);

let heartbeatHandle: HeartbeatHandle | undefined;
let registroRetry: NodeJS.Timeout | undefined;
let encerrando = false;

function criarMeta(): GameServerRegistro {
  return {
    serverId,
    url: `http://game-server:${gameServerPort}`,
    host: 'game-server',
    port: gameServerPort,
    atualizadoEm: new Date().toISOString(),
  };
}

async function iniciarRegistro(): Promise<void> {
  if (encerrando) return;
  try {
    if (redisClient.status !== 'ready') {
      try {
        await redisClient.connect();
      } catch {
        // connect falhou (close/end/reconnecting) — ping retry abaixo vai tratar
      }
    }
    await redisClient.ping();
    console.log('[game-server] redis conectado');
    if (registroRetry) {
      clearTimeout(registroRetry);
      registroRetry = undefined;
    }
  } catch (error) {
    console.warn('[game-server] redis ainda não disponível:', (error as Error).message);
    if (!encerrando) {
      if (registroRetry) clearTimeout(registroRetry);
      registroRetry = setTimeout(() => void iniciarRegistro(), 2000);
      registroRetry.unref?.();
    }
    return;
  }

  const meta = criarMeta();
  heartbeatHandle = iniciarHeartbeat(redisClient, meta, gameServerHeartbeatIntervalMs, gameServerHeartbeatTtlMs, criarMeta);
  console.log(`[game-server] heartbeat iniciado interval=${gameServerHeartbeatIntervalMs}ms`);
}

server.listen(gameServerPort, () => {
  console.log(`[game-server] serverId: ${serverId}`);
  console.log(`[game-server] listening on http://localhost:${gameServerPort} id=${serverId}`);
  void iniciarRegistro();
});

function encerrar(signal: string): void {
  if (encerrando) return;
  encerrando = true;
  console.log(`[game-server] ${signal} recebido, encerrando...`);
  if (registroRetry) {
    clearTimeout(registroRetry);
    registroRetry = undefined;
  }
  if (heartbeatHandle) {
    pararHeartbeat(heartbeatHandle);
    heartbeatHandle = undefined;
  }
  let finalizado = false;
  const finalizar = (): void => {
    if (finalizado) return;
    finalizado = true;
    if (server.listening) {
      server.close(() => {
        void redisClient.quit().finally(() => process.exit(0));
      });
    } else {
      void redisClient.quit().finally(() => process.exit(0));
    }
  };
  void removerRegistro(redisClient, serverId)
    .catch((err: unknown) => {
      console.warn('[game-server] falha ao remover registro:', (err as Error).message);
    })
    .finally(finalizar);

  // Fallback: força encerramento se removerRegistro travar
  setTimeout(finalizar, 2000).unref();
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
