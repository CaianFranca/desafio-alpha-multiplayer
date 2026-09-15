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
import { consumirTentativas, type ItemLimite } from '../rate-limit/limitador.ts';
import { criarSessao, obterSessao, revogarSessao, rotacionarSessao, SessaoInvalidaError } from '../sessoes.ts';
import {
  CODIGO_SESSAO,
  MOTIVO_SESSAO_ENCERRADA,
  MOTIVO_SESSAO_SUBSTITUIDA,
  registroDeConexoes,
} from '../ws/registro-de-conexoes.ts';
import { hashEmail, securityEvents, securityLogger as sharedSecurityLogger } from '@flicker/shared/server';
import { getRequestId } from '../middleware/requestId.ts';
import type { Logger } from 'pino';

let securityLogger: Logger = sharedSecurityLogger as unknown as Logger;

export function __setAuthSecurityLoggerForTests(logger: Logger): void {
  securityLogger = logger;
}

export function __resetAuthSecurityLogger(): void {
  securityLogger = sharedSecurityLogger as unknown as Logger;
}

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
// bcryptjs trunca em 72 bytes; recusar acima disso evita que senhas distintas
// colidam na verificação (o excedente seria ignorado silenciosamente).
const SENHA_MAX_BYTES = 72;
const MENSAGEM_EXCESSO = 'Muitas tentativas. Tente novamente mais tarde.';
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
  if (Buffer.byteLength(senha, 'utf8') > SENHA_MAX_BYTES) {
    return `A senha excede o limite de ${SENHA_MAX_BYTES} bytes (UTF-8).`;
  }
  return null;
}

function responderErroValidacao(res: Response, erros: ErroAuthItem[]): void {
  res.status(400).json({ erros });
}

function responderErroNaoAutorizado(res: Response): void {
  res.status(401).json({ erros: [{ mensagem: 'Credenciais inválidas.' }] });
}

// --- helpers de rate limit de tentativas ---

function ipDoCliente(req: Request): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

function chavesDeLimite(ip: string, rota: 'login' | 'register', email: string): ItemLimite[] {
  const { authRateLimitJanelaSegundos, authRateLimitMaxPorIp, authRateLimitMaxPorCadastro } = getConfig();
  const itens: ItemLimite[] = [
    {
      chave: `auth:rate:ip:${ip}:${rota}`,
      maximo: authRateLimitMaxPorIp,
      janelaSegundos: authRateLimitJanelaSegundos,
    },
  ];
  const emailNormalizado = normalizarEmail(email);
  // Só limita por Cadastro quando o email tem formato válido: emails inválidos
  // criariam chaves de cardinalidade livre. `user+tag@x.com` continua sendo um
  // Cadastro distinto porque `normalizarEmail` (identidade de lookup) não
  // canoniza plus-addressing — a chave espelha a identidade real do Cadastro.
  if (emailNormalizado.length > 0 && validarFormatoEmail(emailNormalizado)) {
    itens.push({
      chave: `auth:rate:cadastro:${emailNormalizado}:${rota}`,
      maximo: authRateLimitMaxPorCadastro,
      janelaSegundos: authRateLimitJanelaSegundos,
    });
  }
  return itens;
}

function responderExcessoDeTentativas(res: Response, retryAfterSegundos: number): void {
  res.setHeader('Retry-After', String(retryAfterSegundos));
  res.status(429).json({ erros: [{ mensagem: MENSAGEM_EXCESSO }] });
}

