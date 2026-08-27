import jwt from 'jsonwebtoken';

export interface SessaoDoJogador {
  readonly jogadorId: string;
  readonly apelido: string;
}

/**
 * Valida um JWT de sessão e retorna o payload extraído.
 * Retorna null se o token for inválido, expirado ou o payload não contiver os campos esperados.
 */
export function validarTokenDeSessao(token: string, secret: string): SessaoDoJogador | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string') {
      return null;
    }
    const { jogadorId, apelido } = decoded as Record<string, unknown>;
    if (typeof jogadorId !== 'string' || jogadorId.length === 0) {
      return null;
    }
    if (typeof apelido !== 'string' || apelido.length === 0) {
      return null;
    }
    return { jogadorId, apelido };
  } catch {
    return null;
  }
}
