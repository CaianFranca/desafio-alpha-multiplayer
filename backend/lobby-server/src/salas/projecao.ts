// Projeção quente das Salas no Redis (ADR-0002).
//
// Modelo: chaves de lookup/plugar para resolver rapidamente a sala de um
// jogador e o codigo de uma sala. TTL constante `PROJECAO_TTL_SEGUNDOS` cobre
// o ciclo de reconexão do MVP; dados permanentes vivem no PG.
//
//   lobby:sala:<salaId>:estado         -> JSON SalaEstado (TTL)
//   lobby:sala:codigo:<codigo>         -> salaId (TTL)
//   lobby:jogador:<jogadorId>:sala     -> salaId (TTL)
//
// `lobby:sala:<id>:estado` mantém a forma do engine para o handler traduzir
// sem custo extra de recomposição; a fonte da verdade continua sendo o PG
// (reconstruída no boot).

import type { Redis } from 'ioredis';
import type { Sala as SalaDominio } from '@flicker/engine';
import { redisClient as defaultRedis } from '../config/redis.ts';

const PROJECAO_TTL_SEGUNDOS = 3600;
const PREFIXO_SALA = 'lobby:sala:';
const PREFIXO_CODIGO = 'lobby:sala:codigo:';
const PREFIXO_JOGADOR_SALA = 'lobby:jogador:';
const SUFIXO_ESTADO = ':estado';
const SUFIXO_SALA = ':sala';

export interface MembroEstadoProjecao {
  readonly id: string;
  readonly jogadorId: string;
  readonly ordemDeEntrada: number;
  readonly pronto: boolean;
  readonly presenca: 'conectado' | 'em_reconexao';
  readonly anfitriao: boolean;
}

export interface SalaEstadoProjecao {
  readonly id: string;
  readonly codigo: string;
  readonly estado: 'aberta' | 'encaminhada' | 'encerrada' | 'expirada';
  readonly anfitriaoId: string | null;
  readonly proximaOrdemDeEntrada: number;
  readonly consistente: boolean;
  readonly membros: readonly MembroEstadoProjecao[];
}

function chaveSalaEstado(salaId: string): string {
  return `${PREFIXO_SALA}${salaId}${SUFIXO_ESTADO}`;
}

/** Exportadas para os testes simularem a expiração do TTL por chave. */
export function chaveSalaCodigo(codigo: string): string {
  return `${PREFIXO_CODIGO}${codigo}`;
}

export function chaveJogadorSala(jogadorId: string): string {
  return `${PREFIXO_JOGADOR_SALA}${jogadorId}${SUFIXO_SALA}`;
}

/**
 * Converte a Sala do domínio para a forma da projeção quente no Redis.
 * Único ponto de tradução engine→projeção; usado pela reconstrução do boot
 * (`SalasState.carregar`) e pelas mutações (`SalasHandlers`).
 */
export function serializarSala(sala: SalaDominio): SalaEstadoProjecao {
  const membros: MembroEstadoProjecao[] = sala.membros
    .filter((m) => m.estado === 'ativo')
    .map((m) => ({
      id: m.id,
      jogadorId: m.jogadorId,
      ordemDeEntrada: m.ordemDeEntrada,
      pronto: m.pronto,
      presenca: m.presenca,
      anfitriao: sala.anfitriaoId === m.id,
    }));
  return {
    id: sala.id,
    codigo: sala.codigo,
    estado: sala.estado,
    anfitriaoId: sala.anfitriaoId,
    proximaOrdemDeEntrada: sala.proximaOrdemDeEntrada,
    consistente: sala.consistente,
    membros,
  };
}

export class SalasProjecao {
  private readonly redis: Redis;

  constructor(redis: Redis = defaultRedis) {
    this.redis = redis;
  }

  async definirEstadoSala(salaId: string, estado: SalaEstadoProjecao): Promise<void> {
    await this.redis.set(
      chaveSalaEstado(salaId),
      JSON.stringify(estado),
      'EX',
      PROJECAO_TTL_SEGUNDOS,
    );
  }

  async obterEstadoSala(salaId: string): Promise<SalaEstadoProjecao | null> {
    const raw = await this.redis.get(chaveSalaEstado(salaId));
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as SalaEstadoProjecao;
    } catch {
      return null;
    }
  }

  async definirCodigo(codigo: string, salaId: string): Promise<void> {
    await this.redis.set(
      chaveSalaCodigo(codigo),
      salaId,
      'EX',
      PROJECAO_TTL_SEGUNDOS,
    );
  }

  async obterSalaIdPorCodigo(codigo: string): Promise<string | null> {
    return this.redis.get(chaveSalaCodigo(codigo));
  }

  async removerCodigo(codigo: string): Promise<void> {
    await this.redis.del(chaveSalaCodigo(codigo));
  }

  async definirAssociacaoJogador(jogadorId: string, salaId: string): Promise<void> {
    await this.redis.set(
      chaveJogadorSala(jogadorId),
      salaId,
      'EX',
      PROJECAO_TTL_SEGUNDOS,
    );
  }

  async obterAssociacaoJogador(jogadorId: string): Promise<string | null> {
    return this.redis.get(chaveJogadorSala(jogadorId));
  }

  async limparAssociacaoJogador(jogadorId: string): Promise<void> {
    await this.redis.del(chaveJogadorSala(jogadorId));
  }

  /**
   * TTL do marcador de presença. Segue a constante `PROJECAO_TTL_SEGUNDOS`
   * — sem cobertura de expiração neste escopo (mesma restrição documentada
   * em `auth.integration.test.ts`).
   */
  async definirPresenca(jogadorId: string, salaId: string): Promise<void> {
    await this.definirAssociacaoJogador(jogadorId, salaId);
  }

  async definirProntidao(_jogadorId: string, _salaId: string): Promise<void> {
    // A prontidão é parte do `SalaEstadoProjecao.membros` — atualizada
    // implicitamente via `definirEstadoSala` quando o handler processa o
    // evento `prontidao_alterada`. Mantido como no-op na assinatura para
    // simetria da API documentada no plano.
  }

  /** Limpa toda a projeção referente a uma sala (estado + codigo). */
  async limparSala(salaId: string, codigo: string): Promise<void> {
    await this.redis.del(chaveSalaEstado(salaId));
    await this.redis.del(chaveSalaCodigo(codigo));
  }
}
