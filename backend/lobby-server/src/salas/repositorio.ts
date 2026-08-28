// Repositório de Salas no PostgreSQL (write-model, ADR-0002).
// `salas_historico` é a fonte da verdade: ordem, anfitrião e status da Sala
// sobrevivem a reinício do lobby. Membros ativos vivem em `membros`; o
// histórico de saída/expulsão/expiração/encerramento vive em `membros_historico`
// (ver migration `20260822174539_create_salas_historico_e_membros`).
//
// As transições que envolvem mais de uma linha usam transações explícitas:
// criar Sala+Anfitrião e registrar uma saída+histórico+eventual encerramento.

import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { pool as defaultPool } from '../config/pg.ts';

export type MotivoDeTermino = 'saida' | 'expulsao' | 'expiracao' | 'encerramento';
export type StatusDaSala = 'aberta' | 'encaminhada' | 'encerrada' | 'expirada';

export interface SalaAberta {
  readonly id: string;
  readonly codigo: string;
  readonly anfitriaoId: string | null;
}

export interface MembroPersistido {
  readonly jogadorId: string;
  readonly ordem: number;
  readonly bloqueado: boolean;
}

interface PgError23505 {
  code?: string;
  constraint?: string;
}

export class SalasRepo {
  private readonly pool: Pool;

  constructor(poolArg: Pool = defaultPool) {
    this.pool = poolArg;
  }

