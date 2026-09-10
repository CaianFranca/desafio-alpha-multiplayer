// Rotas de Identidade e Acesso do lobby-server sob `/api/auth`.
// Contrato: ver `backend/lobby-server/openapi.yaml` e spec #24.
// A tabela atual no banco é `usuarios` (Cadastro ↔ usuarios — dívida de renomeação,
// ver follow-up registrado no corpo da PR #29). Senha é a coluna real na tabela.

import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { getConfig } from '@flicker/config';
import type { ErroAuthItem, Jogador } from '@flicker/shared';
import { pool } from '../config/pg.ts';
import {
  NOME_ACCESS_COOKIE,
  NOME_REFRESH_COOKIE,
  formatarCookie,
} from '../cookies.ts';
import { assinarAccess, assinarRefresh, verificarRefresh } from '../jwt.ts';
import { requireSessao } from '../middleware/auth.ts';
import { criarSessao, obterSessao, revogarSessao, rotacionarSessao, SessaoInvalidaError } from '../sessoes.ts';

export const authRouter = Router();

// Hash válido usado somente para equalizar o custo do login de email inexistente.
// O valor não corresponde a nenhuma Credencial da aplicação.
const DUMMY_BCRYPT_HASH = '$2a$10$PnTpyXXkuhNfHqoKenTO5ONmfuiF4jcfWgX8ShkvfYfLr8Jwg5Zie';

// Limites de Apelido conforme contrato OpenAPI (`CadastroRequest.apelido` 3–20).
// O banco tem `varchar(30)` por dívida do bootstrap — mantemos o limite do contrato
// (3–20) na validação da rota; valores 21–30 são aceitos pelo banco mas barrados
// pela API para não divergir do OpenAPI. Follow-up: alinhar a coluna.
const APELIDO_MIN = 3;
const APELIDO_MAX = 20;
const SENHA_MIN = 8;
const SALT_ROUNDS = 10;

// Mapeamento do nome do constraint UNIQUE no banco para o campo da API.
// Os nomes reais (vistos via `\d usuarios`) preservam o nome da tabela original
// da migration de criação (`jogadores_*`), porque o `renameTable` do Knex não
// renomeia constraints UNIQUE. Mantemos também o padrão pós-rename e a
// convenção `<tabela>_<coluna>_key` do PostgreSQL para tolerar variações.
const PADROES_CONSTRAINT_APELIDO: readonly RegExp[] = [
  /^jogadores_apelido_unique$/,
  /^usuarios_apelido_unique$/,
  /^jogadores_apelido_key$/,
  /^usuarios_apelido_key$/,
];
const PADROES_CONSTRAINT_EMAIL: readonly RegExp[] = [
  /^jogadores_email_unique$/,
  /^usuarios_email_unique$/,
  /^jogadores_email_key$/,
  /^usuarios_email_key$/,
];

interface PgError23505 {
  code?: string;
  constraint?: string;
}

function campoDoConstraint(constraint: string | undefined): 'apelido' | 'email' | null {
  if (typeof constraint !== 'string') {
    return null;
  }
  for (const padrao of PADROES_CONSTRAINT_APELIDO) {
    if (padrao.test(constraint)) {
      return 'apelido';
    }
  }
  for (const padrao of PADROES_CONSTRAINT_EMAIL) {
    if (padrao.test(constraint)) {
      return 'email';
    }
  }
  return null;
}

// --- helpers de validação ---

function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validarFormatoEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validarApelido(apelido: string): string | null {
  if (apelido.length === 0) {
    return 'Informe o apelido.';
  }
  if (apelido.length < APELIDO_MIN || apelido.length > APELIDO_MAX) {
    return `O apelido deve ter entre ${APELIDO_MIN} e ${APELIDO_MAX} caracteres.`;
  }
  return null;
}

function validarSenha(senha: string): string | null {
  if (senha.length === 0) {
    return 'Informe a senha.';
  }
  if (senha.length < SENHA_MIN) {
    return `A senha deve ter no mínimo ${SENHA_MIN} caracteres.`;
  }
  return null;
}

function responderErroValidacao(res: Response, erros: ErroAuthItem[]): void {
  res.status(400).json({ erros });
}

function responderErroNaoAutorizado(res: Response): void {
  res.status(401).json({ erros: [{ mensagem: 'Credenciais inválidas.' }] });
}

// --- helpers de cookies de sessão ---

