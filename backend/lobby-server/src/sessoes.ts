// Store de Sessão no Redis — uma Sessão ativa por Jogador (ADR-0002, glossário CONTEXT.md).
// Estrutura:
//   sessao:<sessaoId>          -> JSON { jogadorId, criadoEm }    (TTL: sessionRefreshTtlSeconds)
//   sessao:jogador:<jogadorId> -> sessaoId                       (sem TTL — refresh controla)

import { randomUUID } from 'node:crypto';
import { getConfig } from '@flicker/config';
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

function chaveSessao(sessaoId: string): string {
  return `${PREFIXO_SESSAO}${sessaoId}`;
}

function chaveSessaoPorJogador(jogadorId: string): string {
  return `${PREFIXO_SESSAO_POR_JOGADOR}${jogadorId}`;
}

export async function criarSessao(jogadorId: string): Promise<SessaoCriada> {
  const { sessionRefreshTtlSeconds } = getConfig();

  // Sessão única: novo login revoga a anterior.
  const sessaoAntiga = await redisClient.get(chaveSessaoPorJogador(jogadorId));
  if (sessaoAntiga) {
    await redisClient.del(chaveSessao(sessaoAntiga));
  }

  const novaId = randomUUID();
  const criadoEm = new Date().toISOString();
  const payload: SessaoDaStore = { jogadorId, criadoEm };

  await redisClient.set(
    chaveSessao(novaId),
    JSON.stringify(payload),
    'EX',
    sessionRefreshTtlSeconds,
  );
  // Mapeamento jogador -> sessão atual não tem TTL: a revogação é explícita
  // (logout / novo login / rotação), e o TTL da sessão em si é o que expira.
  await redisClient.set(chaveSessaoPorJogador(jogadorId), novaId);

  const expiraEm = new Date(Date.now() + sessionRefreshTtlSeconds * 1000);
  return { sessaoId: novaId, expiraEm };
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
  // Revoga a antiga (sem remover o mapeamento jogador -> ainda apontando para a antiga
  // será substituído pelo criarSessao).
  await redisClient.del(chaveSessao(sessaoAntigaId));
  const criada = await criarSessao(jogadorId);
  return { sessaoId: criada.sessaoId };
}
