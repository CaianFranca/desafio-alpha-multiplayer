// Geração do Código de Sala (issue #36) — seis caracteres alfanuméricos
// maiúsculos únicos, conforme `salas_historico.codigo_sala` (CHECK ^[A-Z0-9]{6}$)
// e glossário (CONTEXT.md, "Código de Sala").
//
// Estratégia: random + retry em colisão 23505 do UNIQUE
// `salas_historico_codigo_sala_unique`. O handler calcula primeiro o estado
// candidato no engine e só então tenta persistir a Sala. Assim não há Sala
// fantasma no PostgreSQL nem compensação após uma rejeição do domínio.

import { randomBytes } from 'node:crypto';
const CODIGO_TAMANHO = 6;
const CODIGO_ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const CODIGO_MAX_TENTATIVAS = 5;

/** Exceção lançada quando as 5 tentativas esgotam sem codigo livre. */
export class CodigoDeSalaIndisponivelError extends Error {
  constructor() {
    super(
      'Não foi possível gerar um Código de Sala único após 5 tentativas.',
    );
    this.name = 'CodigoDeSalaIndisponivelError';
  }
}

/** Gera um codigo aleatório de 6 caracteres `[A-Z0-9]`. */
export function gerarCodigoDeSala(): string {
  const bytes = randomBytes(CODIGO_TAMANHO);
  let out = '';
  for (let i = 0; i < CODIGO_TAMANHO; i++) {
    // 256 % 36 = 4 → viés mínimo (~0.4% por classe); irrelevante para
    // identificar Salas visualmente. Para 6 chars, espaço total ≈ 2.2e9.
    out += CODIGO_ALFABETO[bytes[i] % CODIGO_ALFABETO.length];
  }
  return out;
}

interface PgError23505 {
  code?: string;
  constraint?: string;
}

export function ehColisaoDeCodigo(erro: unknown): boolean {
  const pg = erro as PgError23505;
  return (
    pg !== null
    && typeof pg === 'object'
    && pg.code === '23505'
    && (
      pg.constraint === 'salas_historico_codigo_sala_unique'
      // Compatibilidade com bancos criados por uma versão anterior da
      // migration, que nomeava o UNIQUE com o sufixo padrão `_key`.
      || pg.constraint === 'salas_historico_codigo_sala_key'
    )
  );
}
