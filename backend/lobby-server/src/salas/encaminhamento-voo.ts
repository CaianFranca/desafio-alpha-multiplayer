import type { Redis } from 'ioredis';

// Relógio do Encaminhamento em voo (review #304, spec item 3): marker Redis
// com o instante da oferta. Uma Sala encaminhada sem partidaId em qualquer
// fonte deixa de ser fail-closed para sempre quando o marker tem idade acima
// do teto do não-início — os Membros ficam liberados (ADR-0010, "Órfã sem
// partidaId"). Marker novo (idade <= teto) mantém a Sala presa: a admissão
// ainda pode completar. Markers anteriores ao deploy não existem: essas
// órfãs seguem pelo caminho antigo (expiração/TTL).
const PREFIXO = 'lobby:encaminhamento-voo:';
const TTL_SEGUNDOS = 24 * 60 * 60;

export function chaveDoEmVoo(salaId: string): string {
  return `${PREFIXO}${salaId}`;
}

export async function marcarEmVoo(redis: Redis, salaId: string): Promise<void> {
  await redis.set(chaveDoEmVoo(salaId), new Date().toISOString(), 'EX', TTL_SEGUNDOS);
}

export async function limparEmVoo(redis: Redis, salaId: string): Promise<void> {
  await redis.del(chaveDoEmVoo(salaId)).catch(() => undefined);
}

/** Idade do marker em ms; null sem marker ou timestamp inválido. */
export async function idadeDoEmVoo(redis: Redis, salaId: string): Promise<number | null> {
  const raw = await redis.get(chaveDoEmVoo(salaId)).catch(() => null);
  if (raw === null) return null;
  const instante = Date.parse(raw);
  if (!Number.isFinite(instante)) return null;
  return Math.max(0, Date.now() - instante);
}
