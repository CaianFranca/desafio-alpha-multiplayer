// Helpers de JWT para a Sessão do lobby-server.
// Tokens HS256 com segredos separados (access: JWT_SECRET, refresh: JWT_REFRESH_SECRET).
// Falhas de verificação viram `null` — middleware traduz para 401.

import jwt from 'jsonwebtoken';
import { getConfig } from '@flicker/config';
import { assinarServiceToken as assinarServiceTokenComSegredo } from '@flicker/config';
import type { Jogador } from '@flicker/shared';

export interface PayloadAccess {
  jogadorId: string;
  sessaoId: string;
  apelido: string;
  email: string;
}

export interface PayloadRefresh {
  jogadorId: string;
  sessaoId: string;
}

export function assinarAccess(jogador: Jogador, sessaoId: string): string {
  const { jwtSecret, sessionAccessTtlSeconds } = getConfig();
  return jwt.sign(
    {
      sub: jogador.id,
      apelido: jogador.apelido,
      email: jogador.email,
      sessaoId,
    },
    jwtSecret,
    { algorithm: 'HS256', expiresIn: sessionAccessTtlSeconds },
  );
}

export function assinarRefresh(jogador: Jogador, sessaoId: string): string {
  const { jwtRefreshSecret, sessionRefreshTtlSeconds } = getConfig();
  return jwt.sign(
    {
      sub: jogador.id,
      sessaoId,
    },
    jwtRefreshSecret,
    { algorithm: 'HS256', expiresIn: sessionRefreshTtlSeconds },
  );
}

export function verificarAccess(token: string): PayloadAccess | null {
  const { jwtSecret } = getConfig();
  try {
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as Record<string, unknown>;
    if (
      typeof decoded.sub !== 'string'
      || typeof decoded.sessaoId !== 'string'
      || typeof decoded.apelido !== 'string'
      || typeof decoded.email !== 'string'
    ) {
      return null;
    }
    return {
      jogadorId: decoded.sub,
      sessaoId: decoded.sessaoId,
      apelido: decoded.apelido,
      email: decoded.email,
    };
  } catch {
    return null;
  }
}

export function verificarRefresh(token: string): PayloadRefresh | null {
  const { jwtRefreshSecret } = getConfig();
  try {
    const decoded = jwt.verify(token, jwtRefreshSecret, { algorithms: ['HS256'] }) as Record<string, unknown>;
    if (typeof decoded.sub !== 'string' || typeof decoded.sessaoId !== 'string') {
      return null;
    }
    return {
      jogadorId: decoded.sub,
      sessaoId: decoded.sessaoId,
    };
  } catch {
    return null;
  }
}

export { SERVICE_TOKEN_AUDIENCE } from '@flicker/config';

// Token de serviço para chamadas server-to-server (ADR-0003), ex.: o lobby
// descobrindo game-servers disponíveis. Carrega `aud`/`role` de serviço para
// que requireServiceToken o aceite e rejeite JWTs de Jogador.
export function assinarServiceToken(): string {
  const { jwtSecret } = getConfig();
  return assinarServiceTokenComSegredo(jwtSecret);
}
