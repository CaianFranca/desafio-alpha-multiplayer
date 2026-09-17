// Relógio de parede do turno (issue #431, spec pai #405).
//
// Modelo (mesmo padrão do não-início `nao-inicio.ts` e da reconexão
// `reconexao-em-andamento.ts`):
//   game-server:turno:<partidaId> -> JSON { deadlineDoTurnoEm, jogadorAtivoId,
//     rodada, avisoEmitido, pausadoComRestanteMs? } (EX = restante em segundos)
//
// O Redis é a persistência (sobrevive ao restart — a chave ainda indica o
// deadline); os timers em memória com `unref` são os executores. Só o servidor
// é autoridade do relógio: o HUD deriva a contagem do `deadlineDoTurnoEm`
// absoluto (sem eventos por segundo).
//
// Semântica (decidida na #431):
// - Deadline fixo de parede por turno (default 180s, `PARTIDA_TURNO_SEGUNDOS`);
//   nenhum comando de Jogador (giro, seleção, posicionamento, chat, PING,
//   debug) renova — só a Passagem de Vez (novo `turno_iniciado`) rearma.
// - Aviso único `TURNO_AVISO_30S` aos N segundos restantes (default 30s,
//   `PARTIDA_TURNO_AVISO_SEGUNDOS`); se o aviso >= a duração, só o deadline vale.
// - Extensão única de +30s (`CARENCIA_AVISO_FINAL_SEGUNDOS` do engine) no aviso
//   final do Primeiro Turno — a flag `avisoFinalConsumidoPorJogador` do engine
//   é a autoridade; o relógio só reagenda.
// - Pausa enquanto o Jogador Ativo está em `em_reconexao` (a janela de 60s da
//   #295 manda); na readmissão retoma o restante. Pausar anuncia TURNO_INICIADO
//   sem deadline (cronômetro some) e retomar re-anuncia com o novo deadline —
//   replay seguro e INTENCIONAL (item 4 da #431, fixado sem pendência): mesmo
//   jogador + rodada, padrão da #258; nenhum evento dedicado de pausa existe
//   para não quebrar o contrato do HUD (ticket 3/3 deriva tudo do TURNO_INICIADO).
// - Nome histórico `TURNO_AVISO_30S` (item 4 da #431, fixado sem pendência):
//   contrato já publicado, NÃO renomear — o valor efetivo viaja em
//   `segundosRestantes` (o "30s" é o default de `PARTIDA_TURNO_AVISO_SEGUNDOS`,
//   configurável por partida nos testes).
// - No estouro, o resolvedor (fiação do `PartidaHandlers`, como o conversor da
//   #295) roda a mutação serializada com `resolverExpiracaoDoTurno`.
// - Sem relógio para Jogador Amedrontado (turno pulado — `avancarVez` o pula
//   silenciosamente, então o `turno_iniciado` nunca o mira; a guarda aqui é
//   defesa em profundidade).
// - Rearme pós-restart via SCAN: relógios vivos reagendam o restante EXATO (o
//   deadline é visível no HUD — jitter atrasaria o estouro além do anunciado;
//   só o estouro já vencido leva jitter ≤5s para não trovejar o lobby); com o
//   Ativo em reconexão, rearma pausado.

import type { Redis } from 'ioredis';
import {
  DEFAULT_PARTIDA_TURNO_AVISO_SEGUNDOS,
  DEFAULT_PARTIDA_TURNO_SEGUNDOS,
} from '@flicker/config';
import type { EstadoDaPartida, EventoDaPartida } from '@flicker/engine';
import { obterPartida } from './partidas.ts';
import { obterEstadoDaPartida } from './estado.ts';
import type { PartidaBroadcaster } from './broadcast.ts';

export const RELOGIO_DO_TURNO_PREFIXO = 'game-server:turno:';
const JITTER_REARME_MS = 5_000;
const REARME_SCAN_COUNT = 500;
/** Folga do EX da chave pausada além do restante (cobre a janela de 60s da #295). */
const FOLGA_PAUSA_EX_SEGUNDOS = 120;

function jitterAte(maxMs: number): number {
  return Math.floor(Math.random() * (maxMs + 1));
}

export function chaveRelogioDoTurno(partidaId: string): string {
  return `${RELOGIO_DO_TURNO_PREFIXO}${partidaId}`;
}

interface RelogioDoTurnoPersistido {
  readonly deadlineDoTurnoEm: number;
  readonly jogadorAtivoId: string;
  readonly rodada: number;
  readonly avisoEmitido: boolean;
  readonly pausadoComRestanteMs?: number;
}

