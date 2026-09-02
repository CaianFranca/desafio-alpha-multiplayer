import jwt from 'jsonwebtoken';

export const SERVICE_TOKEN_AUDIENCE = 'flicker-service';

export function assinarServiceToken(jwtSecret: string): string {
  return jwt.sign(
    { sub: 'flicker-service', role: 'service' },
    jwtSecret,
    { algorithm: 'HS256', audience: SERVICE_TOKEN_AUDIENCE, expiresIn: '1h' },
  );
}
