import type { Redis } from 'ioredis';
import { chaveDaPartida } from './chaves.ts';
import { cancelarPartida, obterPartida } from './partidas.ts';
import type { AvisoDeRetorno } from '../retorno/cliente.ts';

const ABANDONO_IMEDIATO_MS = 10_000;
const timers = new Map<string, NodeJS.Timeout>();
let notificarRetorno: ((aviso: AvisoDeRetorno) => Promise<void>) | undefined;
let abandonoSegundos = 90;

export function configurarAbandono(
  notificador: ((aviso: AvisoDeRetorno) => Promise<void>) | undefined,
  segundos: number,
): void {
  notificarRetorno = notificador;
  abandonoSegundos = segundos;
}

export function agendarAbandono(partidaId: string, delayMs?: number): void {
  cancelarAbandono(partidaId);
  const ms = delayMs ?? abandonoSegundos * 1000;
  const timer = setTimeout(() => {
    timers.delete(partidaId);
    void verificarEAbandonarSeNecessario(globalRedis!, partidaId);
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(partidaId, timer);
}

export function cancelarAbandono(partidaId: string): void {
  const t = timers.get(partidaId);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(partidaId);
  }
}

let globalRedis: Redis | undefined;
let globalBroadcaster: { encerrarPorAbandono(partidaId: string, code?: number, reason?: string): void } | undefined;
export function definirRedisParaAbandono(redis: Redis): void {
  globalRedis = redis;
}
export function definirBroadcasterParaAbandono(broadcaster: { encerrarPorAbandono(partidaId: string, code?: number, reason?: string): void }): void {
  globalBroadcaster = broadcaster;
}

async function verificarEAbandonarSeNecessario(redis: Redis, partidaId: string): Promise<boolean> {
  const partida = await obterPartida(redis, partidaId as never);
  if (partida === null) return false;
  if (partida.estado !== 'preparada') return false;
  const idadeMs = Date.now() - Date.parse(partida.criadaEm);
  const todosEmReconexao = partida.roster.every((m) => m.presenca === 'em_reconexao');
  // Abandono preparada: se todos em_reconexao → abandono imediato (10s já agendado),
  // senão se ainda não expirou 90s → reagenda restante, senão (idade >= 90s) abandona mesmo com 1-3 conectados parciais.
  // Parcial <90s mantém SALA_ENCAMINHADA no lobby; teto é comportamento desejado (#222).
  if (!todosEmReconexao && idadeMs < abandonoSegundos * 1000) {
    const restante = abandonoSegundos * 1000 - idadeMs;
    agendarAbandono(partidaId, restante);
    return false;
  }
  const partidaIdTyped = partida.partidaId as string;
  try {
    globalBroadcaster?.encerrarPorAbandono(partidaIdTyped, 4000, 'PARTIDA_ABANDONADA');
  } catch {}
  const cancelada = await cancelarPartida(redis, partidaIdTyped as never);
  if (!cancelada) return false;
  cancelarAbandono(partidaIdTyped);
  if (notificarRetorno !== undefined) {
    const aviso: AvisoDeRetorno = {
      salaId: partida.salaId,
      partidaId: partida.partidaId,
      serverId: partida.serverId,
      resultado: 'abandono',
      jogadores: partida.roster.map((m) => m.jogadorId),
    };
    try {
      await notificarRetorno(aviso);
    } catch (err) {
      console.error('[abandono] falha ao notificar retorno', { partidaId, erro: (err as Error).message });
    }
  } else {
    console.info('[abandono] partida abandonada sem notificador', { partidaId });
  }
  console.info('[abandono] partida abandonada cancelada', { partidaId, salaId: partida.salaId });
  return true;
}

export async function verificarAbandonoAposDesconexao(redis: Redis, partidaId: string): Promise<void> {
  const partida = await obterPartida(redis, partidaId as never);
  if (partida === null) return;
  if (partida.estado !== 'preparada') return;
  const todosEmReconexao = partida.roster.every((m) => m.presenca === 'em_reconexao');
  if (!todosEmReconexao) return;
  agendarAbandono(partidaId, ABANDONO_IMEDIATO_MS);
}

export async function rearmarAbandonosAposRestart(redis: Redis): Promise<void> {
  globalRedis = redis;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'game-server:partida:*', 'COUNT', 100);
      cursor = next;
      for (const key of keys) {
        if (key.startsWith('game-server:partida-estado:')) continue;
        const raw = await redis.get(key);
        if (raw === null) continue;
        try {
          const partida = JSON.parse(raw) as { partidaId: string; estado: string; criadaEm: string; roster?: unknown[] };
          if (partida.estado !== 'preparada') continue;
          const idadeMs = Date.now() - Date.parse(partida.criadaEm);
          const ttl = await redis.ttl(key);
          if (ttl === -2) continue;
          const todosEmReconexao = (partida.roster as Array<{ presenca: string }> | undefined)?.every((m) => m.presenca === 'em_reconexao') ?? false;
          if (todosEmReconexao) {
            agendarAbandono(partida.partidaId, ABANDONO_IMEDIATO_MS);
            continue;
          }
          if (idadeMs >= abandonoSegundos * 1000) {
            if ((partida.roster as unknown[] | undefined)?.length === 0) {
              void verificarEAbandonarSeNecessario(redis, partida.partidaId);
            } else {
              agendarAbandono(partida.partidaId, 5000);
            }
          } else {
            const restante = abandonoSegundos * 1000 - idadeMs;
            agendarAbandono(partida.partidaId, restante);
          }
        } catch {}
      }
    } while (cursor !== '0');
  } catch (err) {
    console.error('[abandono] falha ao rearmar abandonos', { erro: (err as Error).message });
  }
}
