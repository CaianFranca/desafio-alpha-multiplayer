import jwt from 'jsonwebtoken';

export const SERVICE_TOKEN_AUDIENCE = 'flicker-service';
export const BOT_TOKEN_AUDIENCE = 'flicker-bot';

export interface PayloadBotToken {
  sub: string;
  apelido: string;
  partidaId?: string;
  bot: true;
}

export function assinarServiceToken(jwtSecret: string): string {
  return jwt.sign(
    { sub: 'flicker-service', role: 'service' },
    jwtSecret,
    { algorithm: 'HS256', audience: SERVICE_TOKEN_AUDIENCE, expiresIn: '1h' },
  );
}

export function assinarBotToken(
  params: { jogadorId: string; apelido: string; partidaId?: string },
  jwtSecret: string,
): string {
  return jwt.sign(
    {
      sub: params.jogadorId,
      apelido: params.apelido,
      partidaId: params.partidaId,
      bot: true,
    },
    jwtSecret,
    { algorithm: 'HS256', audience: BOT_TOKEN_AUDIENCE, expiresIn: '2h' },
  );
}

export function verificarBotToken(token: string, jwtSecret: string): PayloadBotToken | null {
  try {
    const decoded = jwt.verify(token, jwtSecret, {
      algorithms: ['HS256'],
      audience: BOT_TOKEN_AUDIENCE,
    }) as Record<string, unknown>;
    if (typeof decoded.sub !== 'string' || typeof decoded.apelido !== 'string' || decoded.bot !== true) {
      return null;
    }
    return {
      sub: decoded.sub,
      apelido: decoded.apelido,
      partidaId: typeof decoded.partidaId === 'string' ? decoded.partidaId : undefined,
      bot: true,
    };
  } catch {
    return null;
  }
}
