import type { Redis } from 'ioredis';
import { chaveDaPartida } from './chaves.ts';
import { cancelarPartida, obterPartida } from './partidas.ts';
import type { AvisoDeRetorno } from '../retorno/cliente.ts';

const NAO_INICIO_IMEDIATO_MS = 10_000;
// Anti-thundering-herd (A1): o rearme pós-restart reagenda N partidas de uma
// vez; sem dispersão, as expirações simultâneas atingem a fila mononodo do
// lobby em rajada (timeout 5s → 503 → retry amplifica).
const JITTER_REARME_MS = 5_000;
const REARME_SCAN_COUNT = 500;
const REARME_ROSTER_VAZIO_MS = 1_000;
const REARME_TETO_MS = 5_000;

function jitterAte(maxMs: number): number {
  return Math.floor(Math.random() * (maxMs + 1));
}

// Pipeline mínimo usado no rearme (A2): GET + TTL por chave em 1 RTT.
// Mantém o boot O(lotes) em vez de O(chaves) sob N partidas simultâneas.
interface PipelineDeLeitura {
  get(chave: string): unknown;
  ttl(chave: string): unknown;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

interface LinhaDoLote {
  readonly chave: string;
  readonly raw: string | null;
  readonly ttl: number;
}

async function lerLoteDoRearme(redis: Redis, chaves: string[]): Promise<LinhaDoLote[]> {
  const uteis = chaves.filter((chave) => !chave.startsWith('game-server:partida-estado:'));
  const fábrica = (redis as unknown as { pipeline?: unknown }).pipeline;
  if (typeof fábrica !== 'function') {
    // Fallback sequencial (ex.: fakes de teste sem pipeline).
    const lote: LinhaDoLote[] = [];
    for (const chave of uteis) {
      lote.push({ chave, raw: await redis.get(chave), ttl: await redis.ttl(chave) });
    }
    return lote;
  }
  const pipeline = (fábrica as () => PipelineDeLeitura).call(redis);
  for (const chave of uteis) {
    pipeline.get(chave);
    pipeline.ttl(chave);
  }
  const respostas = (await pipeline.exec()) ?? [];
  return uteis.map((chave, i) => ({
    chave,
    raw: (respostas[i * 2]?.[1] as string | null) ?? null,
    ttl: Number(respostas[i * 2 + 1]?.[1] ?? -2),
  }));
}
const timers = new Map<string, NodeJS.Timeout>();
// Teto de reagendamentos sem wiring (N1): sem Redis o fire reagenda em vez de
// explodir, mas não para sempre — após o teto, erra alto e para.
const MAX_REAGENDAMENTOS_SEM_REDIS = 5;
const reagendamentosSemRedis = new Map<string, number>();
let notificarRetorno: ((aviso: AvisoDeRetorno) => Promise<void>) | undefined;
let naoInicioSegundos = 90;

export function configurarNaoInicio(
  notificador: ((aviso: AvisoDeRetorno) => Promise<void>) | undefined,
  segundos: number,
): void {
  notificarRetorno = notificador;
  naoInicioSegundos = segundos;
}

export function agendarNaoInicio(partidaId: string, delayMs?: number, redis?: Redis): void {
  cancelarNaoInicio(partidaId);
  const ms = delayMs ?? naoInicioSegundos * 1000;
  const timer = setTimeout(() => {
    timers.delete(partidaId);
    const client = redis ?? globalRedis;
    if (client === undefined) {
      // Sem wiring de Redis (ex.: inversão futura): reagenda em vez de
      // explodir em promise void e perder o não-início em silêncio — até o
      // teto, depois erra alto e para em vez de girar para sempre.
      const tentativas = (reagendamentosSemRedis.get(partidaId) ?? 0) + 1;
      if (tentativas > MAX_REAGENDAMENTOS_SEM_REDIS) {
        reagendamentosSemRedis.delete(partidaId);
        console.error('[nao-inicio] sem redis após reagendamentos; verificação encerrada', { partidaId });
        return;
      }
      reagendamentosSemRedis.set(partidaId, tentativas);
      console.warn('[nao-inicio] sem redis para verificar; reagendando', { partidaId, tentativa: tentativas });
      agendarNaoInicio(partidaId, ms, redis);
      return;
    }
    reagendamentosSemRedis.delete(partidaId);
    void verificarNaoInicioSeNecessario(client, partidaId);
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(partidaId, timer);
}

export function cancelarNaoInicio(partidaId: string): void {
  const t = timers.get(partidaId);
  // Sem timer pendente (caso do reagendamento interno), preserva o contador
  // de tentativas; cancelamento explícito zera tudo.
  if (t === undefined) return;
  clearTimeout(t);
  timers.delete(partidaId);
  reagendamentosSemRedis.delete(partidaId);
}

let globalRedis: Redis | undefined;
let globalBroadcaster: { encerrarPorNaoInicio(partidaId: string, code?: number, reason?: string): void } | undefined;
export function definirRedisParaNaoInicio(redis: Redis | undefined): void {
  globalRedis = redis;
}
export function definirBroadcasterParaNaoInicio(broadcaster: { encerrarPorNaoInicio(partidaId: string, code?: number, reason?: string): void }): void {
  globalBroadcaster = broadcaster;
}

/** Exportado para testes de regressão (A3/A4): executa uma verificação imediata. */
export async function verificarNaoInicioSeNecessario(redis: Redis, partidaId: string): Promise<boolean> {
  const partida = await obterPartida(redis, partidaId as never);
  if (partida === null) return false;
  if (partida.estado !== 'preparada') return false;
  const idadeMs = Date.now() - Date.parse(partida.criadaEm);
  if (!Number.isFinite(idadeMs)) {
    console.warn('[nao-inicio] criadaEm inválida; não-início ignorado', { partidaId });
    return false;
  }
  const todosEmReconexao = partida.roster.every((m) => m.presenca === 'em_reconexao');
  // Não-início em preparada: se todos em_reconexao → não-início imediato (10s já agendado),
  // senão se ainda não expirou 90s → reagenda restante, senão (idade >= 90s) declara não-início mesmo com 1-3 conectados parciais.
  // Parcial <90s mantém SALA_ENCAMINHADA no lobby; teto é comportamento desejado (#222).
  if (!todosEmReconexao && idadeMs < naoInicioSegundos * 1000) {
    const restante = naoInicioSegundos * 1000 - idadeMs;
    agendarNaoInicio(partidaId, restante);
    return false;
  }
  const partidaIdTyped = partida.partidaId as string;
  const cancelada = await cancelarPartida(redis, partidaIdTyped as never);
  if (!cancelada) {
    // DEL falhou sob carga: não chuta os sockets (evita clientes caídos com
    // chave fantasma até o TTL); reagenda para a próxima verificação.
    agendarNaoInicio(partidaIdTyped);
    return false;
  }
  try {
    globalBroadcaster?.encerrarPorNaoInicio(partidaIdTyped, 4000, 'PARTIDA_NAO_INICIADA');
  } catch {}
  cancelarNaoInicio(partidaIdTyped);
  if (notificarRetorno !== undefined) {
    const aviso: AvisoDeRetorno = {
      salaId: partida.salaId,
      partidaId: partida.partidaId,
      serverId: partida.serverId,
      resultado: 'nao-inicio',
      jogadores: partida.roster.map((m) => m.jogadorId),
    };
    try {
      await notificarRetorno(aviso);
    } catch (err) {
      console.error('[nao-inicio] falha ao notificar retorno', { partidaId, erro: (err as Error).message });
    }
  } else {
    console.info('[nao-inicio] partida não iniciada sem notificador', { partidaId });
  }
  console.info('[nao-inicio] partida não iniciada cancelada', { partidaId, salaId: partida.salaId });
  return true;
}

export async function verificarNaoInicioAposDesconexao(redis: Redis, partidaId: string): Promise<void> {
  const partida = await obterPartida(redis, partidaId as never);
  if (partida === null) return;
  if (partida.estado !== 'preparada') return;
  const todosEmReconexao = partida.roster.every((m) => m.presenca === 'em_reconexao');
  if (!todosEmReconexao) return;
  agendarNaoInicio(partidaId, NAO_INICIO_IMEDIATO_MS);
}

export async function rearmarNaoInicioAposRestart(redis: Redis): Promise<void> {
  globalRedis = redis;
  let verificadas = 0;
  let reagendadas = 0;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'game-server:partida:*', 'COUNT', REARME_SCAN_COUNT);
      cursor = next;
      const lote = await lerLoteDoRearme(redis, keys);
      verificadas += keys.length;
      for (const linha of lote) {
        const raw = linha.raw;
        if (raw === null) continue;
        try {
          const partida = JSON.parse(raw) as { partidaId: string; estado: string; criadaEm: string; roster?: unknown[] };
          if (partida.estado !== 'preparada') continue;
          const idadeMs = Date.now() - Date.parse(partida.criadaEm);
          if (!Number.isFinite(idadeMs)) {
            console.warn('[nao-inicio] criadaEm inválida no rearme; partida ignorada', { chave: linha.chave });
            continue;
          }
          const ttl = linha.ttl;
          if (ttl === -2) continue;
          const todosEmReconexao = (partida.roster as Array<{ presenca: string }> | undefined)?.every((m) => m.presenca === 'em_reconexao') ?? false;
          if (todosEmReconexao) {
            agendarNaoInicio(partida.partidaId, NAO_INICIO_IMEDIATO_MS + jitterAte(JITTER_REARME_MS));
            reagendadas += 1;
            continue;
          }
          if (idadeMs >= naoInicioSegundos * 1000) {
            if ((partida.roster as unknown[] | undefined)?.length === 0) {
              agendarNaoInicio(partida.partidaId, REARME_ROSTER_VAZIO_MS + jitterAte(JITTER_REARME_MS));
            } else {
              agendarNaoInicio(partida.partidaId, REARME_TETO_MS + jitterAte(JITTER_REARME_MS));
            }
            reagendadas += 1;
          } else {
            // Ramo `restante`: já é naturalmente disperso (idade varia por
            // partida), então mantém o delay exato sem jitter para não
            // estourar o teto documentado de 90s.
            const restante = naoInicioSegundos * 1000 - idadeMs;
            agendarNaoInicio(partida.partidaId, restante);
            reagendadas += 1;
          }
        } catch {}
      }
      // Yield por lote: não monopoliza o event loop no boot com N partidas.
      await new Promise<void>((resolve) => setImmediate(resolve));
    } while (cursor !== '0');
    console.info('[nao-inicio] rearme concluído', { verificadas, reagendadas });
  } catch (err) {
    console.error('[nao-inicio] falha ao rearmar não-início', { erro: (err as Error).message });
  }
}
