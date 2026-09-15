// Middleware de requestId compartilhado (issue #411).
// Centraliza a lógica usada por lobby-server e game-server para evitar duplicação
// e divergência de `declare global` Express augmentation.

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

const REQUEST_ID_RE = /^[A-Za-z0-9-]{1,128}$/;

export function primeiroValor(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) return header[0];
  return header;
}

function sanitizarRequestId(valor: string | string[] | undefined): string | null {
  const raw = primeiroValor(valor);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Evita CRLF/header injection e limita tamanho; só alfanumérico + hífen
  if (!REQUEST_ID_RE.test(trimmed)) return null;
  return trimmed;
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-request-id'];
  const sanitizado = sanitizarRequestId(header as string | string[] | undefined);
  const reqId = sanitizado ?? randomUUID();
  (req as Request & { id: string }).id = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
}

export function getRequestId(req: Request): string | undefined {
  const id = (req as Request & { id?: string }).id;
  if (typeof id === 'string' && id.length > 0) return id;
  return sanitizarRequestId(req.headers['x-request-id'] as string | string[] | undefined) ?? undefined;
}