function ehRelogioPersistido(valor: unknown): valor is RelogioDoTurnoPersistido {
  if (typeof valor !== 'object' || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.deadlineDoTurnoEm === 'number'
    && Number.isFinite(v.deadlineDoTurnoEm)
    && typeof v.jogadorAtivoId === 'string'
    && v.jogadorAtivoId.length > 0
    && typeof v.rodada === 'number'
    && Number.isInteger(v.rodada)
    && typeof v.avisoEmitido === 'boolean'
    && (v.pausadoComRestanteMs === undefined || typeof v.pausadoComRestanteMs === 'number')
  );
}

interface EntradaDoRelogio {
  timerExpiracao?: NodeJS.Timeout;
  timerAviso?: NodeJS.Timeout;
  deadlineDoTurnoEm: number;
  jogadorAtivoId: string;
  rodada: number;
  avisoEmitido: boolean;
  /** Presente = pausado (timers cancelados, restante congelado). */
  pausadoComRestanteMs?: number;
}

export interface AlvoDoRelogio {
  readonly jogadorAtivoId: string;
  readonly rodada: number;
}

export interface OpcoesDoArmarRelogio {
  readonly redis?: Redis;
  /** Duração total em ms (default: turnoSegundos * 1000). Injetável nos testes. */
  readonly duracaoMs?: number;
  /** Instante do aviso em ms após armar (default: duracao − avisoSegundos). Injetável nos testes. */
  readonly avisoEmMs?: number;
}

/** Foto do agendamento vigente (guarda de corrida do fire vs. Passagem). */
export interface RelogioAgendado {
  readonly jogadorAtivoId: string;
  readonly rodada: number;
  readonly deadlineDoTurnoEm: number;
}

const entradas = new Map<string, EntradaDoRelogio>();
let turnoSegundos = DEFAULT_PARTIDA_TURNO_SEGUNDOS;
let avisoSegundos = DEFAULT_PARTIDA_TURNO_AVISO_SEGUNDOS;
let globalRedis: Redis | undefined;
let globalBroadcaster: PartidaBroadcaster | undefined;
let resolvedor: ((partidaId: string) => Promise<boolean>) | undefined;

export function configurarRelogioDoTurno(novosTurnoSegundos: number, novosAvisoSegundos: number): void {
  turnoSegundos = novosTurnoSegundos;
  avisoSegundos = novosAvisoSegundos;
}

export function obterTurnoSegundos(): number {
  return turnoSegundos;
}

export function obterAvisoSegundos(): number {
  return avisoSegundos;
}

export function definirRedisParaRelogioDoTurno(redis: Redis | undefined): void {
  globalRedis = redis;
}

export function definirBroadcasterParaRelogioDoTurno(
  broadcaster: PartidaBroadcaster | undefined,
): void {
  globalBroadcaster = broadcaster;
}

export function definirResolvedorDeExpiracaoDoTurno(
  fn: ((partidaId: string) => Promise<boolean>) | undefined,
): void {
  resolvedor = fn;
}

// Guarda única do Amedrontado (espelho do engine em avancarVez/partida.ts):
// sanidade ausente ≡ 0 só quando amedrontado ausente — na prática o estado
// sempre materializa os dois; o `??` cobre binário antigo.
function ehAmedrontado(jogador: { amedrontado?: boolean; sanidade?: number }): boolean {
  return (jogador.amedrontado ?? jogador.sanidade === 0) === true;
}

/**
 * Decisão pura do relógio para o lote de eventos (testável sem Redis/timers).
 * Prioridade: término > Passagem > aviso final > manter — o lote de 2→1 traz
 * `turno_iniciado` + `partida_terminada` juntos e o término vence.
 */
export type DecisaoDoRelogioParaLote =
  | { readonly acao: 'cancelar'; readonly motivo: 'termino' | 'amedrontado' }
  | { readonly acao: 'armar'; readonly jogadorAtivoId: string; readonly rodada: number }
  | { readonly acao: 'estender' }
  | { readonly acao: 'manter' };

export function proximoRelogioParaLote(
  estadoApos: EstadoDaPartida,
  eventos: readonly EventoDaPartida[],
): DecisaoDoRelogioParaLote {
  if (eventos.some((evento) => evento.tipo === 'partida_terminada')) {
    return { acao: 'cancelar', motivo: 'termino' };
  }
  const passagens = eventos.filter((evento) => evento.tipo === 'turno_iniciado');
  if (passagens.length > 0) {
    const ultima = passagens[passagens.length - 1];
    if (ultima === undefined || ultima.tipo !== 'turno_iniciado') {
      return { acao: 'manter' };
    }
    const alvo = estadoApos.jogadores.find((j) => j.jogadorId === ultima.jogadorId);
    // Sem relógio para Amedrontado (defesa: o engine já o pula em avancarVez).
    if (alvo === undefined || ehAmedrontado(alvo)) {
      return { acao: 'cancelar', motivo: 'amedrontado' };
    }
    return { acao: 'armar', jogadorAtivoId: ultima.jogadorId, rodada: ultima.rodada };
  }
  if (eventos.some((evento) => evento.tipo === 'aviso_final_do_primeiro_turno')) {
    return { acao: 'estender' };
  }
  return { acao: 'manter' };
}

