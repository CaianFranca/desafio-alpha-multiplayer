// Histórico do chat de Partida em lista Redis própria (issue #388).
//
// Modelo: `game-server:partida-chat:<partidaId>` (lista, fora do blob de
// estado) com teto configurável (default 50, faixa 1..200) somando humanas +
// bot, com aparo no topo, mesmo ciclo de vida/TTL das chaves da Partida:
//   - nasce no primeiro RPUSH com EXPIRE espelhando o TTL restante da partida
//     (lista vazia não existe no Redis — preparada sem mensagens não tem chave);
//   - PERSIST em `em_andamento` (espelha o PERSIST da transição);
//   - EXPIRE com a retenção de término;
//   - DEL em cancelamento e não-início.
// Leitura via LRANGE 0..-1 (ordem oldest→newest, a ordem do fan-out live).
// Escrita atômica via Lua (`RPUSH+LTRIM+espelho de TTL` num único EVAL) +
// cadeia serial por Partida (`enfileirarMutacao` em handlers.ts): o Lua fecha
// a janela RPUSH→LTRIM→TTL→EXPIRE dentro do Redis; a cadeia fecha a janela
// entre o julgamento e a escrita. Garantia intra-processo mononodo — 2
// instâncias de game-server quebram a ordem (ADR-0003 horizontal futuro, fora
// do escopo da #388).

import type { Redis } from 'ioredis';
import type { MensagemDeChatDaPartidaEvento } from '@flicker/shared';
import { DEFAULT_PARTIDA_CHAT_HISTORICO_MAXIMO } from '@flicker/config';
import { chaveDaPartida, chaveDoChatDaPartida } from './chaves.ts';

/** Default do teto (fonte única em `@flicker/config`, issue #388). */
export const HISTORICO_DE_CHAT_MAXIMO_PADRAO = DEFAULT_PARTIDA_CHAT_HISTORICO_MAXIMO;

/**
 * Normaliza o teto do histórico para a faixa 1..200 (default 50 em fonte
 * única). Fallback inválido com `warn` — o chamador segue com o default em
 * vez de recusar o live.
 */
export function normalizarTetoDoHistorico(maximo: number | undefined): number {
  if (maximo === undefined) {
    return HISTORICO_DE_CHAT_MAXIMO_PADRAO;
  }
  if (Number.isInteger(maximo) && maximo >= 1 && maximo <= 200) {
    return maximo;
  }
  console.warn('[historico-chat] teto inválido, usando default', {
    maximo,
    default: HISTORICO_DE_CHAT_MAXIMO_PADRAO,
  });
  return HISTORICO_DE_CHAT_MAXIMO_PADRAO;
}

// Escrita atômica do histórico (R1/R2): RPUSH + LTRIM `-teto..-1` + espelho
// de TTL num único EVAL. `ttl==0` ≡ partida expirando → DEL do chat, nunca
// PERSIST (órfão sem TTL é pior que perda da última mensagem).
const SCRIPT_ADICIONAR_AO_HISTORICO = `
local chaveChat = KEYS[1]
local chavePartida = KEYS[2]
local payload = ARGV[1]
local teto = tonumber(ARGV[2])
redis.call('RPUSH', chaveChat, payload)
redis.call('LTRIM', chaveChat, -teto, -1)
local ttl = redis.call('TTL', chavePartida)
if ttl == -2 then
  redis.call('DEL', chaveChat)
  return -2
elseif ttl == -1 then
  redis.call('PERSIST', chaveChat)
  return -1
elseif ttl > 0 then
  redis.call('EXPIRE', chaveChat, ttl)
  return ttl
else
  redis.call('DEL', chaveChat)
  return 0
end
`.trim();

/**
 * Persiste uma mensagem aprovada (humana ou bot) no histórico, aparando o topo
 * para o teto e espelhando o TTL restante da Partida na lista — tudo num
 * único EVAL Lua (atômico no Redis). Falhas de Redis são propagadas — o
 * chamador (handlers.ts) as trata como warn sem recusar o live.
 */
export async function adicionarMensagemAoHistorico(
  redis: Redis,
  partidaId: string,
  mensagem: MensagemDeChatDaPartidaEvento,
  maximo?: number,
): Promise<void> {
  const teto = normalizarTetoDoHistorico(maximo);
  const chaveChat = chaveDoChatDaPartida(partidaId);
  // Mantém as `teto` mais novas (aparo no topo/oldest): RPUSH anexa no tail,
  // então LTRIM -teto..-1 preserva o sufixo newest na ordem oldest→newest.
  // Espelha o ciclo/TTL da Partida (preparada com EXPIRE, em_andamento com
  // PERSIST, término com EXPIRE de retenção) dentro do mesmo script.
  await redis.eval(
    SCRIPT_ADICIONAR_AO_HISTORICO,
    2,
    chaveChat,
    chaveDaPartida(partidaId),
    JSON.stringify(mensagem),
    String(teto),
  );
}

/** Lê o histórico na ordem oldest→newest; `[]` quando a lista não existe. */
export async function obterHistoricoDoChat(
  redis: Redis,
  partidaId: string,
): Promise<MensagemDeChatDaPartidaEvento[]> {
  const brutos = await redis.lrange(chaveDoChatDaPartida(partidaId), 0, -1);
  const historico: MensagemDeChatDaPartidaEvento[] = [];
  let corrompidas = 0;
  for (const bruto of brutos) {
    try {
      historico.push(JSON.parse(bruto) as MensagemDeChatDaPartidaEvento);
    } catch {
      // Entrada corrompida: ignora sem quebrar o snapshot, com contador.
      corrompidas += 1;
    }
  }
  if (corrompidas > 0) {
    console.warn('[historico-chat] frames corrompidos ignorados', {
      partidaId,
      corrompidas,
      total: brutos.length,
    });
  }
  return historico;
}
// NOTA (follow-up #398/F4): a remoção do histórico vive nos EVALs inline de
// cancelamento/não-início em partidas.ts (3 DELs atômicos) — não ressuscitar
// helper isolado aqui: DEL fora do EVAL reabriria a janela de órfão.
