import type { Redis } from 'ioredis';
import jwt from 'jsonwebtoken';
import { verificarBotToken } from '@flicker/config';

export interface SessaoDoJogador {
  readonly jogadorId: string;
  readonly apelido: string;
  readonly sessaoId: string;
  readonly isBot?: boolean;
}

/**
 * Valida um JWT de sessão (jogador real ou bot service token) e retorna o payload extraído.
 * Retorna null se o token for inválido, expirado ou o payload não contiver os campos esperados.
 */
export function validarTokenDeSessao(token: string, secret: string): SessaoDoJogador | null {
  // 1. Tenta validar como Bot Token (Fase 2 da arquitetura)
  const botToken = verificarBotToken(token, secret);
  if (botToken) {
    return {
      jogadorId: botToken.sub,
      apelido: botToken.apelido,
      sessaoId: `bot-session-${botToken.sub}`,
      isBot: true,
    };
  }

  // 2. Valida como token de jogador regular
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string') {
      return null;
    }
    const raw = decoded as Record<string, unknown>;
    const jogadorId = typeof raw.sub === 'string' && raw.sub.length > 0
      ? raw.sub
      : (typeof raw.jogadorId === 'string' && raw.jogadorId.length > 0 ? raw.jogadorId : null);

    const apelido = typeof raw.apelido === 'string' && raw.apelido.length > 0 ? raw.apelido : null;
    const sessaoId = typeof raw.sessaoId === 'string' && raw.sessaoId.length > 0 ? raw.sessaoId : null;

    if (jogadorId === null || apelido === null || sessaoId === null) {
      return null;
    }
    return { jogadorId, apelido, sessaoId };
  } catch {
    return null;
  }
}

/**
 * Valida se a sessão no Redis existe e pertence ao jogador indicado.
 *
 * Erro de infraestrutura (Redis fora) PROPAGA — quem chama decide entre
 * fail-open (revalidação periódica) e fail-closed (handshake). `false` fica
 * reservado a Sessão ausente ou de outro Jogador. Mesmo padrão de
 * `obterSessao` no lobby (`sessoes.ts`).
 */
export async function validarSessaoNoRedis(
  redis: Redis,
  sessaoId: string,
  jogadorIdEsperado: string,
): Promise<boolean> {
  const raw = await redis.get(`sessao:${sessaoId}`);
  if (raw === null) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as { jogadorId?: string };
    return parsed.jogadorId === jogadorIdEsperado;
  } catch {
    return false;
  }
}

/**
 * Lê o marcador de rotação do refresh (issue #410): `sessao:rotacionada:<id>`
 * aponta para a Sessão sucessora enquanto o marcador viver. Sem marcador
 * (login, logout, revogação, expiração) devolve `null` — a revalidação então
 * encerra a conexão. Erro de infraestrutura (Redis fora) PROPAGA — quem chama
 * decide entre fail-open e fail-closed. Mesmo padrão de `obterSucessorDeSessao`
 * no lobby (`sessoes.ts`).
 */
export async function obterSucessorDeSessaoNoRedis(
  redis: Redis,
  sessaoId: string,
): Promise<string | null> {
  return redis.get(`sessao:rotacionada:${sessaoId}`);
}