function limparTimers(entrada: EntradaDoRelogio): void {
  if (entrada.timerExpiracao !== undefined) {
    clearTimeout(entrada.timerExpiracao);
    entrada.timerExpiracao = undefined;
  }
  if (entrada.timerAviso !== undefined) {
    clearTimeout(entrada.timerAviso);
    entrada.timerAviso = undefined;
  }
}

function agendarComUnref(ms: number, fn: () => void): NodeJS.Timeout {
  const timer = setTimeout(fn, Math.max(0, ms));
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

async function persistirRelogio(
  client: Redis | undefined,
  partidaId: string,
  valor: RelogioDoTurnoPersistido,
): Promise<void> {
  if (client === undefined) return;
  const agora = Date.now();
  const restanteMs = valor.pausadoComRestanteMs ?? (valor.deadlineDoTurnoEm - agora);
  const ex = Math.max(1, Math.ceil(restanteMs / 1000))
    + (valor.pausadoComRestanteMs === undefined ? 0 : FOLGA_PAUSA_EX_SEGUNDOS);
  try {
    await client.set(chaveRelogioDoTurno(partidaId), JSON.stringify(valor), 'EX', ex);
  } catch (e) {
    // Redis fora: os timers em memória seguem valendo; o restart perde o
    // deadline (mesma degradação dos demais timers do canal).
    console.warn('[relogio-do-turno] falha ao persistir deadline', { partidaId, erro: (e as Error).message });
  }
}

/**
 * Arma (ou rearma) o relógio do turno: deadline = agora + duração, aviso único
 * antes do estouro, persistência com EX. Retorna o deadline (epoch ms) para o
 * `TURNO_INICIADO`/snapshot. Rearmar limpa os timers anteriores — a Passagem
 * nunca deixa dois relógios vivos.
 */
export async function armarRelogioDoTurno(
  partidaId: string,
  alvo: AlvoDoRelogio,
  opcoes: OpcoesDoArmarRelogio = {},
): Promise<number> {
  const client = opcoes.redis ?? globalRedis;
  let entrada = entradas.get(partidaId);
  if (entrada === undefined) {
    entrada = {
      deadlineDoTurnoEm: 0,
      jogadorAtivoId: alvo.jogadorAtivoId,
      rodada: alvo.rodada,
      avisoEmitido: false,
    };
    entradas.set(partidaId, entrada);
  }
  limparTimers(entrada);
  const duracaoMs = opcoes.duracaoMs ?? turnoSegundos * 1000;
  const deadlineDoTurnoEm = Date.now() + duracaoMs;
  entrada.deadlineDoTurnoEm = deadlineDoTurnoEm;
  entrada.jogadorAtivoId = alvo.jogadorAtivoId;
  entrada.rodada = alvo.rodada;
  entrada.avisoEmitido = false;
  entrada.pausadoComRestanteMs = undefined;

  const avisoEmMs = opcoes.avisoEmMs ?? (duracaoMs - avisoSegundos * 1000);
  if (avisoEmMs > 0) {
    const foto: RelogioAgendado = { jogadorAtivoId: alvo.jogadorAtivoId, rodada: alvo.rodada, deadlineDoTurnoEm };
    entrada.timerAviso = agendarComUnref(avisoEmMs, () => {
      dispararAvisoSeVigente(partidaId, foto, client).catch((e: unknown) =>
        console.warn('[relogio-do-turno] falha ao disparar aviso', { partidaId, erro: (e as Error).message }),
      );
    });
  }
  const fotoExpiracao: RelogioAgendado = { jogadorAtivoId: alvo.jogadorAtivoId, rodada: alvo.rodada, deadlineDoTurnoEm };
  entrada.timerExpiracao = agendarComUnref(duracaoMs, () => {
    const clientNoFire = client ?? globalRedis;
    if (clientNoFire === undefined) {
      console.warn('[relogio-do-turno] sem redis para verificar expiração', { partidaId });
      return;
    }
    void verificarExpiracaoDoTurnoSeNecessario(clientNoFire, partidaId, fotoExpiracao);
  });

  await persistirRelogio(client, partidaId, {
    deadlineDoTurnoEm,
    jogadorAtivoId: alvo.jogadorAtivoId,
    rodada: alvo.rodada,
    avisoEmitido: false,
  });
  return deadlineDoTurnoEm;
}

async function dispararAvisoSeVigente(
  partidaId: string,
  foto: RelogioAgendado,
  client: Redis | undefined,
): Promise<void> {
  const entrada = entradas.get(partidaId);
  if (entrada === undefined || entrada.pausadoComRestanteMs !== undefined) return;
  if (
    entrada.jogadorAtivoId !== foto.jogadorAtivoId
    || entrada.rodada !== foto.rodada
    || entrada.deadlineDoTurnoEm !== foto.deadlineDoTurnoEm
    || entrada.avisoEmitido
  ) {
    return;
  }
  entrada.avisoEmitido = true;
  await persistirRelogio(client, partidaId, {
    deadlineDoTurnoEm: entrada.deadlineDoTurnoEm,
    jogadorAtivoId: entrada.jogadorAtivoId,
    rodada: entrada.rodada,
    avisoEmitido: true,
  });
  const segundosRestantes = Math.max(0, Math.round((entrada.deadlineDoTurnoEm - Date.now()) / 1000));
  try {
    globalBroadcaster?.enviar(partidaId, {
      type: 'TURNO_AVISO_30S',
      jogadorId: entrada.jogadorAtivoId,
      segundosRestantes,
    });
  } catch (e) {
    console.warn('[relogio-do-turno] falha ao anunciar aviso', { partidaId, erro: (e as Error).message });
  }
}

/** Cancela timers + entrada + chave (término, Amedrontado, partida sumida). */
export async function cancelarRelogioDoTurno(partidaId: string, redis?: Redis): Promise<void> {
  const entrada = entradas.get(partidaId);
  if (entrada !== undefined) {
    limparTimers(entrada);
    entradas.delete(partidaId);
  }
  const client = redis ?? globalRedis;
  if (client !== undefined) {
    try {
      await client.del(chaveRelogioDoTurno(partidaId));
    } catch (e) {
      console.warn('[relogio-do-turno] falha ao apagar chave', { partidaId, erro: (e as Error).message });
    }
  }
}

/**
 * Test-only: simula o restart do processo — derruba os timers e a memória,
 * preservando Redis (a chave do deadline), config e fiação. O
 * `rearmarRelogioDoTurnoAposRestart` subsequente reconstrói o vigente.
 */
export function __simularRestartDoRelogioParaTestes(): void {
  for (const entrada of entradas.values()) {
    limparTimers(entrada);
  }
  entradas.clear();
}

/** Deadline vigente em memória (`null` = sem relógio ou pausado). */
export function obterDeadlineDoTurno(partidaId: string): number | null {
  const entrada = entradas.get(partidaId);
  if (entrada === undefined || entrada.pausadoComRestanteMs !== undefined) return null;
  return entrada.deadlineDoTurnoEm;
}

/** Foto do agendamento vigente para a guarda de corrida do fire (`null` = nenhum). */
export function obterRelogioAgendado(partidaId: string): RelogioAgendado | null {

  const entrada = entradas.get(partidaId);
  if (entrada === undefined || entrada.pausadoComRestanteMs !== undefined) return null;
  return {
    jogadorAtivoId: entrada.jogadorAtivoId,
    rodada: entrada.rodada,
    deadlineDoTurnoEm: entrada.deadlineDoTurnoEm,
  };
}
/** Deadline persistido (`null` = sem chave, inválida ou pausada). */
export async function lerDeadlineDoTurno(redis: Redis, partidaId: string): Promise<number | null> {
  let bruto: string | null;
  try {
    bruto = await redis.get(chaveRelogioDoTurno(partidaId));
  } catch {
    return null;
  }
  if (bruto === null) return null;
  try {
    const valor: unknown = JSON.parse(bruto);
    if (!ehRelogioPersistido(valor)) return null;
    if (valor.pausadoComRestanteMs !== undefined) return null;
    return valor.deadlineDoTurnoEm;
  } catch {
    return null;
  }
}

/**
 * Extensão única do aviso final do Primeiro Turno: novo deadline = agora +
 * extras, só o timer de expiração é reagendado (o aviso já foi emitido).
 * Retorna o novo deadline, ou `null` sem relógio vigente.
 */
export async function estenderRelogioDoTurno(
  partidaId: string,
  segundosExtras: number,
  redis?: Redis,
): Promise<number | null> {
  const entrada = entradas.get(partidaId);
  if (entrada === undefined || entrada.pausadoComRestanteMs !== undefined) return null;
  const client = redis ?? globalRedis;
  if (entrada.timerExpiracao !== undefined) {
    clearTimeout(entrada.timerExpiracao);
    entrada.timerExpiracao = undefined;
  }
  const deadlineDoTurnoEm = Date.now() + Math.max(1, segundosExtras) * 1000;
  entrada.deadlineDoTurnoEm = deadlineDoTurnoEm;
  const foto: RelogioAgendado = {
    jogadorAtivoId: entrada.jogadorAtivoId,
    rodada: entrada.rodada,
    deadlineDoTurnoEm,
  };
  entrada.timerExpiracao = agendarComUnref(Math.max(1, segundosExtras) * 1000, () => {
    const clientNoFire = client ?? globalRedis;
    if (clientNoFire === undefined) {
      console.warn('[relogio-do-turno] sem redis para verificar expiração', { partidaId });
      return;
    }
    void verificarExpiracaoDoTurnoSeNecessario(clientNoFire, partidaId, foto);
  });
  await persistirRelogio(client, partidaId, {
    deadlineDoTurnoEm,
    jogadorAtivoId: entrada.jogadorAtivoId,
    rodada: entrada.rodada,
    avisoEmitido: entrada.avisoEmitido,
  });
  return deadlineDoTurnoEm;
}

/**
 * Pausa o relógio quando o Jogador Ativo desconecta (issue #431): congela o
 * restante, cancela os timers e anuncia TURNO_INICIADO sem deadline. Nunca
 * lança (retorna false) — a expiração tem guarda própria de presença, então
 * uma pausa atrasada nunca resolve o turno de um ausente.
 */
export async function pausarRelogioDoTurnoSeAtivo(
  redis: Redis,
  partidaId: string,
  jogadorId: string,
): Promise<boolean> {
  try {
    const entrada = entradas.get(partidaId);
    if (
      entrada !== undefined
      && entrada.pausadoComRestanteMs === undefined
      && entrada.jogadorAtivoId === jogadorId
    ) {
      return await pausarEntrada(redis, partidaId, entrada);
    }
    // Sem entrada em memória (ex.: rearme ainda não viu a chave): confirma no
    // estado + chave antes de pausar.
    const estado = await obterEstadoDaPartida(redis, partidaId);
    if (estado === null || estado.resultado !== null || estado.jogadorAtivoId !== jogadorId) {
      return false;
    }
    let bruto: string | null;
    try {
      bruto = await redis.get(chaveRelogioDoTurno(partidaId));
    } catch {
      return false;
    }
    if (bruto === null) return false;
    let valor: unknown;
    try {
      valor = JSON.parse(bruto) as unknown;
    } catch {
      return false;
    }
    if (!ehRelogioPersistido(valor) || valor.pausadoComRestanteMs !== undefined) return false;
    if (valor.jogadorAtivoId !== jogadorId) return false;
    const restanteMs = Math.max(0, valor.deadlineDoTurnoEm - Date.now());
    const nova: EntradaDoRelogio = {
      deadlineDoTurnoEm: valor.deadlineDoTurnoEm,
      jogadorAtivoId: valor.jogadorAtivoId,
      rodada: valor.rodada,
      avisoEmitido: valor.avisoEmitido,
      pausadoComRestanteMs: restanteMs,
    };
    entradas.set(partidaId, nova);
    await persistirRelogio(redis, partidaId, {
      deadlineDoTurnoEm: valor.deadlineDoTurnoEm,
      jogadorAtivoId: valor.jogadorAtivoId,
      rodada: valor.rodada,
      avisoEmitido: valor.avisoEmitido,
      pausadoComRestanteMs: restanteMs,
    });
    anunciarTurnoSemDeadline(partidaId, valor.jogadorAtivoId, valor.rodada);
    return true;
  } catch (e) {
    console.error('[relogio-do-turno] falha ao pausar', { partidaId, erro: (e as Error).message });
    return false;
  }
}

async function pausarEntrada(redis: Redis, partidaId: string, entrada: EntradaDoRelogio): Promise<boolean> {
  const restanteMs = Math.max(0, entrada.deadlineDoTurnoEm - Date.now());
  limparTimers(entrada);
  entrada.pausadoComRestanteMs = restanteMs;
  await persistirRelogio(redis, partidaId, {
    deadlineDoTurnoEm: entrada.deadlineDoTurnoEm,
    jogadorAtivoId: entrada.jogadorAtivoId,
    rodada: entrada.rodada,
    avisoEmitido: entrada.avisoEmitido,
    pausadoComRestanteMs: restanteMs,
  });
  anunciarTurnoSemDeadline(partidaId, entrada.jogadorAtivoId, entrada.rodada);
  return true;
}

function anunciarTurnoSemDeadline(partidaId: string, jogadorId: string, rodada: number): void {
  try {
    globalBroadcaster?.enviar(partidaId, { type: 'TURNO_INICIADO', jogadorId, rodada });
  } catch (e) {
    console.warn('[relogio-do-turno] falha ao anunciar pausa', { partidaId, erro: (e as Error).message });
  }
}

/**
 * Retomada na readmissão (issue #431, item 4 fixado sem pendência): se o relógio
 * estava pausado para este Jogador, retoma o restante com novo deadline e
 * re-anuncia TURNO_INICIADO; se não há relógio mas a partida segue com Ativo
 * não-Amedrontado, arma um prazo cheio (leniente por decisão documentada: cobre
 * o início da partida na N-ésima admissão e o vão de um restart com chave
 * expirada — nunca pune com falta imediata o que pode ser queda do servidor).
 * Nunca lança.
 */
export async function retomarRelogioDoTurnoSeAtivo(
  redis: Redis,
  partidaId: string,
  jogadorId: string,
): Promise<boolean> {
  try {
    const entrada = entradas.get(partidaId);
    if (entrada !== undefined) {
      if (entrada.pausadoComRestanteMs === undefined) return false;
      if (entrada.jogadorAtivoId !== jogadorId) return false;
      const restanteMs = entrada.pausadoComRestanteMs;
      const deadlineDoTurnoEm = Date.now() + restanteMs;
      entrada.deadlineDoTurnoEm = deadlineDoTurnoEm;
      entrada.pausadoComRestanteMs = undefined;
      const foto: RelogioAgendado = {
        jogadorAtivoId: entrada.jogadorAtivoId,
        rodada: entrada.rodada,
        deadlineDoTurnoEm,
      };
      const avisoEmMs = restanteMs - avisoSegundos * 1000;
      if (avisoEmMs > 0 && !entrada.avisoEmitido) {
        entrada.timerAviso = agendarComUnref(avisoEmMs, () => {
          void dispararAvisoSeVigente(partidaId, foto, redis).catch((e: unknown) =>
            console.warn('[relogio-do-turno] falha ao disparar aviso', { partidaId, erro: (e as Error).message }),
          );
        });
      } else if (!entrada.avisoEmitido && restanteMs > 0) {
        // Voltou já na janela do aviso (ou o turno nem previa aviso): marca
        // como emitido sem disparar — o HUD deriva do deadline re-anunciado;
        // preserva o "único por turno" sem bipar atrasado.
        entrada.avisoEmitido = true;
      }
      entrada.timerExpiracao = agendarComUnref(restanteMs, () => {
        void verificarExpiracaoDoTurnoSeNecessario(redis, partidaId, foto);
      });
      await persistirRelogio(redis, partidaId, {
        deadlineDoTurnoEm,
        jogadorAtivoId: entrada.jogadorAtivoId,
        rodada: entrada.rodada,
        avisoEmitido: entrada.avisoEmitido,
      });
      try {
        globalBroadcaster?.enviar(partidaId, {
          type: 'TURNO_INICIADO',
          jogadorId: entrada.jogadorAtivoId,
          rodada: entrada.rodada,
          deadlineDoTurnoEm,
        });
      } catch (e) {
        console.warn('[relogio-do-turno] falha ao anunciar retomada', { partidaId, erro: (e as Error).message });
      }
      return true;
    }
    // Sem entrada: só arma quando a partida segue em andamento com o Ativo
    // presente no engine e não-Amedrontado.
    const partida = await obterPartida(redis, partidaId as never);
    if (partida === null || partida.estado !== 'em_andamento') return false;
    const estado = await obterEstadoDaPartida(redis, partidaId);
    if (estado === null || estado.resultado !== null) return false;
    const ativo = estado.jogadores.find((j) => j.jogadorId === estado.jogadorAtivoId);
    if (ativo === undefined || ehAmedrontado(ativo)) return false;
    // Chave viva com deadline futuro: reconstrói o restante em vez de dar
    // prazo cheio (o restart não presenteia tempo).
    let bruto: string | null = null;
    try {
      bruto = await redis.get(chaveRelogioDoTurno(partidaId));
    } catch {
      bruto = null;
    }
    if (bruto !== null) {
      try {
        const valor: unknown = JSON.parse(bruto) as unknown;
        if (ehRelogioPersistido(valor) && valor.jogadorAtivoId === estado.jogadorAtivoId) {
          if (valor.pausadoComRestanteMs !== undefined) {
            if (valor.jogadorAtivoId !== jogadorId) return false;
            entradas.set(partidaId, {
              deadlineDoTurnoEm: valor.deadlineDoTurnoEm,
              jogadorAtivoId: valor.jogadorAtivoId,
              rodada: valor.rodada,
              avisoEmitido: valor.avisoEmitido,
              pausadoComRestanteMs: valor.pausadoComRestanteMs,
            });
            return await retomarRelogioDoTurnoSeAtivo(redis, partidaId, jogadorId);
          }
          const restanteMs = valor.deadlineDoTurnoEm - Date.now();
          if (restanteMs > 0) {
            await armarRelogioDoTurnoComRestante(redis, partidaId, valor, restanteMs);
            return true;
          }
        }
      } catch {
        // Chave ilegível: cai no prazo cheio abaixo.
      }
    }
    await armarRelogioDoTurno(partidaId, { jogadorAtivoId: estado.jogadorAtivoId, rodada: estado.rodada }, { redis });
    return true;
  } catch (e) {
    console.error('[relogio-do-turno] falha ao retomar', { partidaId, erro: (e as Error).message });
    return false;
  }
}

async function armarRelogioDoTurnoComRestante(
  redis: Redis,
  partidaId: string,
  valor: RelogioDoTurnoPersistido,
  restanteMs: number,
): Promise<void> {
  let entrada = entradas.get(partidaId);
  if (entrada === undefined) {
    entrada = {
      deadlineDoTurnoEm: 0,
      jogadorAtivoId: valor.jogadorAtivoId,
      rodada: valor.rodada,
      avisoEmitido: valor.avisoEmitido,
    };
    entradas.set(partidaId, entrada);
  }
  limparTimers(entrada);
  const deadlineDoTurnoEm = Date.now() + restanteMs;
  entrada.deadlineDoTurnoEm = deadlineDoTurnoEm;
  entrada.jogadorAtivoId = valor.jogadorAtivoId;
  entrada.rodada = valor.rodada;
  const foto: RelogioAgendado = {
    jogadorAtivoId: valor.jogadorAtivoId,
    rodada: valor.rodada,
    deadlineDoTurnoEm,
  };
  const avisoEmMs = restanteMs - avisoSegundos * 1000;
  if (avisoEmMs > 0 && !valor.avisoEmitido) {
    entrada.timerAviso = agendarComUnref(avisoEmMs, () => {
      void dispararAvisoSeVigente(partidaId, foto, redis).catch((e: unknown) =>
        console.warn('[relogio-do-turno] falha ao disparar aviso', { partidaId, erro: (e as Error).message }),
      );
    });
  } else {
    // Já na janela do aviso (ou turno sem aviso útil): marca sem disparar —
    // o HUD deriva do deadline; preserva o "único por turno" (mesma razão da
    // retomada).
    entrada.avisoEmitido = true;
  }
  entrada.timerExpiracao = agendarComUnref(restanteMs, () => {
    void verificarExpiracaoDoTurnoSeNecessario(redis, partidaId, foto);
  });
  await persistirRelogio(redis, partidaId, {
    deadlineDoTurnoEm,
    jogadorAtivoId: valor.jogadorAtivoId,
    rodada: valor.rodada,
    avisoEmitido: entrada.avisoEmitido,
  });
}

/**
 * Verificação do estouro (fire do timer, rearme vencido ou chamada direta de
 * teste): só prossegue com o agendamento vigente e o deadline vencido; a
 * resolução em si vive no `PartidaHandlers` (mutação serializada com as
 * guardas de presença/estado).
 */
export async function verificarExpiracaoDoTurnoSeNecessario(
  redis: Redis,
  partidaId: string,
  esperado?: RelogioAgendado,
): Promise<boolean> {
  const entrada = entradas.get(partidaId);
  if (entrada === undefined || entrada.pausadoComRestanteMs !== undefined) {
    return false;
  }
  if (
    esperado !== undefined
    && (entrada.jogadorAtivoId !== esperado.jogadorAtivoId
      || entrada.rodada !== esperado.rodada
      || entrada.deadlineDoTurnoEm !== esperado.deadlineDoTurnoEm)
  ) {
    return false;
  }
  if (Date.now() < entrada.deadlineDoTurnoEm) {
    return false;
  }
  if (resolvedor === undefined) {
    console.warn('[relogio-do-turno] sem resolvedor para expiração', { partidaId });
    return false;
  }
  return resolvedor(partidaId);
}

interface LinhaDoRearme {
  readonly chave: string;
  readonly raw: string | null;
  readonly ttl: number;
}

export async function rearmarRelogioDoTurnoAposRestart(redis: Redis): Promise<void> {
  globalRedis = redis;
  let verificadas = 0;
  let reagendadas = 0;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${RELOGIO_DO_TURNO_PREFIXO}*`, 'COUNT', REARME_SCAN_COUNT);
      cursor = next;
      verificadas += keys.length;
      const lote = await lerLoteDoRearme(redis, keys);
      for (const linha of lote) {
        if (linha.raw === null || linha.ttl < 0) continue;
        try {
          const rearmou = await rearmarUmaChave(redis, linha);
          if (rearmou) reagendadas += 1;
        } catch (e) {
          console.warn('[relogio-do-turno] falha ao rearmar chave', { chave: linha.chave, erro: (e as Error).message });
        }
      }
      // Yield por lote: não monopoliza o event loop no boot com N partidas.
      await new Promise<void>((resolve) => setImmediate(resolve));
    } while (cursor !== '0');
    console.info('[relogio-do-turno] rearme concluído', { verificadas, reagendadas });
  } catch (err) {
    console.error('[relogio-do-turno] falha ao rearmar', { erro: (err as Error).message });
  }
}

async function lerLoteDoRearme(redis: Redis, chaves: string[]): Promise<LinhaDoRearme[]> {
  const fabricaDePipeline = (redis as unknown as { pipeline?: unknown }).pipeline;
  if (typeof fabricaDePipeline !== 'function') {
    const lote: LinhaDoRearme[] = [];
    for (const chave of chaves) {
      lote.push({ chave, raw: await redis.get(chave), ttl: await redis.ttl(chave) });
    }
    return lote;
  }
  const pipeline = (fabricaDePipeline as () => {
    get(chave: string): unknown;
    ttl(chave: string): unknown;
    exec(): Promise<Array<[Error | null, unknown]> | null>;
  }).call(redis);
  for (const chave of chaves) {
    pipeline.get(chave);
    pipeline.ttl(chave);
  }
  const respostas = (await pipeline.exec()) ?? [];
  return chaves.map((chave, i) => ({
    chave,
    raw: (respostas[i * 2]?.[1] as string | null) ?? null,
    ttl: Number(respostas[i * 2 + 1]?.[1] ?? -2),
  }));
}

async function rearmarUmaChave(redis: Redis, linha: LinhaDoRearme): Promise<boolean> {
  let valor: unknown;
  try {
    valor = JSON.parse(linha.raw as string) as unknown;
  } catch {
    return false;
  }
  if (!ehRelogioPersistido(valor)) return false;
  const partidaId = linha.chave.slice(RELOGIO_DO_TURNO_PREFIXO.length);
  if (partidaId.length === 0) return false;
  const partida = await obterPartida(redis, partidaId as never);
  if (partida === null || partida.estado !== 'em_andamento') {
    try {
      await redis.del(linha.chave);
    } catch {
      // best-effort
    }
    return false;
  }
  const estado = await obterEstadoDaPartida(redis, partidaId);
  if (estado === null || estado.resultado !== null || estado.jogadorAtivoId !== valor.jogadorAtivoId) {
    try {
      await redis.del(linha.chave);
    } catch {
      // best-effort
    }
    return false;
  }
  const ativo = estado.jogadores.find((j) => j.jogadorId === estado.jogadorAtivoId);
  if (ativo === undefined || ehAmedrontado(ativo)) {
    try {
      await redis.del(linha.chave);
    } catch {
      // best-effort
    }
    return false;
  }
  const membro = partida.roster.find((m) => m.jogadorId === estado.jogadorAtivoId);
  if (membro?.presenca === 'em_reconexao' || valor.pausadoComRestanteMs !== undefined) {
    // Ativo fora: rearma pausado (a readmissão retoma o restante).
    const restanteMs = valor.pausadoComRestanteMs ?? Math.max(0, valor.deadlineDoTurnoEm - Date.now());
    entradas.set(partidaId, {
      deadlineDoTurnoEm: valor.deadlineDoTurnoEm,
      jogadorAtivoId: valor.jogadorAtivoId,
      rodada: valor.rodada,
      avisoEmitido: valor.avisoEmitido,
      pausadoComRestanteMs: restanteMs,
    });
    return true;
  }
  const restanteMs = valor.deadlineDoTurnoEm - Date.now();
  if (restanteMs <= 0) {
    // Estouro vencido no downtime: dispara quase já, com jitter só para não
    // trovejar o lobby com N estouros simultâneos.
    const foto: RelogioAgendado = {
      jogadorAtivoId: valor.jogadorAtivoId,
      rodada: valor.rodada,
      deadlineDoTurnoEm: valor.deadlineDoTurnoEm,
    };
    entradas.set(partidaId, {
      deadlineDoTurnoEm: valor.deadlineDoTurnoEm,
      jogadorAtivoId: valor.jogadorAtivoId,
      rodada: valor.rodada,
      avisoEmitido: true,
    });
    const timer = setTimeout(() => {
      void verificarExpiracaoDoTurnoSeNecessario(redis, partidaId, foto);
    }, jitterAte(JITTER_REARME_MS));
    if (typeof timer.unref === 'function') timer.unref();
    entradas.get(partidaId)!.timerExpiracao = timer;
    return true;
  }
  await armarRelogioDoTurnoComRestante(redis, partidaId, valor, restanteMs);
  return true;
}
