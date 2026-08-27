// Middleware de autenticação: exige uma Sessão válida (cookie access_token + entrada no Redis).
// Em caso de falha, responde 401 com o envelope `{ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] }`.

import type { NextFunction, Request, Response } from 'express';
import { NOME_ACCESS_COOKIE } from '../cookies.ts';
import { verificarAccess } from '../jwt.ts';
import { obterSessao } from '../sessoes.ts';

export interface JogadorDaSessao {
  id: string;
  apelido: string;
  email: string;
  sessaoId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    jogador?: JogadorDaSessao;
  }
}

function responderSessaoInvalida(res: Response): void {
  res.status(401).json({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] });
}

export async function requireSessao(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[NOME_ACCESS_COOKIE];
  if (typeof token !== 'string' || token.length === 0) {
    responderSessaoInvalida(res);
    return;
  }

  const payload = verificarAccess(token);
  if (payload === null) {
    responderSessaoInvalida(res);
    return;
  }

  const sessao = await obterSessao(payload.sessaoId);
  if (sessao === null || sessao.jogadorId !== payload.jogadorId) {
    responderSessaoInvalida(res);
    return;
  }

  req.jogador = {
    id: payload.jogadorId,
    apelido: payload.apelido,
    email: payload.email,
    sessaoId: payload.sessaoId,
  };
  next();
}
