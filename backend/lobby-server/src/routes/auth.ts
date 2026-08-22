import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getConfig } from '@flicker/config';
import { pool } from '../config/pg.ts';

export const authRouter = Router();

interface RegisterBody {
  apelido?: string;
  email?: string;
  senha?: string;
}

interface LoginBody {
  email?: string;
  senha?: string;
}

function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validarEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

authRouter.post('/register', async (req, res) => {
  let { apelido, email, senha } = req.body as RegisterBody;

  apelido = apelido?.trim();
  email = email?.trim();
  // senha não faz trim para preservar espaços intencionais, mas valida vazia

  if (!apelido || !email || !senha) {
    res.status(400).json({ error: 'apelido, email e senha são obrigatórios' });
    return;
  }

  if (apelido.length < 3 || apelido.length > 20) {
    res.status(400).json({ error: 'apelido deve ter entre 3 e 20 caracteres' });
    return;
  }

  if (!validarEmail(email)) {
    res.status(400).json({ error: 'email inválido' });
    return;
  }

  if (senha.length < 8) {
    res.status(400).json({ error: 'senha deve ter no mínimo 8 caracteres' });
    return;
  }

  const emailNormalizado = normalizarEmail(email);

  try {
    const hash = await bcrypt.hash(senha, 10);

    const result = await pool.query(
      `INSERT INTO usuarios (apelido, email, senha)
       VALUES ($1, $2, $3)
       RETURNING id, apelido, email`,
      [apelido, emailNormalizado, hash],
    );

    res.status(201).json(result.rows[0]);
  } catch (error: unknown) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505') {
      // Mensagem genérica mantém compatibilidade com bootstrap; detalhe por campo virá em ST-04
      res.status(409).json({ error: 'apelido ou email já cadastrado' });
      return;
    }
    console.error('[auth/register] error:', error);
    res.status(500).json({ error: 'erro interno' });
  }
});

authRouter.post('/login', async (req, res) => {
  let { email, senha } = req.body as LoginBody;

  email = email?.trim();

  if (!email || !senha) {
    res.status(400).json({ error: 'email e senha são obrigatórios' });
    return;
  }

  const emailNormalizado = normalizarEmail(email);

  try {
    const result = await pool.query(
      `SELECT id, apelido, email, senha FROM usuarios WHERE email = $1 LIMIT 1`,
      [emailNormalizado],
    );

    if (result.rowCount === 0) {
      res.status(401).json({ error: 'credenciais inválidas' });
      return;
    }

    const user = result.rows[0] as {
      id: string;
      apelido: string;
      email: string;
      senha: string;
    };

    let senhaValida = false;
    let precisaMigrar = false;

    try {
      senhaValida = await bcrypt.compare(senha, user.senha);
    } catch {
      senhaValida = false;
    }

    if (!senhaValida && user.senha === senha) {
      senhaValida = true;
      precisaMigrar = true;
    }

    if (!senhaValida) {
      res.status(401).json({ error: 'credenciais inválidas' });
      return;
    }

    if (precisaMigrar) {
      try {
        const novoHash = await bcrypt.hash(senha, 10);
        await pool.query(`UPDATE usuarios SET senha = $1 WHERE id = $2`, [novoHash, user.id]);
      } catch (migrateError) {
        console.error('[auth/login] auto-migração falhou:', migrateError);
      }
    }

    const { jwtSecret } = getConfig();
    const token = jwt.sign(
      { id: user.id, apelido: user.apelido, email: user.email },
      jwtSecret,
      { expiresIn: '15m' },
    );

    res.status(200).json({ token });
  } catch (error) {
    console.error('[auth/login] error:', error);
    res.status(500).json({ error: 'erro interno' });
  }
});
