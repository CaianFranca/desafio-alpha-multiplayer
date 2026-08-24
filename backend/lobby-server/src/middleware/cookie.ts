// Parser inline do header `Cookie` (RFC 6265 simplificado) — sem dependência externa.
// Best-effort: cookies malformados são ignorados. Header ausente => `req.cookies = {}`.
// `req.cookies` já existe no Express como `any`; este middleware popula-o com
// um `Record<string, string>`.

import type { NextFunction, Request, Response } from 'express';

function decodificarSeguro(parte: string): string {
  try {
    return decodeURIComponent(parte);
  } catch {
    // Sequência de escape inválida — devolve a parte crua, conforme RFC 6265 §5.2.
    return parte;
  }
}

export function cookieMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie;

  if (typeof header === 'string' && header.length > 0) {
    for (const par of header.split(';')) {
      const trimmed = par.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const eq = trimmed.indexOf('=');
      if (eq === -1) {
        continue;
      }
      const nome = decodificarSeguro(trimmed.slice(0, eq).trim());
      const valor = decodificarSeguro(trimmed.slice(eq + 1).trim());
      if (nome.length === 0) {
        continue;
      }
      // Primeiro valor vence (consistente com o que o cliente enviou primeiro).
      if (!(nome in cookies)) {
        cookies[nome] = valor;
      }
    }
  }

  req.cookies = cookies;
  next();
}
