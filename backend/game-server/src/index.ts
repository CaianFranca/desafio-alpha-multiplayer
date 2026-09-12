import http from 'node:http';
import { getConfig } from '@flicker/config';
import type { ServerId } from '@flicker/shared';
import { createApp } from './app.ts';
import { criarWebSocketServer } from './ws/ws.ts';
import { DebugStreamDaPartida } from './ws/debug-stream.ts';
import { redisClient } from './config/redis.ts';
import { PartidaBroadcaster } from './partidas/broadcast.ts';
import { PartidaHandlers } from './partidas/handlers.ts';
import type { ContextoDoGameServer } from './contexto.ts';
import { criarClienteDeRetorno, criarClienteDeDesistencia } from './retorno/cliente.ts';
import { configurarNaoInicio, definirBroadcasterParaNaoInicio, definirRedisParaNaoInicio, rearmarNaoInicioAposRestart } from './partidas/nao-inicio.ts';
import {
  iniciarHeartbeat,
  pararHeartbeat,
  removerRegistro,
  resolverServerId,
  type GameServerRegistro,
  type HeartbeatHandle,
} from './redis/registro.ts';

const {
  gameServerPort,
  partidaPreparadaTtlSegundos,
  partidaTerminadaTtlSegundos,
  partidaNaoInicioSegundos,
  lobbyRetornoCallbackUrl,
  lobbyDesistenciaCallbackUrl,
  gameServerHeartbeatIntervalMs,
  gameServerHeartbeatTtlMs,
  gameServerId: configServerId,
  gameServerAdvertiseHost,
  jwtSecret,
} = getConfig();
const serverId: ServerId = resolverServerId(configServerId) as ServerId;
const contexto: ContextoDoGameServer = {
  redis: redisClient,
  serverId,
  jwtSecret,
  partidaPreparadaTtlSegundos,
  partidaNaoInicioSegundos,
  partidaTerminadaTtlSegundos,
  lobbyRetornoCallbackUrl,
  lobbyDesistenciaCallbackUrl,
};
const app = createApp(contexto);

const server = http.createServer(app);

const notificarRetorno = criarClienteDeRetorno({
  lobbyRetornoCallbackUrl,
  jwtSecret,
});
const notificarDesistencia = criarClienteDeDesistencia({
  lobbyDesistenciaCallbackUrl,
  jwtSecret,
});
const broadcaster = new PartidaBroadcaster();
const streamDeDebug = new DebugStreamDaPartida();
const handlers = new PartidaHandlers({
  redis: redisClient,
  broadcaster,
  partidaTerminadaTtlSegundos,
  notificarRetorno,
  notificarDesistencia,
  debug: streamDeDebug,
});
configurarNaoInicio(notificarRetorno, partidaNaoInicioSegundos);
definirRedisParaNaoInicio(redisClient);
definirBroadcasterParaNaoInicio(broadcaster);

criarWebSocketServer(server, contexto, {
  partida: { broadcaster, handlers, debug: streamDeDebug },
});

let heartbeatHandle: HeartbeatHandle | undefined;
let registroRetry: NodeJS.Timeout | undefined;
let encerrando = false;

function criarMeta(): GameServerRegistro {
  return {
    serverId,
    url: `http://${gameServerAdvertiseHost}:${gameServerPort}`,
    host: gameServerAdvertiseHost,
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
  void rearmarNaoInicioAposRestart(redisClient).catch((err: unknown) =>
    console.warn('[game-server] falha ao rearmar não-início:', (err as Error).message),
  );
}

server.listen(gameServerPort, () => {
  console.log(`[game-server] serverId: ${serverId}`);
  console.log(`[game-server] listening on http://localhost:${gameServerPort} id=${serverId}`);
  void iniciarRegistro();
});

async function encerrar(signal: string): Promise<void> {
  if (encerrando) return;
  encerrando = true;
  console.log(`[game-server] ${signal} recebido, encerrando...`);
  try {
    // B3 (issue #290): aguarda detach/retorno em voo (até 5s) ANTES de
    // fechar — sem o await, o fallback abaixo matava o processo e o
    // desistente não ficava livre / o retorno se perdia no deploy.
    await handlers.drenarRetornosPendentes(5000);
  } catch (err: unknown) {
    console.warn('[game-server] falha ao drenar retornos pendentes:', (err as Error).message);
  }
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

  // Fallback: força encerramento se removerRegistro travar (acima do teto do
  // drain para não matar callbacks em voo).
  setTimeout(finalizar, 6000).unref();
}

process.on('SIGTERM', () => void encerrar('SIGTERM'));
process.on('SIGINT', () => void encerrar('SIGINT'));