  /**
   * Cria a sala e o vínculo do anfitrião em uma transação.
   * `pool.connect()` reserva um cliente do pool para garantir atomicidade
   * entre os dois INSERTs; o cliente é devolvido ao pool em `finally`.
   *
   * `codigo` é o último parâmetro porque o gerador de codigo
   * (`codigo.ts`) é o caller natural — o fluxo "gera codigo, tenta
   * inserir, em 23505 tenta de novo" quer o codigo como dado da iteração,
   * não como chave de busca.
   */
  async criarSalaAtomica(
    salaId: string,
    anfitriaoId: string,
    ordemInicial: number,
    codigo: string,
  ): Promise<void> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO salas_historico (id, codigo_sala, status, anfitriao_id)
         VALUES ($1, $2, 'aberta', $3)`,
        [salaId, codigo, anfitriaoId],
      );
      await client.query(
        `INSERT INTO membros (sala_id, usuario_id, ordem_de_entrada, bloqueado)
         VALUES ($1, $2, $3, false)`,
        [salaId, anfitriaoId, ordemInicial],
      );
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw erro;
    } finally {
      client.release();
    }
  }

  /**
   * Insere um vínculo ativo. Lança `23505` em PK (sala_id, usuario_id)
   * duplicada; o handler só chama esta operação quando o engine emitiu
   * `membro_admitido`, portanto a colisão é uma divergência a ser reportada.
   */
  async entrarMembro(salaId: string, jogadorId: string, ordem: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO membros (sala_id, usuario_id, ordem_de_entrada, bloqueado)
       VALUES ($1, $2, $3, false)`,
      [salaId, jogadorId, ordem],
    );
  }

  private async terminarVinculoAtomico(
    salaId: string,
    jogadorId: string,
    motivo: MotivoDeTermino,
    statusEncerramento: StatusDaSala | null,
    novoAnfitriaoJogadorId?: string | null,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const exclusao = await client.query(
        `DELETE FROM membros WHERE sala_id = $1 AND usuario_id = $2`,
        [salaId, jogadorId],
      );
      if (exclusao.rowCount !== 1) {
        throw new Error(`Vínculo ativo não encontrado ao persistir ${motivo} da Sala.`);
      }
      await client.query(
        `INSERT INTO membros_historico (sala_id, usuario_id, motivo_de_termino)
         VALUES ($1, $2, $3)`,
        [salaId, jogadorId, motivo],
      );
      if (statusEncerramento !== null) {
        await client.query(
          `UPDATE salas_historico SET status = $2, anfitriao_id = NULL WHERE id = $1`,
          [salaId, statusEncerramento],
        );
      } else if (novoAnfitriaoJogadorId != null) {
        await client.query(
          `UPDATE salas_historico SET anfitriao_id = $2 WHERE id = $1`,
          [salaId, novoAnfitriaoJogadorId],
        );
      }
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw erro;
    } finally {
      client.release();
    }
  }

  /**
   * Persiste a saída em uma única transação. Quando o engine concluiu que
   * era o último vínculo ativo, a mudança para `encerrada` é confirmada no
   * mesmo commit do DELETE e do histórico. Quando houve sucessão, o novo
   * Anfitrião é gravado no mesmo commit — sem isso, a reconstrução do boot
   * restauraria um Anfitrião já sucedido (ADR-0002).
   */
  async sairMembroAtomico(
    salaId: string,
    jogadorId: string,
    motivo: MotivoDeTermino,
    encerrarSala: boolean,
    novoAnfitriaoJogadorId?: string | null,
  ): Promise<void> {
    await this.terminarVinculoAtomico(
      salaId,
      jogadorId,
      motivo,
      encerrarSala ? 'encerrada' : null,
      novoAnfitriaoJogadorId,
    );
  }

  /**
   * Persiste a expiração da janela de reconexão (issue #38).
   * Similar a `sairMembroAtomico`, mas com motivo='expiracao' e status
   * 'expirada' quando o último vínculo ativo expira. Mantém a mesma
   * atomicidade: DELETE + histórico + eventual atualização de anfitrião/status
   * no mesmo commit.
   */
  async expirarMembroAtomico(
    salaId: string,
    jogadorId: string,
    encerrarSala: boolean,
    novoAnfitriaoJogadorId?: string | null,
  ): Promise<void> {
    await this.terminarVinculoAtomico(
      salaId,
      jogadorId,
      'expiracao',
      encerrarSala ? 'expirada' : null,
      novoAnfitriaoJogadorId,
    );
  }

  /** Lista as salas com `status='aberta'` para reconstrução no boot. */
  async listarSalasAbertas(): Promise<SalaAberta[]> {
    const resultado = await this.pool.query<QueryResultRow & SalaAberta>(
      `SELECT id, codigo_sala AS codigo, anfitriao_id AS "anfitriaoId"
       FROM salas_historico
       WHERE status = 'aberta'
       ORDER BY id`,
    );
    return resultado.rows.map((linha) => ({
      id: linha.id,
      codigo: linha.codigo,
      anfitriaoId: linha.anfitriaoId,
    }));
  }

  /**
   * Lista os membros ativos (vinculados) de uma sala, ordenados por
   * `ordem_de_entrada` ascendente. Usado na reconstrução para montar o
   * vetor `Sala.membros` do engine.
   */
  async listarMembrosDaSala(salaId: string): Promise<MembroPersistido[]> {
    const resultado = await this.pool.query<QueryResultRow & MembroPersistido>(
      `SELECT usuario_id AS "jogadorId", ordem_de_entrada AS ordem, bloqueado
       FROM membros
       WHERE sala_id = $1
       ORDER BY ordem_de_entrada ASC`,
      [salaId],
    );
    return resultado.rows;
  }

  /**
   * Persiste a expulsão em uma única transação. A linha de `membros` é
   * marcada como `bloqueado=true` (não deletada) — a PK composta impede
   * reentrada. Um registro é inserido em `membros_historico` com motivo
   * `expulsao`.
   */
  async expulsarMembroAtomico(
    salaId: string,
    jogadorId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const atualizacao = await client.query(
        `UPDATE membros SET bloqueado = true
         WHERE sala_id = $1 AND usuario_id = $2 AND bloqueado = false`,
        [salaId, jogadorId],
      );
      if (atualizacao.rowCount !== 1) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(
          'Vínculo ativo não encontrado ou já bloqueado ao persistir expulsão.',
        );
      }
      await client.query(
        `INSERT INTO membros_historico (sala_id, usuario_id, motivo_de_termino)
         VALUES ($1, $2, 'expulsao')`,
        [salaId, jogadorId],
      );
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw erro;
    } finally {
      client.release();
    }
  }

  /**
   * Desbloqueia um membro removendo sua linha da tabela `membros`. A
   * remoção física desfaz o bloqueio — o jogador pode reentrar com uma
   * nova PK composta.
   */
  async desbloquearMembro(
    salaId: string,
    jogadorId: string,
  ): Promise<void> {
    const resultado = await this.pool.query(
      `DELETE FROM membros
       WHERE sala_id = $1 AND usuario_id = $2 AND bloqueado = true`,
      [salaId, jogadorId],
    );
    if (resultado.rowCount !== 1) {
      throw new Error(
        'Membro bloqueado não encontrado ao desbloquear.',
      );
    }
  }

  /**
   * Resolve a Sala aberta pelo Código diretamente no write-model. Fallback
   * quando a chave `lobby:sala:codigo:<codigo>` expira no Redis (TTL) —
   * o ADR-0002 garante que `salas_historico` é a fonte da verdade.
   */
  async obterSalaAbertaPorCodigo(codigo: string): Promise<string | null> {
    const resultado = await this.pool.query<{ id: string }>(
      `SELECT id FROM salas_historico
       WHERE codigo_sala = $1 AND status = 'aberta'
       LIMIT 1`,
      [codigo],
    );
    return resultado.rows[0]?.id ?? null;
  }

  /**
   * Resolve a Sala aberta em que o Jogador tem vínculo ativo, pelo
   * write-model. Fallback quando a chave `lobby:jogador:<id>:sala` expira.
   * O domínio garante no máximo uma Sala ativa por Jogador; a ordenação
   * por ordem de entrada é defensiva.
   */
  async obterSalaAbertaDoJogador(jogadorId: string): Promise<string | null> {
    const resultado = await this.pool.query<{ salaId: string }>(
      `SELECT m.sala_id AS "salaId"
       FROM membros m
       JOIN salas_historico s ON s.id = m.sala_id
       WHERE m.usuario_id = $1 AND m.bloqueado = false AND s.status = 'aberta'
       ORDER BY m.ordem_de_entrada ASC
       LIMIT 1`,
      [jogadorId],
    );
    return resultado.rows[0]?.salaId ?? null;
  }

  /**
   * Apelido de um jogador, para preencher o campo `MembroDaSala.apelido`
   * do wire (o engine só conhece `jogadorId`). Usado na reconstrução para
   * hidratar o cache de apelidos; em runtime os apelidos chegam via
   * `WsAuthData.apelido` no handshake do WS.
   */
  async obterApelido(jogadorId: string): Promise<string | null> {
    const resultado = await this.pool.query<{ apelido: string }>(
      `SELECT apelido FROM usuarios WHERE id = $1 LIMIT 1`,
      [jogadorId],
    );
    return resultado.rows[0]?.apelido ?? null;
  }

  /**
   * Apelidos de vários jogadores em uma única query — usado na
   * reconstrução para preencher o cache de uma vez.
   */
  async obterApelidos(jogadorIds: readonly string[]): Promise<Map<string, string>> {
    if (jogadorIds.length === 0) {
      return new Map();
    }
    const resultado = await this.pool.query<{ id: string; apelido: string }>(
      `SELECT id, apelido FROM usuarios WHERE id = ANY($1::uuid[])`,
      [jogadorIds as readonly string[]],
    );
    return new Map(resultado.rows.map((linha) => [linha.id, linha.apelido]));
  }
}

/** Identifica 23505 em qualquer constraint — util para testes/debug. */
export function ehViolacaoDeUnique(erro: unknown, constraint?: string): boolean {
  const pg = erro as PgError23505;
  if (pg?.code !== '23505') {
    return false;
  }
  if (constraint === undefined) {
    return true;
  }
  return pg.constraint === constraint;
}

/** Gera um UUID v4 — usado para `salaId` e `membroId` no handler. */
export function gerarUuid(): string {
  return randomUUID();
}
