// Janela de reconexão da Partida em andamento (issue #295, spec #292).
//
// Modelo (mesmo padrão do lobby `lobby-server/src/salas/reconexao.ts` e do
// não-início `game-server/src/partidas/nao-inicio.ts`):
//   game-server:reconexao:<partidaId>:<jogadorId> -> "1" (EX TTL configurável)
//
// O Redis é a persistência (sobrevive ao restart — a chave ainda indica a
// janela aberta); o timer em memória com `unref` é o executor (só-preguiçoso
// não serve — o Jogador Ativo em reconexão precisa destravar sozinho pela
// conversão). A expiração converte automaticamente em desistência com efeito
// idêntico ao de B (ADR-0013), marcado como causa `expiracao`.
//
// Só em `em_andamento`: a `preparada` usa o não-início (10s/90s) e nunca
// agenda/limpa janela aqui.

import type { Redis } from 'ioredis';
import { obterPartida } from './partidas.ts';
import { obterEstadoDaPartida } from './estado.ts';

export const RECONEXAO_EM_ANDAMENTO_PREFIXO = 'game-server:reconexao:';
const JITTER_REARME_MS = 5_000;
const REARME_SCAN_COUNT = 500;

function jitterAte(maxMs: number): number {
  return Math.floor(Math.random() * (maxMs + 1));
}

export function chaveReconexaoEmAndamento(partidaId: string, jogadorId: string): string {
  return `${RECONEXAO_EM_ANDAMENTO_PREFIXO}${partidaId}:${jogadorId}`;
}

function chaveDoTimer(partidaId: string, jogadorId: string): string {
  return `${partidaId}:${jogadorId}`;
}

const timers = new Map<string, NodeJS.Timeout>();
let reconexaoEmAndamentoSegundos = 60;
let globalRedis: Redis | undefined;
let conversor: ((partidaId: string, jogadorId: string) => Promise<boolean>) | undefined;

export function configurarReconexaoEmAndamento(segundos: number): void {
  reconexaoEmAndamentoSegundos = segundos;
}

export function obterReconexaoEmAndamentoSegundos(): number {
  return reconexaoEmAndamentoSegundos;
}

export function definirRedisParaReconexaoEmAndamento(redis: Redis | undefined): void {
  globalRedis = redis;
}

export function definirConversorDeExpiracao(
  fn: ((partidaId: string, jogadorId: string) => Promise<boolean>) | undefined,
): void {
  conversor = fn;
}

export async function definirJanelaDeReconexao(
  redis: Redis,
  partidaId: string,
  jogadorId: string,
  segundos?: number,
): Promise<void> {
  const ex = Math.max(1, Math.ceil(segundos ?? reconexaoEmAndamentoSegundos));
  await redis.set(chaveReconexaoEmAndamento(partidaId, jogadorId), '1', 'EX', ex);
}

export async function limparJanelaDeReconexao(
  redis: Redis,
  partidaId: string,
  jogadorId: string,
): Promise<void> {
  await redis.del(chaveReconexaoEmAndamento(partidaId, jogadorId));
}

export async function existeJanelaDeReconexao(
  redis: Redis,
  partidaId: string,
  jogadorId: string,
): Promise<boolean> {
  return (await redis.ttl(chaveReconexaoEmAndamento(partidaId, jogadorId))) >= 0;
}

