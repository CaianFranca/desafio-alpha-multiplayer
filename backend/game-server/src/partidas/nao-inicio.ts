import type { Redis } from 'ioredis';
import { GAME_SERVERS_PARTIDA_ESTADO_PREFIXO, GAME_SERVERS_PARTIDA_PREFIXO } from '@flicker/config';
import { chaveDaPartida } from './chaves.ts';
import { cancelarPartidaSeNaoIniciada, obterPartida } from './partidas.ts';
import type { AvisoDeRetorno } from '../retorno/cliente.ts';

const NAO_INICIO_IMEDIATO_MS = 10_000;
// Anti-thundering-herd (review interna #304): o rearme pós-restart reagenda N
// partidas de uma vez; sem dispersão, as expirações simultâneas atingem a
// fila mononodo do lobby em rajada (timeout 5s → 503 → retry amplifica).
const JITTER_REARME_MS = 5_000;
const REARME_SCAN_COUNT = 500;
const REARME_ROSTER_VAZIO_MS = 1_000;
const REARME_TETO_MS = 5_000;

function jitterAte(maxMs: number): number {
  return Math.floor(Math.random() * (maxMs + 1));
}

// Guarda única das três verificações: só a Partida ainda `preparada` pode
// declarar o não-início (predicado extraído — review interna #304).
function partidaAindaPreparada(partida: { estado?: string }): boolean {
  return partida.estado === 'preparada';
}

// Guarda única do roster: TODOS os membros em reconexão (roster vazio conta
// como sim — sem nenhum admitido, o não-início é imediato; review interna
// #304).
function rosterTodoEmReconexao(roster: ReadonlyArray<{ presenca?: string }> | undefined): boolean {
  return roster?.every((m) => m.presenca === 'em_reconexao') ?? false;
}

// Pipeline mínimo usado no rearme (review interna #304): GET + TTL por chave
// em 1 RTT. Mantém o boot O(lotes) em vez de O(chaves) sob N partidas
// simultâneas.
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
  const chavesDePartida = chaves.filter((chave) => !chave.startsWith(GAME_SERVERS_PARTIDA_ESTADO_PREFIXO));
  const fabricaDePipeline = (redis as unknown as { pipeline?: unknown }).pipeline;
  if (typeof fabricaDePipeline !== 'function') {
    // Fallback sequencial (ex.: fakes de teste sem pipeline).
    const lote: LinhaDoLote[] = [];
    for (const chave of chavesDePartida) {
      lote.push({ chave, raw: await redis.get(chave), ttl: await redis.ttl(chave) });
    }
    return lote;
  }
  const pipeline = (fabricaDePipeline as () => PipelineDeLeitura).call(redis);
  for (const chave of chavesDePartida) {
    pipeline.get(chave);
    pipeline.ttl(chave);
  }
  const respostas = (await pipeline.exec()) ?? [];
  return chavesDePartida.map((chave, i) => ({
    chave,
    raw: (respostas[i * 2]?.[1] as string | null) ?? null,
    ttl: Number(respostas[i * 2 + 1]?.[1] ?? -2),
  }));
}
const timers = new Map<string, NodeJS.Timeout>();
// Teto de reagendamentos sem wiring (review interna #304): sem Redis o fire
// reagenda em vez de explodir, mas não para sempre — após o teto, erra alto
// e para.
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
let globalBroadcaster: { fecharSocketsDeNaoInicio(partidaId: string, code?: number, reason?: string): void } | undefined;
export function definirRedisParaNaoInicio(redis: Redis | undefined): void {
  globalRedis = redis;
}
export function definirBroadcasterParaNaoInicio(broadcaster: { fecharSocketsDeNaoInicio(partidaId: string, code?: number, reason?: string): void }): void {
  globalBroadcaster = broadcaster;
}

/** Exportado para testes de regressão (review interna #304): verificação imediata. */
export async function verificarNaoInicioSeNecessario(redis: Redis, partidaId: string): Promise<boolean> {
  const partida = await obterPartida(redis, partidaId as never);
  if (partida === null) return false;
  if (!partidaAindaPreparada(partida)) return false;
  const idadeMs = Date.now() - Date.parse(partida.criadaEm);
  if (!Number.isFinite(idadeMs)) {
    console.warn('[nao-inicio] criadaEm inválida; não-início ignorado', { partidaId });
    return false;
  }
  // Não-início em preparada: se todos em_reconexao → não-início imediato (10s já agendado),
  // senão se ainda não expirou 90s → reagenda restante, senão (idade >= 90s) declara não-início mesmo com 1-3 conectados parciais.
  // Parcial <90s mantém SALA_ENCAMINHADA no lobby; teto é comportamento desejado (#222).
  if (!rosterTodoEmReconexao(partida.roster) && idadeMs < naoInicioSegundos * 1000) {
    const restante = naoInicioSegundos * 1000 - idadeMs;
    agendarNaoInicio(partidaId, restante);
    return false;
  }
  const partidaIdTyped = partida.partidaId as string;
  // DEL condicional por Lua (review #304 item 1): se a admissão completar
  // entre a leitura acima e o cancelamento, a partida já está em
  // `em_andamento` e o cancelamento retorna false — sem chutar sockets.
  const cancelada = await cancelarPartidaSeNaoIniciada(redis, partidaIdTyped);
  if (!cancelada) {
    // DEL falhou sob carga: não chuta os sockets (evita clientes caídos com
    // chave fantasma até o TTL); reagenda para a próxima verificação.
    agendarNaoInicio(partidaIdTyped);
    return false;
  }
  try {
    globalBroadcaster?.fecharSocketsDeNaoInicio(partidaIdTyped, 4000, 'PARTIDA_NAO_INICIADA');
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
  if (!partidaAindaPreparada(partida)) return;
  if (!rosterTodoEmReconexao(partida.roster)) return;
  agendarNaoInicio(partidaId, NAO_INICIO_IMEDIATO_MS);
}

export async function rearmarNaoInicioAposRestart(redis: Redis): Promise<void> {
  globalRedis = redis;
  let verificadas = 0;
  let reagendadas = 0;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${GAME_SERVERS_PARTIDA_PREFIXO}*`, 'COUNT', REARME_SCAN_COUNT);
      cursor = next;
      const lote = await lerLoteDoRearme(redis, keys);
      verificadas += keys.length;
      for (const linha of lote) {
        const raw = linha.raw;
        if (raw === null) continue;
        try {
          const partida = JSON.parse(raw) as { partidaId: string; estado: string; criadaEm: string; roster?: unknown[] };
          if (!partidaAindaPreparada(partida)) continue;
          const idadeMs = Date.now() - Date.parse(partida.criadaEm);
          if (!Number.isFinite(idadeMs)) {
            console.warn('[nao-inicio] criadaEm inválida no rearme; partida ignorada', { chave: linha.chave });
            continue;
          }
          const ttl = linha.ttl;
          if (ttl === -2) continue;
          if (rosterTodoEmReconexao(partida.roster as Array<{ presenca: string }> | undefined)) {
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
