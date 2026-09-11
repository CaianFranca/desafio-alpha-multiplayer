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
import type { EncaminhamentoDaSala } from '@flicker/shared';
import { pool as defaultPool } from '../config/pg.ts';

export type MotivoDeTermino = 'saida' | 'expulsao' | 'expiracao' | 'encerramento';
export type StatusDaSala = 'aberta' | 'encaminhada' | 'encerrada' | 'expirada';

export interface SalaAberta {
  readonly id: string;
  readonly codigo: string;
  readonly anfitriaoId: string | null;
}

export interface SalaAtiva extends SalaAberta {
  readonly status: StatusDaSala;
  readonly serverId: string | null;
  readonly partidaId: string | null;
}

export type EncaminhamentoPersistido = EncaminhamentoDaSala;

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

  /** Lista salas ativas (aberta + encaminhada) com server/partida para boot. */
  async listarSalasAtivas(): Promise<SalaAtiva[]> {
    const resultado = await this.pool.query<QueryResultRow & SalaAtiva>(
      `SELECT id, codigo_sala AS codigo, anfitriao_id AS "anfitriaoId", status, server_id AS "serverId", partida_id AS "partidaId"
       FROM salas_historico
       WHERE status IN ('aberta', 'encaminhada')
       ORDER BY id`,
    );
    return resultado.rows.map((linha) => ({
      id: linha.id,
      codigo: linha.codigo,
      anfitriaoId: linha.anfitriaoId,
      status: linha.status as StatusDaSala,
      serverId: (linha.serverId as string | null) ?? null,
      partidaId: (linha.partidaId as string | null) ?? null,
    }));
  }

  /**
   * Persiste o encaminhamento: marca a sala como encaminhada com server/partida.
   * Usado no aceite do handoff após revalidação do engine.
   */
  async persistirEncaminhamento(salaId: string, serverId: string, partidaId: string): Promise<void> {
    const resultado = await this.pool.query(
      `UPDATE salas_historico SET status = 'encaminhada', server_id = $2, partida_id = $3 WHERE id = $1`,
      [salaId, serverId, partidaId],
    );
    if (resultado.rowCount !== 1) {
      throw new Error(`Sala não encontrada ao persistir encaminhamento ${salaId}`);
    }
  }

  /**
   * Reabre a sala encaminhada: volta para 'aberta' e limpa server/partida.
   * Usado no retorno da partida (issue #178). Só afeta linhas com
   * status='encaminhada' — garante idempotência ao nível do PG (segunda
   * chamada com status 'aberta' não altera nada).
   * Retorna true quando houve mutação, false quando já estava aberta.
   * @deprecated usar reabrirSalaComMarkerAtomico para durabilidade PG+marker atômica
   */
  async reabrirSalaAtomico(salaId: string): Promise<boolean> {
    const resultado = await this.pool.query(
      `UPDATE salas_historico SET status = 'aberta', server_id = NULL, partida_id = NULL WHERE id = $1 AND status = 'encaminhada'`,
      [salaId],
    );
    return (resultado.rowCount ?? 0) === 1;
  }

  /**
   * Reabre a sala e grava o marker de idempotência na mesma transação PG.
   * Elimina a janela de crash entre UPDATE e INSERT (bloqueante #185):
   *   UPDATE salas_historico + INSERT sala_reaberta_markers em BEGIN/COMMIT
   * Retorna true quando houve mutação, false quando já estava aberta.
   * Tabela criada via migration 20260902000000 (FK ON DELETE CASCADE).
   */
  async reabrirSalaComMarkerAtomico(salaId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query(
        `UPDATE salas_historico SET status = 'aberta', server_id = NULL, partida_id = NULL WHERE id = $1 AND status = 'encaminhada'`,
        [salaId],
      );
      if ((upd.rowCount ?? 0) !== 1) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO sala_reaberta_markers (sala_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [salaId],
      );
      await client.query('COMMIT');
      return true;
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw erro;
    } finally {
      client.release();
    }
  }

  async marcarReabertaPersistido(salaId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sala_reaberta_markers (sala_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [salaId],
    );
  }

  async foiReabertaPersistido(salaId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM sala_reaberta_markers WHERE sala_id = $1 LIMIT 1`, [salaId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Registro bruto da sala (inclui encaminhada e aberta) — usado na revalidação do retorno (#178). */
  async obterSalaBruta(
    salaId: string,
  ): Promise<{ id: string; codigo: string; anfitriaoId: string | null; status: StatusDaSala; serverId: string | null; partidaId: string | null } | null> {
    const resultado = await this.pool.query<{
      id: string;
      codigo: string;
      anfitriaoId: string | null;
      status: string;
      serverId: string | null;
      partidaId: string | null;
    }>(
      `SELECT id, codigo_sala AS codigo, anfitriao_id AS "anfitriaoId", status, server_id AS "serverId", partida_id AS "partidaId"
       FROM salas_historico WHERE id = $1 LIMIT 1`,
      [salaId],
    );
    const linha = resultado.rows[0];
    if (!linha) return null;
    return {
      id: linha.id,
      codigo: linha.codigo,
      anfitriaoId: linha.anfitriaoId,
      status: linha.status as StatusDaSala,
      serverId: linha.serverId ?? null,
      partidaId: linha.partidaId ?? null,
    };
  }

  /** Obtém server/partida de uma sala encaminhada (null se não encaminhada). */
  async obterEncaminhamento(salaId: string): Promise<EncaminhamentoPersistido | null> {
    const resultado = await this.pool.query<{ server_id: string | null; partida_id: string | null }>(
      `SELECT server_id, partida_id FROM salas_historico WHERE id = $1 AND status = 'encaminhada' LIMIT 1`,
      [salaId],
    );
    const linha = resultado.rows[0];
    if (!linha || !linha.server_id || !linha.partida_id) return null;
    return { serverId: linha.server_id, partidaId: linha.partida_id };
  }

  /** Resolve sala ativa (aberta ou encaminhada) do jogador — inclui encaminhada para snapshot. */
  async obterSalaAtivaDoJogador(jogadorId: string): Promise<string | null> {
    const resultado = await this.pool.query<{ salaId: string }>(
      `SELECT m.sala_id AS "salaId"
       FROM membros m
       JOIN salas_historico s ON s.id = m.sala_id
       WHERE m.usuario_id = $1 AND m.bloqueado = false AND s.status IN ('aberta', 'encaminhada')
       ORDER BY m.ordem_de_entrada ASC
       LIMIT 1`,
      [jogadorId],
    );
    return resultado.rows[0]?.salaId ?? null;
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
   * Persiste o encerramento explícito da Sala pelo Anfitrião. Todos os
   * vínculos ativos viram histórico com motivo `encerramento` e a Sala
   * passa para `encerrada` com `anfitriao_id = NULL`.
   * Atomicamente: SELECT ativos → DELETE ativos → INSERT histórico → UPDATE status.
   */
  async encerrarSalaAtomico(salaId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const membros = await client.query<{ usuario_id: string }>(
        `SELECT usuario_id FROM membros WHERE sala_id = $1 AND bloqueado = false FOR UPDATE`,
        [salaId],
      );
      for (const linha of membros.rows) {
        await client.query(
          `INSERT INTO membros_historico (sala_id, usuario_id, motivo_de_termino)
           VALUES ($1, $2, 'encerramento')`,
          [salaId, linha.usuario_id],
        );
      }
      await client.query(`DELETE FROM membros WHERE sala_id = $1 AND bloqueado = false`, [salaId]);
      await client.query(
        `UPDATE salas_historico SET status = 'encerrada', anfitriao_id = NULL WHERE id = $1`,
        [salaId],
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
   * Remove o vínculo de um bot efêmero SEM bloquear: deleta a linha de
   * `membros` (não marca `bloqueado=true`) + histórico com motivo `expulsao`. O Cadastro é
   * purgado em seguida via `purgarCadastroDeBot` — sem isso, cada expulsão
   * deixaria um apelido ocupado globalmente até o TTL de 2h e o pool de 20
   * nomes esgotaria ("Falha ao iniciar bot").
   */
  async removerBotDaSalaAtomico(
    salaId: string,
    jogadorId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const exclusao = await client.query(
        `DELETE FROM membros WHERE sala_id = $1 AND usuario_id = $2 AND bloqueado = false`,
        [salaId, jogadorId],
      );
      if (exclusao.rowCount !== 1) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(
          'Vínculo ativo não encontrado ao remover bot da Sala.',
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
   * Purga o Cadastro efêmero do bot, liberando o apelido global. Best-effort:
   * retorna false quando nada foi removido (ex.: bot referenciado como
   * `anfitriao_id` sem ON DELETE — cai no GC de 2h do job de expiração).
   * Roda FORA da transação de remoção do vínculo para nunca desfazer a
   * expulsão por causa da purga.
   */
  async purgarCadastroDeBot(jogadorId: string): Promise<boolean> {
    const resultado = await this.pool.query(
      `DELETE FROM usuarios WHERE id = $1 AND bot = true`,
      [jogadorId],
    );
    return (resultado.rowCount ?? 0) === 1;
  }

  /** Verdadeiro quando o jogador é um Cadastro bot efêmero. */
  async ehBot(jogadorId: string): Promise<boolean> {
    const resultado = await this.pool.query<{ bot: boolean | null }>(
      `SELECT bot FROM usuarios WHERE id = $1 LIMIT 1`,
      [jogadorId],
    );
    return resultado.rows[0]?.bot === true;
  }

  /**
   * Flags bot de vários jogadores em uma única query — hidratação do cache
   * `botPorJogadorId` no boot (par de `obterApelidos`).
   */
  async obterFlagsDeBot(jogadorIds: readonly string[]): Promise<Map<string, boolean>> {
    if (jogadorIds.length === 0) {
      return new Map();
    }
    const resultado = await this.pool.query<{ id: string; bot: boolean | null }>(
      `SELECT id, bot FROM usuarios WHERE id = ANY($1::uuid[])`,
      [jogadorIds as readonly string[]],
    );
    return new Map(resultado.rows.map((linha) => [linha.id, linha.bot === true]));
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
