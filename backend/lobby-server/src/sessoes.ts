// Store de Sessão no Redis — uma Sessão ativa por Jogador (ADR-0002, glossário CONTEXT.md).
// Estrutura:
//   sessao:<sessaoId>          -> JSON { jogadorId, criadoEm }    (TTL: sessionRefreshTtlSeconds)
//   sessao:jogador:<jogadorId> -> sessaoId                       (sem TTL — refresh controla)
//
// A criação e a rotação usam scripts Lua executados atomicamente no servidor
// Redis. Sem atomicidade, dois logins ou refreshes concorrentes podiam
// manter duas Sessões vivas para o mesmo Jogador, violando o invariante do
// glossário ("no máximo uma ativa por Jogador"). Os comandos get/del/set em
// sequência tinham TOCTOU: ambos os requests liam a mesma sessão antiga
// antes de qualquer escrita; cada um revogava uma (já inexistente) e criava
// a sua, sobrando uma sessão órfã que autenticava por mais 7 dias.

import { randomUUID } from 'node:crypto';
import { getConfig } from '@flicker/config';
import type { Redis } from 'ioredis';
import { redisClient } from './config/redis.ts';

export interface SessaoDaStore {
  jogadorId: string;
  criadoEm: string;
}

export interface SessaoCriada {
  sessaoId: string;
  expiraEm: Date;
}

const PREFIXO_SESSAO = 'sessao:';
const PREFIXO_SESSAO_POR_JOGADOR = 'sessao:jogador:';
// Marcador de rotação do refresh (issue #410): liga a Sessão antiga à nova
// pelo TTL de access (sessionAccessTtlSeconds), tempo suficiente para a
// revalidação migrar a conexão antes do marcador expirar. Login/logout/
// revogação NÃO gravam marcador — só a rotação.
const PREFIXO_SESSAO_ROTACIONADA = 'sessao:rotacionada:';

function chaveSessao(sessaoId: string): string {
  return `${PREFIXO_SESSAO}${sessaoId}`;
}

function chaveSessaoPorJogador(jogadorId: string): string {
  return `${PREFIXO_SESSAO_POR_JOGADOR}${jogadorId}`;
}

function chaveSessaoRotacionada(sessaoId: string): string {
  return `${PREFIXO_SESSAO_ROTACIONADA}${sessaoId}`;
}

// Cria uma nova sessão para `jogadorId`, revogando qualquer sessão anterior.
// KEYS[1] = sessao:jogador:<jogadorId>
// KEYS[2] = sessao:<novaId>
// ARGV[1] = TTL em segundos
// ARGV[2] = payload JSON da nova sessão
// ARGV[3] = novaId (gravado no mapping, sem prefixo)
// Retorna ARGV[3] em caso de sucesso.
const SCRIPT_CRIAR_SESSAO = `
local antigaId = redis.call('GET', KEYS[1])
if antigaId then
  redis.call('DEL', 'sessao:' .. antigaId)
end
redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[1]))
redis.call('SET', KEYS[1], ARGV[3], 'EX', tonumber(ARGV[1]))
return ARGV[3]
`.trim();

// Valida que a sessão antiga existe, pertence ao jogadorId e o mapping
// jogador→sessao aponta para ela; revoga e cria a nova atomicamente.
// Detecta reuso de refresh token já rotacionado (mapping != antigaId) e
// sessão revogada entre obterSessao e a rotação (sessao inexistente).
// KEYS[1] = sessao:<antigaId>
// KEYS[2] = sessao:jogador:<jogadorId>
// KEYS[3] = sessao:<novaId>
// KEYS[4] = sessao:rotacionada:<antigaId> (marcador da rotação, issue #410)
// ARGV[1] = TTL em segundos
// ARGV[2] = payload JSON da nova sessão
// ARGV[3] = novaId (gravado no mapping e no marcador)
// ARGV[4] = jogadorId esperado (validação de ownership)
// ARGV[5] = antigaId esperado no mapping (validação de reuso)
// ARGV[6] = TTL em segundos do marcador de rotação
// Retorna ARGV[3] em caso de sucesso; nil se qualquer validação falhar.
const SCRIPT_ROTACIONAR_SESSAO = `
local payload = redis.call('GET', KEYS[1])
if not payload then
  return nil
end
local ok, parsed = pcall(cjson.decode, payload)
if not ok or parsed.jogadorId ~= ARGV[4] then
  return nil
end
local mapping = redis.call('GET', KEYS[2])
if mapping ~= ARGV[5] then
  return nil
end
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[3], ARGV[2], 'EX', tonumber(ARGV[1]))
redis.call('SET', KEYS[2], ARGV[3], 'EX', tonumber(ARGV[1]))
redis.call('SET', KEYS[4], ARGV[3], 'EX', tonumber(ARGV[6]))
return ARGV[3]
`.trim();