async function aplicarLimiteDeTentativas(
  req: Request,
  res: Response,
  rota: 'login' | 'register',
  email: string,
): Promise<boolean> {
  const ip = ipDoCliente(req);
  if (ip === null) {
    console.error(`[auth/${rota}] não foi possível determinar o IP do cliente`);
    res.status(500).json({ erros: [{ mensagem: 'Erro interno do servidor.' }] });
    return false;
  }
  try {
    const limite = await consumirTentativas(chavesDeLimite(ip, rota, email));
    if (limite.excedido) {
      responderExcessoDeTentativas(res, limite.retryAfterSegundos);
      try {
        const emailHash = email.trim().length > 0 ? hashEmail(email) : undefined;
        securityLogger.warn({
          event: securityEvents.AUTH_RATE_LIMIT_EXCEEDED,
          rota,
          ip,
          emailHash,
          retryAfter: limite.retryAfterSegundos,
          requestId: getRequestId(req),
        });
      } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[auth/${rota}] rate limit error:`, error);
    res.status(500).json({ erros: [{ mensagem: 'Erro interno do servidor.' }] });
    return false;
  }
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

  if (!(await aplicarLimiteDeTentativas(req, res, 'register', emailBruto))) {
    return;
  }

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
  } else if (
    normalizarEmail(emailBruto).endsWith('@exemplo.local') ||
    normalizarEmail(emailBruto).endsWith('@bot.teste')
  ) {
    // Opção A (#365 item 4): @bot.teste é o domínio canônico de bots — usado
    // SÓ pelo BotRunner via INSERT direto (bypass intencional desta validação).
    // CLI e testes usam @teste.local via registro público. @exemplo.local é
    // legado reservado (linhas antigas). Nenhum dos dois passa no registro público.
    erros.push({ campo: 'email', mensagem: 'Domínio reservado para Cadastros internos.' });
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
    try {
      securityLogger.info({
        event: securityEvents.AUTH_REGISTER_SUCCESS,
        emailHash: hashEmail(emailNormalizado),
        ip: ipDoCliente(req),
        requestId: getRequestId(req),
        jogadorId: jogador.id,
      });
    } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
  } catch (error: unknown) {
    const pgError = error as PgError23505;
    if (pgError.code === '23505') {
      const campo = campoDoConstraint(pgError.constraint);
      if (campo === 'apelido') {
        res.status(409).json({ erros: [{ campo: 'apelido', mensagem: 'Apelido já está em uso.' }] });
        try {
          securityLogger.info({
            event: securityEvents.AUTH_REGISTER_CONFLICT,
            campo: 'apelido',
            emailHash: hashEmail(emailNormalizado),
            ip: ipDoCliente(req),
            requestId: getRequestId(req),
          });
        } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
        return;
      }
      if (campo === 'email') {
        res.status(409).json({ erros: [{ campo: 'email', mensagem: 'Email já está em uso.' }] });
        try {
          securityLogger.info({
            event: securityEvents.AUTH_REGISTER_CONFLICT,
            campo: 'email',
            emailHash: hashEmail(emailNormalizado),
            ip: ipDoCliente(req),
            requestId: getRequestId(req),
          });
        } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
        return;
      }
      res.status(409).json({ erros: [{ mensagem: 'Cadastro já existe.' }] });
      try {
        securityLogger.info({
          event: securityEvents.AUTH_REGISTER_CONFLICT,
          emailHash: hashEmail(emailNormalizado),
          ip: ipDoCliente(req),
          requestId: getRequestId(req),
        });
      } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
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

  if (!(await aplicarLimiteDeTentativas(req, res, 'login', emailBruto))) {
    return;
  }

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
      try {
        securityLogger.warn({
          event: securityEvents.AUTH_LOGIN_FAILURE,
          reason: 'email_not_found',
          emailHash: hashEmail(emailNormalizado),
          ip: ipDoCliente(req),
          requestId: getRequestId(req),
        });
      } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
      return;
    }

    const row = result.rows[0];
    const senhaValida = await bcrypt.compare(senhaBruta, row.senha).catch(() => false);
    if (!senhaValida) {
      responderErroNaoAutorizado(res);
      try {
        securityLogger.warn({
          event: securityEvents.AUTH_LOGIN_FAILURE,
          reason: 'invalid_password',
          emailHash: hashEmail(emailNormalizado),
          ip: ipDoCliente(req),
          requestId: getRequestId(req),
          jogadorId: row.id,
        });
      } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
      return;
    }

    const jogador: Jogador = { id: row.id, apelido: row.apelido, email: row.email };
    // criarSessao já revoga a sessão anterior (Sessão única por Jogador).
    const { sessaoId } = await criarSessao(jogador.id);
    // Troca de Sessão (issue #410): encerra NA HORA as conexões WS antigas
    // deste Jogador no processo lobby. O game-server é um processo separado
    // e só encerra no seu tick de revalidação (WS_SESSAO_REVALIDACAO_MS,
    // default 30000, teto 60000).
    registroDeConexoes.fecharPorJogador(jogador.id, CODIGO_SESSAO, MOTIVO_SESSAO_SUBSTITUIDA);
    emitirCookiesDeSessao(res, jogador, sessaoId);
    res.status(200).json(jogador);
    try {
      securityLogger.info({
        event: securityEvents.AUTH_LOGIN_SUCCESS,
        emailHash: hashEmail(emailNormalizado),
        ip: ipDoCliente(req),
        requestId: getRequestId(req),
        jogadorId: jogador.id,
      });
    } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
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
  // Logout (issue #410): encerra NA HORA as conexões WS vigentes do Jogador
  // no processo lobby. O game-server é um processo separado e só encerra no
  // seu tick de revalidação (WS_SESSAO_REVALIDACAO_MS, default 30000, teto 60000).
  registroDeConexoes.fecharPorJogador(jogador.id, CODIGO_SESSAO, MOTIVO_SESSAO_ENCERRADA);
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
    // A rotação troca o `sessaoId` da Sessão; migrar o registro das conexões
    // deste Jogador para o novo id fecha a janela em que `CRIAR_SALA`/`ENTRAR_NA_SALA`
    // ainda revalidariam o `sessaoId` antigo e responderiam 4401 indevido até o
    // próximo tick de revalidação (WS_SESSAO_REVALIDACAO_MS).
    registroDeConexoes.migrarSessaoPorJogador(payload.jogadorId, rotacionada.sessaoId);
    emitirCookiesDeSessao(res, jogador, rotacionada.sessaoId);
    res.status(200).json(jogador);
  } catch (error) {
    if (error instanceof SessaoInvalidaError) {
      // TOCTOU entre obterSessao e a rotação (refresh concorrente) ou reuso
      // de refresh já rotacionado — o script Lua detectou e sinalizou.
      res.status(401).json({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] });
      try {
        securityLogger.warn({
          event: securityEvents.AUTH_SESSION_REUSE,
          reason: 'refresh_reuse',
          ip: ipDoCliente(req),
          requestId: getRequestId(req),
          jogadorId: payload.jogadorId,
        });
      } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
      return;
    }
    console.error('[auth/refresh] error:', error);
    res.status(500).json({ erros: [{ mensagem: 'Erro interno do servidor.' }] });
  }
});
