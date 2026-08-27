// Formatador puro de Set-Cookie para a Sessão.
// Sem dependência de Express; `req`/`res` apenas repassam o array de strings.
// Defaults alinhados ao contrato OpenAPI (httpOnly, SameSite=Strict, Path=/).

export const NOME_ACCESS_COOKIE = 'access_token';
export const NOME_REFRESH_COOKIE = 'refresh_token';

export type SameSite = 'Strict' | 'Lax' | 'None';

export interface OpcoesDoCookie {
  ttlSegundos: number;
  httpOnly?: boolean;
  sameSite?: SameSite;
  secure?: boolean;
  path?: string;
}

/**
 * Monta o valor do header `Set-Cookie` no formato RFC 6265.
 * Para `ttlSegundos <= 0`, gera cookie de limpeza (`Max-Age=0`, valor vazio).
 */
export function formatarCookie(nome: string, valor: string, opts: OpcoesDoCookie): string {
  const httpOnly = opts.httpOnly ?? true;
  const sameSite: SameSite = opts.sameSite ?? 'Strict';
  const secure = opts.secure ?? false;
  const path = opts.path ?? '/';
  const ehLimpeza = opts.ttlSegundos <= 0;

  const partes: string[] = [`${nome}=${ehLimpeza ? '' : valor}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) {
    partes.push('HttpOnly');
  }
  if (secure) {
    partes.push('Secure');
  }
  partes.push(`Max-Age=${ehLimpeza ? 0 : Math.floor(opts.ttlSegundos)}`);
  return partes.join('; ');
}