// Erro lançado por rotacionarSessao quando o script Lua detecta sessão
// inválida, reuso de refresh token ou ownership divergente. O caller
// (auth.ts /refresh) traduz para 401.
export class SessaoInvalidaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'SessaoInvalidaError';
  }
}

declare module 'ioredis' {
  // Augmentação dos métodos registrados via `defineCommand`. ioredis adiciona
  // esses métodos dinamicamente, mas o TypeScript só os conhece se forem
  // declarados aqui.
  interface Redis {
    criarSessaoAtomica(
      jogadorKey: string,
      novaSessaoKey: string,
      ttlSegundos: number,
      payloadJson: string,
      novaId: string,
    ): Promise<string>;
    rotacionarSessaoAtomica(
      antigaSessaoKey: string,
      jogadorKey: string,
      novaSessaoKey: string,
      marcadorKey: string,
      ttlSegundos: number,
      payloadJson: string,
      novaId: string,
      jogadorId: string,
      antigaId: string,
      ttlMarcadorSegundos: number,
    ): Promise<string | null>;
  }
}

let scriptsRegistrados = false;

function registrarScripts(): void {
  if (scriptsRegistrados) {
    return;
  }
  scriptsRegistrados = true;
  redisClient.defineCommand('criarSessaoAtomica', {
    numberOfKeys: 2,
    lua: SCRIPT_CRIAR_SESSAO,
  });
  redisClient.defineCommand('rotacionarSessaoAtomica', {
    numberOfKeys: 4,
    lua: SCRIPT_ROTACIONAR_SESSAO,
  });
}

export async function criarSessao(jogadorId: string): Promise<SessaoCriada> {
  registrarScripts();
  const { sessionRefreshTtlSeconds } = getConfig();

  const novaId = randomUUID();
  const criadoEm = new Date().toISOString();
  const payload: SessaoDaStore = { jogadorId, criadoEm };

  const sessaoId = await redisClient.criarSessaoAtomica(
    chaveSessaoPorJogador(jogadorId),
    chaveSessao(novaId),
    sessionRefreshTtlSeconds,
    JSON.stringify(payload),
    novaId,
  );

  const expiraEm = new Date(Date.now() + sessionRefreshTtlSeconds * 1000);
  return { sessaoId, expiraEm };
}

export async function obterSessao(sessaoId: string): Promise<{ jogadorId: string } | null> {
  const raw = await redisClient.get(chaveSessao(sessaoId));
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SessaoDaStore>;
    if (typeof parsed.jogadorId !== 'string') {
      return null;
    }
    return { jogadorId: parsed.jogadorId };
  } catch {
    return null;
  }
}

/**
 * Lê o marcador de rotação do refresh (issue #410): devolve o id da Sessão
 * sucessora quando `sessao:rotacionada:<sessaoId>` existe, ou `null` quando a
 * Sessão não foi rotacionada (login/logout/revogação/expiração).
 */
export async function obterSucessorDeSessao(sessaoId: string): Promise<string | null> {
  return redisClient.get(chaveSessaoRotacionada(sessaoId));
}

export async function revogarSessao(sessaoId: string): Promise<void> {
  const raw = await redisClient.get(chaveSessao(sessaoId));
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<SessaoDaStore>;
      if (typeof parsed.jogadorId === 'string') {
        await redisClient.del(chaveSessaoPorJogador(parsed.jogadorId));
      }
    } catch {
      // JSON inválido: ainda assim removemos a chave da sessão.
    }
  }
  await redisClient.del(chaveSessao(sessaoId));
}

export async function rotacionarSessao(
  sessaoAntigaId: string,
  jogadorId: string,
): Promise<{ sessaoId: string }> {
  registrarScripts();
  const { sessionRefreshTtlSeconds, sessionAccessTtlSeconds } = getConfig();

  const novaId = randomUUID();
  const criadoEm = new Date().toISOString();
  const payload: SessaoDaStore = { jogadorId, criadoEm };

  const sessaoId = await redisClient.rotacionarSessaoAtomica(
    chaveSessao(sessaoAntigaId),
    chaveSessaoPorJogador(jogadorId),
    chaveSessao(novaId),
    chaveSessaoRotacionada(sessaoAntigaId),
    sessionRefreshTtlSeconds,
    JSON.stringify(payload),
    novaId,
    jogadorId,
    sessaoAntigaId,
    sessionAccessTtlSeconds,
  );

  if (sessaoId === null) {
    // TOCTOU entre obterSessao (no caller) e a rotação, ou reuso de refresh
    // já rotacionado. auth.ts /refresh traduz para 401.
    throw new SessaoInvalidaError('Sessão inválida ou revogada');
  }

  return { sessaoId };
}