export function agendarExpiracaoDeReconexao(
  partidaId: string,
  jogadorId: string,
  delayMs?: number,
  redis?: Redis,
): void {
  cancelarExpiracaoDeReconexao(partidaId, jogadorId);
  const ms = delayMs ?? reconexaoEmAndamentoSegundos * 1000;
  const timer = setTimeout(() => {
    timers.delete(chaveDoTimer(partidaId, jogadorId));
    const client = redis ?? globalRedis;
    if (client === undefined) {
      console.warn('[reconexao-em-andamento] sem redis para verificar expiração', { partidaId, jogadorId });
      return;
    }
    void verificarExpiracaoSeNecessario(client, partidaId, jogadorId);
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(chaveDoTimer(partidaId, jogadorId), timer);
}

export function cancelarExpiracaoDeReconexao(partidaId: string, jogadorId: string): void {
  const t = timers.get(chaveDoTimer(partidaId, jogadorId));
  if (t === undefined) return;
  clearTimeout(t);
  timers.delete(chaveDoTimer(partidaId, jogadorId));
}

/** Exportado para testes: verificação imediata da expiração. */
export async function verificarExpiracaoSeNecessario(
  redis: Redis,
  partidaId: string,
  jogadorId: string,
): Promise<boolean> {
  // TTL autoritativo (#295): o timer dispara no vencimento, logo no fire real
  // a chave está em `0/-2`. `ttl > 0` = janela ainda aberta (fire
  // precoce/chamada direta adiantada) aborta sem mutar; `ttl == -1` = chave
  // sem EX (misconfig) aborta com warn; `0/-2` (vencida/ausente) prossegue
  // para os guards de presença/engine.
  let ttl: number;
  try {
    ttl = await redis.ttl(chaveReconexaoEmAndamento(partidaId, jogadorId));
  } catch {
    return false;
  }
  if (ttl > 0) {
    return false;
  }
  if (ttl === -1) {
    console.warn('[reconexao-em-andamento] janela sem expiração, abortando conversão', { partidaId, jogadorId });
    return false;
  }
  if (!(await janelaExpiradaValida(redis, partidaId, jogadorId))) {
    return false;
  }
  if (conversor === undefined) {
    console.warn('[reconexao-em-andamento] sem conversor para expiração', { partidaId, jogadorId });
    return false;
  }
  const converteu = await conversor(partidaId, jogadorId);
  try {
    await limparJanelaDeReconexao(redis, partidaId, jogadorId);
  } catch {}
  return converteu;
}

/**
 * Validador único da janela (#295): guards de presença/engine compartilhados
 * por `verificarExpiracaoSeNecessario` (janela vencida) e pelo rearme
 * pós-restart (janela viva — o rearme filtra `ttl < 0` antes de chamar).
 * Retorna false sem mutar o jogo em todos os casos inválidos, limpando a
 * janela best-effort (inclusive na `preparada`, que nunca tem janela).
 */
async function janelaExpiradaValida(
  redis: Redis,
  partidaId: string,
  jogadorId: string,
): Promise<boolean> {
  const partida = await obterPartida(redis, partidaId as never);
  if (partida === null) {
    try {
      await limparJanelaDeReconexao(redis, partidaId, jogadorId);
    } catch {}
    return false;
  }
  // Guarda da preparada (#295): janela/conversão só em `em_andamento` — o
  // não-início (10s/90s) segue intacto.
  if (partida.estado !== 'em_andamento') {
    try {
      await limparJanelaDeReconexao(redis, partidaId, jogadorId);
    } catch {}
    return false;
  }
  const membro = partida.roster.find((m) => m.jogadorId === jogadorId);
  if (membro === undefined || membro.presenca !== 'em_reconexao') {
    try {
      await limparJanelaDeReconexao(redis, partidaId, jogadorId);
    } catch {}
    return false;
  }
  const estado = await obterEstadoDaPartida(redis, partidaId);
  if (estado === null || estado.resultado !== null) {
    try {
      await limparJanelaDeReconexao(redis, partidaId, jogadorId);
    } catch {}
    return false;
  }
  if (!estado.jogadores.some((j) => j.jogadorId === jogadorId)) {
    try {
      await limparJanelaDeReconexao(redis, partidaId, jogadorId);
    } catch {}
    return false;
  }
  return true;
}

interface LinhaDoRearme {
  readonly chave: string;
  readonly ttl: number;
}

export async function rearmarReconexaoEmAndamentoAposRestart(redis: Redis): Promise<void> {
  globalRedis = redis;
  let verificadas = 0;
  let reagendadas = 0;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${RECONEXAO_EM_ANDAMENTO_PREFIXO}*`,
        'COUNT',
        REARME_SCAN_COUNT,
      );
      cursor = next;
      verificadas += keys.length;
      const linhas: LinhaDoRearme[] = [];
      const fabricaDePipeline = (redis as unknown as { pipeline?: unknown }).pipeline;
      if (typeof fabricaDePipeline === 'function') {
        const pipeline = (fabricaDePipeline as () => {
          ttl(chave: string): unknown;
          exec(): Promise<Array<[Error | null, unknown]> | null>;
        }).call(redis);
        for (const chave of keys) {
          pipeline.ttl(chave);
        }
        const respostas = (await pipeline.exec()) ?? [];
        keys.forEach((chave, i) => {
          linhas.push({ chave, ttl: Number(respostas[i]?.[1] ?? -2) });
        });
      } else {
        for (const chave of keys) {
          linhas.push({ chave, ttl: await redis.ttl(chave) });
        }
      }
      for (const linha of linhas) {
        if (linha.ttl < 0) continue;
        const resto = linha.chave.slice(RECONEXAO_EM_ANDAMENTO_PREFIXO.length);
        const sep = resto.lastIndexOf(':');
        if (sep <= 0) continue;
        const partidaId = resto.slice(0, sep);
        const jogadorId = resto.slice(sep + 1);
        if (partidaId.length === 0 || jogadorId.length === 0) continue;
        try {
          if (!(await janelaExpiradaValida(redis, partidaId, jogadorId))) {
            continue;
          }
          const delayMs = Math.max(0, linha.ttl * 1000) + jitterAte(JITTER_REARME_MS);
          agendarExpiracaoDeReconexao(partidaId, jogadorId, delayMs, redis);
          reagendadas += 1;
        } catch {}
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    } while (cursor !== '0');
    console.info('[reconexao-em-andamento] rearme concluído', { verificadas, reagendadas });
  } catch (err) {
    console.error('[reconexao-em-andamento] falha ao rearmar', { erro: (err as Error).message });
  }
}
