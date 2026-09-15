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

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-request-id'];
  const reqId = (typeof header === 'string' && header.trim().length > 0 ? header.trim() : randomUUID());
  (req as Request & { id: string }).id = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
}

export function getRequestId(req: Request): string | undefined {
  return (req as Request & { id?: string }).id ?? (req.headers['x-request-id'] as string | undefined);
}
