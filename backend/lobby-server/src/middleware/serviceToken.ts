// Guard para chamadas server-to-server (ex.: o próprio lobby descobrindo
// game-servers disponíveis para handoff — ADR-0003). Exige token de serviço
// assinado com JWT_SECRET e com `aud`/`role` de serviço; bloqueia JWTs de
// Jogador (mesmo válidos) por não portarem o audience correto, evitando
// quebra do invariante "Sessão: uma ativa por Jogador" (CONTEXT.md:38).
// Em dev mantém aberto para compatibilidade de testes de integração.

import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '@flicker/config';

export const SERVICE_TOKEN_AUDIENCE = 'flicker-service';

export function requireServiceToken(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== 'production') {
    next();
    return;
  }
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'não autorizado' });
    return;
  }
  const token = header.slice(7);
  try {
    const { jwtSecret } = getConfig();
    jwt.verify(token, jwtSecret, {
      algorithms: ['HS256'],
      audience: SERVICE_TOKEN_AUDIENCE,
    });
  } catch {
    res.status(401).json({ error: 'não autorizado' });
    return;
  }
  next();
}