function emitirCookiesDeSessao(res: Response, jogador: Jogador, sessaoId: string): void {
  const { cookieSecure, sessionAccessTtlSeconds, sessionRefreshTtlSeconds } = getConfig();
  const access = assinarAccess(jogador, sessaoId);
  const refresh = assinarRefresh(jogador, sessaoId);

  res.setHeader('Set-Cookie', [
    formatarCookie(NOME_ACCESS_COOKIE, access, {
      ttlSegundos: sessionAccessTtlSeconds,
      httpOnly: true,
      sameSite: 'Strict',
      secure: cookieSecure,
      path: '/',
    }),
    formatarCookie(NOME_REFRESH_COOKIE, refresh, {
      ttlSegundos: sessionRefreshTtlSeconds,
      httpOnly: true,
      sameSite: 'Strict',
      secure: cookieSecure,
      path: '/',
    }),
  ]);
}

function limparCookiesDeSessao(res: Response): void {
  const { cookieSecure } = getConfig();
  res.setHeader('Set-Cookie', [
    formatarCookie(NOME_ACCESS_COOKIE, '', {
      ttlSegundos: 0,
      httpOnly: true,
      sameSite: 'Strict',
      secure: cookieSecure,
      path: '/',
    }),
    formatarCookie(NOME_REFRESH_COOKIE, '', {
      ttlSegundos: 0,
      httpOnly: true,
      sameSite: 'Strict',
      secure: cookieSecure,
      path: '/',
    }),
  ]);
}

// --- POST /register ---

authRouter.post('/register', async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as { apelido?: unknown; email?: unknown; senha?: unknown };

  const apelidoBruto = typeof body.apelido === 'string' ? body.apelido.trim() : '';
  const emailBruto = typeof body.email === 'string' ? body.email.trim() : '';
  const senhaBruta = typeof body.senha === 'string' ? body.senha : '';

  const erros: ErroAuthItem[] = [];

  if (typeof body.apelido !== 'string') {
    erros.push({ campo: 'apelido', mensagem: 'Informe o apelido.' });
  } else {
    const erroApelido = validarApelido(apelidoBruto);
    if (erroApelido) {
      erros.push({ campo: 'apelido', mensagem: erroApelido });
    }
  }

  if (typeof body.email !== 'string') {
    erros.push({ campo: 'email', mensagem: 'Informe o email.' });
  } else if (!validarFormatoEmail(emailBruto)) {
    erros.push({ campo: 'email', mensagem: 'Informe um email válido.' });
  } else if (normalizarEmail(emailBruto).endsWith('@exemplo.local')) {
    erros.push({ campo: 'email', mensagem: 'Domínio reservado para contas internas.' });
  }

  if (typeof body.senha !== 'string') {
    erros.push({ campo: 'senha', mensagem: 'Informe a senha.' });
  } else {
    const erroSenha = validarSenha(senhaBruta);
    if (erroSenha) {
      erros.push({ campo: 'senha', mensagem: erroSenha });
    }
  }

  if (erros.length > 0) {
    responderErroValidacao(res, erros);
    return;
  }

  const emailNormalizado = normalizarEmail(emailBruto);

  try {
    const hash = await bcrypt.hash(senhaBruta, SALT_ROUNDS);

    // tabela 'usuarios' = Cadastro (CONTEXT.md:25) — coluna `senha` é a real.
    const result = await pool.query<{ id: string; apelido: string; email: string }>(
      `INSERT INTO usuarios (apelido, email, senha)
       VALUES ($1, $2, $3)
       RETURNING id, apelido, email`,
      [apelidoBruto, emailNormalizado, hash],
    );

    const jogador: Jogador = result.rows[0];
    const { sessaoId } = await criarSessao(jogador.id);
    emitirCookiesDeSessao(res, jogador, sessaoId);
    res.status(201).json(jogador);
  } catch (error: unknown) {
    const pgError = error as PgError23505;
    if (pgError.code === '23505') {
      const campo = campoDoConstraint(pgError.constraint);
      if (campo === 'apelido') {
        res.status(409).json({ erros: [{ campo: 'apelido', mensagem: 'Apelido já está em uso.' }] });
        return;
      }
      if (campo === 'email') {
        res.status(409).json({ erros: [{ campo: 'email', mensagem: 'Email já está em uso.' }] });
        return;
      }
      res.status(409).json({ erros: [{ mensagem: 'Cadastro já existe.' }] });
      return;
    }
    console.error('[auth/register] error:', error);
    res.status(500).json({ erros: [{ mensagem: 'Erro interno do servidor.' }] });
  }
});

// --- POST /login ---

authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as { email?: unknown; senha?: unknown };

  const emailBruto = typeof body.email === 'string' ? body.email.trim() : '';
  const senhaBruta = typeof body.senha === 'string' ? body.senha : '';

  const erros: ErroAuthItem[] = [];

  if (typeof body.email !== 'string' || !validarFormatoEmail(emailBruto)) {
    erros.push({ campo: 'email', mensagem: 'Informe um email válido.' });
  }
  if (typeof body.senha !== 'string' || senhaBruta.length === 0) {
    erros.push({ campo: 'senha', mensagem: 'Informe a senha.' });
  }

  if (erros.length > 0) {
    responderErroValidacao(res, erros);
    return;
  }

  const emailNormalizado = normalizarEmail(emailBruto);

  try {
    const result = await pool.query<{ id: string; apelido: string; email: string; senha: string }>(
      `SELECT id, apelido, email, senha FROM usuarios WHERE email = $1 LIMIT 1`,
      [emailNormalizado],
    );

    if (result.rowCount === 0) {
      // Equaliza o custo do bcrypt mesmo quando o email não existe.
      await bcrypt.compare(senhaBruta, DUMMY_BCRYPT_HASH).catch(() => false);
      responderErroNaoAutorizado(res);
      return;
    }

    const row = result.rows[0];
    const senhaValida = await bcrypt.compare(senhaBruta, row.senha).catch(() => false);
    if (!senhaValida) {
      responderErroNaoAutorizado(res);
      return;
    }

    const jogador: Jogador = { id: row.id, apelido: row.apelido, email: row.email };
    // criarSessao já revoga a sessão anterior (Sessão única por Jogador).
    const { sessaoId } = await criarSessao(jogador.id);
    emitirCookiesDeSessao(res, jogador, sessaoId);
    res.status(200).json(jogador);
  } catch (error) {
    console.error('[auth/login] error:', error);
    res.status(500).json({ erros: [{ mensagem: 'Erro interno do servidor.' }] });
  }
});

// --- POST /logout ---

authRouter.post('/logout', requireSessao, async (req: Request, res: Response): Promise<void> => {
  // requireSessao garante req.jogador.
  const jogador = req.jogador!;
  await revogarSessao(jogador.sessaoId);
  limparCookiesDeSessao(res);
  res.status(204).end();
});

// --- GET /me ---

authRouter.get('/me', requireSessao, async (req: Request, res: Response): Promise<void> => {
  const jogador = req.jogador!;

  try {
    const result = await pool.query<{ id: string; apelido: string; email: string }>(
      `SELECT id, apelido, email FROM usuarios WHERE id = $1 LIMIT 1`,
      [jogador.id],
    );

    if (result.rowCount === 0) {
      // Cadastro foi removido depois da Sessão ser criada — revoga e responde 401.
      await revogarSessao(jogador.sessaoId);
      res.status(401).json({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] });
      return;
    }

    const row = result.rows[0];
    res.status(200).json({ id: row.id, apelido: row.apelido, email: row.email });
  } catch (error) {
    console.error('[auth/me] error:', error);
    res.status(500).json({ erros: [{ mensagem: 'Erro interno do servidor.' }] });
  }
});

// --- POST /refresh ---

authRouter.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[NOME_REFRESH_COOKIE];
  if (typeof token !== 'string' || token.length === 0) {
    res.status(401).json({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] });
    return;
  }

  const payload = verificarRefresh(token);
  if (payload === null) {
    res.status(401).json({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] });
    return;
  }

  const sessao = await obterSessao(payload.sessaoId);
  if (sessao === null || sessao.jogadorId !== payload.jogadorId) {
    res.status(401).json({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] });
    return;
  }

  try {
    const result = await pool.query<{ id: string; apelido: string; email: string }>(
      `SELECT id, apelido, email FROM usuarios WHERE id = $1 LIMIT 1`,
      [payload.jogadorId],
    );

    if (result.rowCount === 0) {
      await revogarSessao(payload.sessaoId);
      res.status(401).json({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] });
      return;
    }

    const jogador: Jogador = result.rows[0];
    const rotacionada = await rotacionarSessao(payload.sessaoId, jogador.id);
    emitirCookiesDeSessao(res, jogador, rotacionada.sessaoId);
    res.status(200).json(jogador);
  } catch (error) {
    if (error instanceof SessaoInvalidaError) {
      // TOCTOU entre obterSessao e a rotação (refresh concorrente) ou reuso
      // de refresh já rotacionado — o script Lua detectou e sinalizou.
      res.status(401).json({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] });
      return;
    }
    console.error('[auth/refresh] error:', error);
    res.status(500).json({ erros: [{ mensagem: 'Erro interno do servidor.' }] });
  }
});
