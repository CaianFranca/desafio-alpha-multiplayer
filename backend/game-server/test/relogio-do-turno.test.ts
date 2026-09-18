// Relógio de parede do turno no game-server (issue #431, spec pai #405).
//
// Comportamento externo via `PartidaHandlers` + módulo `relogio-do-turno` +
// Redis em memória (get/set/ttl/del/scan/pipeline/eval/lrange) + broadcaster
// real. Tempo falso via `t.mock.timers` (Date + setTimeout) nos testes de
// aviso/pausa — determinísticos, sem sleeps; 2 testes de integração mantêm
// tempo real contra flake (pausa→estouro ponta a ponta e rearme vencido):
//
// - deadline fixo: a Passagem arma e o TURNO_INICIADO carrega deadlineDoTurnoEm
// - giro/seleção/chat nunca renovam o deadline
// - aviso TURNO_AVISO_30S único por turno
// - extensão única de +30s no aviso final do Primeiro Turno (2º expiry desiste)
// - pausa durante a reconexão do Jogador Ativo; retomada com o restante
// - rearme pós-restart (chave com EX): vivo reagenda, vencido resolve, pausado
//   retoma
// - estouro → resolverExpiracaoDoTurno → FALTA_REGISTRADA + Passagem no canal
// - 4ª falta → Desistência causa `tempo` (+ término/retorno quando 2→1)
// - Amedrontado sem relógio (decisão pura + guarda da resolução)
// - término cancela; fire tardio (Passagem venceu a corrida) aborta sem mutar

import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import {
  aplicarComandoDePartida,
  BORDA_OPOSTA,
  bordasAbertas,
  estadoInicialDaPartida,
  type ComandoDePartida,
  type EstadoDaPartida,
  type Orientacao,
} from '@flicker/engine';
import type { MembroDaSala } from '@flicker/shared';
import type { AvisoDeRetorno, AvisoDeDesistencia } from '../src/retorno/cliente.ts';
import { PartidaBroadcaster } from '../src/partidas/broadcast.ts';
import {
  chaveDaPartida,
  chaveDoEstadoDaPartida,
  obterEstadoDaPartida,
} from '../src/partidas/estado.ts';
import { PartidaHandlers } from '../src/partidas/handlers.ts';
import { paraSnapshotWire } from '../src/partidas/snapshot.ts';
import {
  __simularRestartDoRelogioParaTestes,
  armarRelogioDoTurno,
  cancelarRelogioDoTurno,
  chaveRelogioDoTurno,
  configurarRelogioDoTurno,
  definirBroadcasterParaRelogioDoTurno,
  definirRedisParaRelogioDoTurno,
  definirResolvedorDeExpiracaoDoTurno,
  lerDeadlineDoTurno,
  obterDeadlineDoTurno,
  obterRelogioAgendado,
  pausarRelogioDoTurnoSeAtivo,
  proximoRelogioParaLote,
  rearmarRelogioDoTurnoAposRestart,
  retomarRelogioDoTurnoSeAtivo,
  verificarExpiracaoDoTurnoSeNecessario,
} from '../src/partidas/relogio-do-turno.ts';

// ─── Redis em memória ───

class RedisEmMemoria {
  private readonly dados = new Map<string, string>();
  private readonly expiracao = new Map<string, number>();

  async get(chave: string): Promise<string | null> {
    return this.dados.get(chave) ?? null;
  }

  async set(chave: string, valor: string, ...resto: unknown[]): Promise<'OK'> {
    this.dados.set(chave, valor);
    const idx = resto.indexOf('EX');
    if (idx >= 0) {
      this.expiracao.set(chave, Number(resto[idx + 1]));
    }
    return 'OK';
  }

  async ttl(chave: string): Promise<number> {
    if (!this.dados.has(chave)) return -2;
    return this.expiracao.get(chave) ?? -1;
  }

  async del(...chaves: string[]): Promise<number> {
    let removidas = 0;
    for (const chave of chaves) {
      if (this.dados.delete(chave)) removidas += 1;
      this.expiracao.delete(chave);
    }
    return removidas;
  }

  async scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]> {
    void cursor;
    const idx = args.indexOf('MATCH');
    const pattern = idx >= 0 ? String(args[idx + 1]) : '*';
    const prefixo = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    return ['0', [...this.dados.keys()].filter((k) => k.startsWith(prefixo))];
  }

  pipeline(): {
    get(chave: string): unknown;
    ttl(chave: string): unknown;
    exec(): Promise<Array<[Error | null, unknown]>>;
  } {
    const operacoes: Array<{ tipo: 'get' | 'ttl'; chave: string }> = [];
    const self = this;
    return {
      get(chave: string): unknown {
        operacoes.push({ tipo: 'get', chave });
        return undefined;
      },
      ttl(chave: string): unknown {
        operacoes.push({ tipo: 'ttl', chave });
        return undefined;
      },
      async exec(): Promise<Array<[Error | null, unknown]>> {
        const out: Array<[Error | null, unknown]> = [];
        for (const op of operacoes) {
          out.push([null, op.tipo === 'get' ? await self.get(op.chave) : await self.ttl(op.chave)]);
        }
        return out;
      },
    };
  }

  async eval(): Promise<number> {
    return 1;
  }

  async lrange(): Promise<string[]> {
    return [];
  }

  tem(chave: string): boolean {
    return this.dados.has(chave);
  }

  comoRedis(): Redis {
    return this as unknown as Redis;
  }
}

// ─── Sockets falsos ───

interface SocketFalso {
  readonly mensagens: Array<Record<string, unknown>>;
  comoWebSocket(): WebSocket;
}

function criarSocketFalso(): SocketFalso {
  const mensagens: Array<Record<string, unknown>> = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    send(payload: string): void {
      mensagens.push(JSON.parse(payload) as Record<string, unknown>);
    },
  };
  return { mensagens, comoWebSocket: () => socket as unknown as WebSocket };
}

function membro(n: number, presenca: 'conectado' | 'em_reconexao' = 'conectado'): MembroDaSala {
  return {
    id: `membro-${n}`,
    jogadorId: `jogador-${n}`,
    apelido: `Jogador ${n}`,
    ordemDeEntrada: n,
    presenca,
    prontidao: true,
  };
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Montagem via engine puro (mesmo fixture do tempo-de-turno.test.ts) ───

function aplicar(estado: EstadoDaPartida, comando: ComandoDePartida, ator: string): EstadoDaPartida {
  const resultado = aplicarComandoDePartida(estado, comando, ator);
  if (!resultado.sucesso) {
    throw new Error(`${resultado.erro.codigo}: ${resultado.erro.mensagem}`);
  }
  return resultado.estado;
}

function resolverRecebidas(estado: EstadoDaPartida, ator: string): EstadoDaPartida {
  while (estado.tabuleiro.recebidas.length > 0) {
    const pendente = estado.tabuleiro.recebidas[0];
    let resolvida: EstadoDaPartida | undefined;
    for (const borda of ['norte', 'leste', 'sul', 'oeste'] as const) {
      const resultado = aplicarComandoDePartida(
        estado,
        { tipo: 'escolher_vaga_da_peca_recebida', recebidaId: pendente.recebidaId, borda },
        ator,
      );
      if (resultado.sucesso) {
        resolvida = resultado.estado;
        break;
      }
    }
    if (!resolvida) throw new Error(`sem vaga para ${pendente.recebidaId}`);
    estado = resolvida;
    const escolhida = estado.tabuleiro.recebidas.find((item) => item.recebidaId === pendente.recebidaId);
    if (!escolhida || escolhida.celulaAlvo === null || escolhida.vaga === null) {
      throw new Error('recebida sem vaga/célula-alvo');
    }
    const alvo = BORDA_OPOSTA[escolhida.vaga];
    let giros = 0;
    while (
      giros < 4
      && !bordasAbertas({
        tipo: escolhida.tipo,
        orientacao: ((escolhida.orientacao + 90 * giros) % 360) as Orientacao,
      }).includes(alvo)
    ) {
      giros++;
    }
    for (let giro = 0; giro < giros; giro++) {
      estado = aplicar(estado, { tipo: 'girar_peca', pecaId: escolhida.pecaId, sentido: 'horario' }, ator);
    }
    estado = aplicar(
      estado,
      {
        tipo: 'posicionar_peca',
        pecaId: escolhida.pecaId,
        celula: { linha: escolhida.celulaAlvo.linha, coluna: escolhida.celulaAlvo.coluna },
      },
      ator,
    );
  }
  return estado;
}

function primeiroTurnoCompleto(
  estado: EstadoDaPartida,
  celula: { linha: number; coluna: number },
): EstadoDaPartida {
  const ator = estado.jogadorAtivoId;
  const jogador = estado.jogadores.find((j) => j.jogadorId === ator);
  if (!jogador) throw new Error('sem Jogador Ativo');
  const pecaId = `inicial-${jogador.ordem}`;
  estado = aplicar(estado, { tipo: 'selecionar_peca', pecaId }, ator);
  estado = aplicar(estado, { tipo: 'posicionar_peca', pecaId, celula }, ator);
  estado = aplicar(estado, { tipo: 'selecionar_peao', peaoId: jogador.peaoId }, ator);
  estado = aplicar(estado, { tipo: 'posicionar_peao', peaoId: jogador.peaoId, celula }, ator);
  estado = resolverRecebidas(estado, ator);
  return aplicar(estado, { tipo: 'encerrar_turno' }, ator);
}

function estadoFresco(roster: readonly string[]): EstadoDaPartida {
  const resultado = estadoInicialDaPartida(roster);
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) throw new Error('inacessível');
  return resultado.estado;
}

/** N=3 com os dois primeiros turnos concluídos: vez de jogador-1 em turno normal. */
function estadoEmTurnoNormal(): EstadoDaPartida {
  let estado = estadoFresco(['jogador-1', 'jogador-2', 'jogador-3']);
  estado = primeiroTurnoCompleto(estado, { linha: 3, coluna: 3 });
  estado = primeiroTurnoCompleto(estado, { linha: 0, coluna: 0 });
  estado = primeiroTurnoCompleto(estado, { linha: 5, coluna: 5 });
  assert.equal(estado.jogadorAtivoId, 'jogador-1');
  assert.equal(estado.rodada, 2);
  return estado;
}

// ─── Montagem do canal ───

interface PartidaMontada {
  readonly partidaId: string;
  readonly redis: RedisEmMemoria;
  readonly broadcaster: PartidaBroadcaster;
  readonly handlers: PartidaHandlers;
  readonly avisos: AvisoDeRetorno[];
  readonly desistencias: AvisoDeDesistencia[];
  readonly sockets: Map<string, SocketFalso>;
}

async function montarPartida(
  jogadores: readonly string[],
  opcoes: {
    estado?: EstadoDaPartida;
    turnoSegundos?: number;
    avisoSegundos?: number;
    emReconexao?: readonly string[];
  } = {},
): Promise<PartidaMontada> {
  const partidaId = `partida-relogio-${crypto.randomUUID()}`;
  const redis = new RedisEmMemoria();
  const broadcaster = new PartidaBroadcaster();
  const avisos: AvisoDeRetorno[] = [];
  const desistencias: AvisoDeDesistencia[] = [];
  const handlers = new PartidaHandlers({
    redis: redis.comoRedis(),
    broadcaster,
    notificarRetorno: async (aviso) => {
      avisos.push(aviso);
    },
    notificarDesistencia: async (aviso) => {
      desistencias.push(aviso);
    },
  });
  configurarRelogioDoTurno(opcoes.turnoSegundos ?? 180, opcoes.avisoSegundos ?? 30);
  definirRedisParaRelogioDoTurno(redis.comoRedis());
  definirBroadcasterParaRelogioDoTurno(broadcaster);
  definirResolvedorDeExpiracaoDoTurno((pid) => handlers.resolverExpiracaoDoTurno(pid));

  const estado = opcoes.estado ?? estadoFresco(jogadores);
  await redis.set(chaveDoEstadoDaPartida(partidaId), JSON.stringify(estado));

  const numeros = jogadores.map((id) => Number(id.replace('jogador-', '')));
  const emReconexao = new Set(opcoes.emReconexao ?? []);
  const roster = numeros.map((n) =>
    membro(n, emReconexao.has(`jogador-${n}`) ? 'em_reconexao' : 'conectado'),
  );
  await redis.set(
    chaveDaPartida(partidaId),
    JSON.stringify({
      partidaId,
      serverId: 'game-server-teste-relogio',
      salaId: 'sala-1',
      codigoDeSala: 'ABC123',
      roster,
      estado: 'em_andamento',
      criadaEm: new Date().toISOString(),
      iniciadaEm: Date.now(),
    }),
  );
  const sockets = new Map<string, SocketFalso>();
  for (const jogadorId of jogadores) {
    const falso = criarSocketFalso();
    sockets.set(jogadorId, falso);
    broadcaster.registrar(partidaId, falso.comoWebSocket());
  }
  return { partidaId, redis, broadcaster, handlers, avisos, desistencias, sockets };
}

async function lerEstado(montada: PartidaMontada): Promise<EstadoDaPartida> {
  const estado = await obterEstadoDaPartida(montada.redis.comoRedis(), montada.partidaId);
  assert.ok(estado !== null);
  return estado;
}

async function limparPartida(montada: PartidaMontada): Promise<void> {
  await cancelarRelogioDoTurno(montada.partidaId, montada.redis.comoRedis());
  definirResolvedorDeExpiracaoDoTurno(undefined);
  definirBroadcasterParaRelogioDoTurno(undefined);
  definirRedisParaRelogioDoTurno(undefined);
  configurarRelogioDoTurno(180, 30);
}

function tiposDe(socket: SocketFalso): string[] {
  return socket.mensagens.map((m) => m.type as string);
}

// ─── Deadline fixo + Passagem arma ───

test('Passagem arma o relógio e o TURNO_INICIADO carrega deadlineDoTurnoEm', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  try {
    const antes = Date.now();
    await montada.handlers.aplicarMensagem(
      montada.sockets.get('jogador-1')!.comoWebSocket(),
      montada.partidaId,
      'jogador-1',
      { type: 'DESISTIR_DA_PARTIDA', jogadorId: 'jogador-1' },
    );
    const depois = Date.now();

    // Passagem ao seguinte com o deadline do relógio no lote.
    const turno = montada.sockets.get('jogador-2')!.mensagens.find((m) => m.type === 'TURNO_INICIADO');
    assert.ok(turno !== undefined);
    assert.equal(turno.jogadorId, 'jogador-2');
    assert.ok(typeof turno.deadlineDoTurnoEm === 'number');
    const deadline = turno.deadlineDoTurnoEm as number;
    assert.ok(deadline >= antes + 180_000 && deadline <= depois + 180_000, 'deadline ≈ agora + 180s');

    // Persistido com EX para o rearme.
    assert.equal(await lerDeadlineDoTurno(montada.redis.comoRedis(), montada.partidaId), deadline);
    assert.equal(obterDeadlineDoTurno(montada.partidaId), deadline);
    assert.ok(montada.redis.tem(chaveRelogioDoTurno(montada.partidaId)));
  } finally {
    await limparPartida(montada);
  }
});

test('giro, seleção, posicionamento e chat nunca renovam o deadline', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  try {
    await montada.handlers.aplicarMensagem(
      montada.sockets.get('jogador-1')!.comoWebSocket(),
      montada.partidaId,
      'jogador-1',
      { type: 'DESISTIR_DA_PARTIDA', jogadorId: 'jogador-1' },
    );
    const deadline = obterDeadlineDoTurno(montada.partidaId);
    assert.ok(typeof deadline === 'number');

    // Seleção válida do novo Ativo (própria inicial no Primeiro Turno).
    await montada.handlers.aplicarMensagem(
      montada.sockets.get('jogador-2')!.comoWebSocket(),
      montada.partidaId,
      'jogador-2',
      { type: 'SELECIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2' },
    );
    assert.equal(obterDeadlineDoTurno(montada.partidaId), deadline, 'seleção não renova');

    // Giro da selecionada.
    await montada.handlers.aplicarMensagem(
      montada.sockets.get('jogador-2')!.comoWebSocket(),
      montada.partidaId,
      'jogador-2',
      { type: 'GIRAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2', sentido: 'horario' },
    );
    assert.equal(obterDeadlineDoTurno(montada.partidaId), deadline, 'giro não renova');

    // Chat aprovado.
    await montada.handlers.aplicarMensagem(
      montada.sockets.get('jogador-2')!.comoWebSocket(),
      montada.partidaId,
      'jogador-2',
      { type: 'ENVIAR_MENSAGEM_DE_CHAT', jogadorId: 'jogador-2', conteudo: 'boa sorte' },
    );
    assert.equal(obterDeadlineDoTurno(montada.partidaId), deadline, 'chat não renova');

    // Posicionamento válido sem Passagem mantém o deadline original.
    await montada.handlers.aplicarMensagem(
      montada.sockets.get('jogador-2')!.comoWebSocket(),
      montada.partidaId,
      'jogador-2',
      { type: 'POSICIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2', celula: { linha: 0, coluna: 0 } },
    );
    assert.equal(obterDeadlineDoTurno(montada.partidaId), deadline, 'posicionamento não renova');

    // Nenhum TURNO_INICIADO extra no canal.
    const turnos = montada.sockets.get('jogador-2')!.mensagens.filter((m) => m.type === 'TURNO_INICIADO');
    assert.equal(turnos.length, 1);
  } finally {
    await limparPartida(montada);
  }
});

// PING/debug nunca chegam ao `aplicarMensagem` por construção (interceptados em
// `ws.ts:664-675` antes do dispatch — a guarda do contrato os recusaria como
// DADOS_INVALIDOS); aqui a caracterização passa pelo handler para provar que,
// mesmo no caminho degradado, o relógio não é tocado.
test('PING e debug não tocam o deadline', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  try {
    await montada.handlers.aplicarMensagem(
      montada.sockets.get('jogador-1')!.comoWebSocket(),
      montada.partidaId,
      'jogador-1',
      { type: 'DESISTIR_DA_PARTIDA', jogadorId: 'jogador-1' },
    );
    const deadline = obterDeadlineDoTurno(montada.partidaId);
    assert.ok(typeof deadline === 'number');
    const nAntes = montada.sockets.get('jogador-2')!.mensagens.length;

    const origem = criarSocketFalso();
    await montada.handlers.aplicarMensagem(
      origem.comoWebSocket(),
      montada.partidaId,
      'jogador-2',
      { type: 'PING', jogadorId: 'jogador-2' },
    );
    assert.equal(obterDeadlineDoTurno(montada.partidaId), deadline, 'PING não renova');
    assert.deepEqual(origem.mensagens[0], {
      type: 'ERRO_DO_TABULEIRO',
      codigo: 'DADOS_INVALIDOS',
      mensagem: 'Comando fora do escopo da partida.',
    });

    const origemDebug = criarSocketFalso();
    await montada.handlers.aplicarMensagem(
      origemDebug.comoWebSocket(),
      montada.partidaId,
      'jogador-2',
      { type: 'ATIVAR_DEBUG' },
    );
    assert.equal(obterDeadlineDoTurno(montada.partidaId), deadline, 'debug não renova');

    assert.equal(
      montada.sockets.get('jogador-2')!.mensagens.length,
      nAntes,
      'sem broadcast no canal',
    );
  } finally {
    await limparPartida(montada);
  }
});

// ─── Aviso único ───

test('TURNO_AVISO_30S dispara uma única vez por turno (tempo falso)', async (t) => {
  // Nome histórico (item 4 da #431, sem pendência): o "30S" é o default de
  // PARTIDA_TURNO_AVISO_SEGUNDOS — o valor efetivo viaja em `segundosRestantes`.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  try {
    await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 1 },
      { redis: montada.redis.comoRedis(), duracaoMs: 60_000, avisoEmMs: 30_000 },
    );
    t.mock.timers.tick(30_000);
    // O fire do aviso é async (persiste + broadcast): cede o event loop real
    // (setImmediate não é mockado) para o flush antes do assert.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const avisos = montada.sockets.get('jogador-1')!.mensagens.filter((m) => m.type === 'TURNO_AVISO_30S');
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0]!.jogadorId, 'jogador-1');
    assert.ok(typeof avisos[0]!.segundosRestantes === 'number');

    // Passado o dobro do prazo do aviso, continua único.
    t.mock.timers.tick(30_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      montada.sockets.get('jogador-1')!.mensagens.filter((m) => m.type === 'TURNO_AVISO_30S').length,
      1,
      'aviso único mesmo após o prazo',
    );
  } finally {
    t.mock.timers.reset();
    await limparPartida(montada);
  }
});

// ─── Extensão única do aviso final ───

test('1º estouro do Primeiro Turno: aviso final com +30s, sem falta e sem avanço', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  try {
    // Relógio vigente para observar a extensão (prazo longo: o fire não compete).
    await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 1 },
      { redis: montada.redis.comoRedis(), duracaoMs: 60_000, avisoEmMs: 50_000 },
    );
    const antes = Date.now();
    const resolveu = await montada.handlers.resolverExpiracaoDoTurno(montada.partidaId);
    const depois = Date.now();
    assert.equal(resolveu, true);

    const tipos = tiposDe(montada.sockets.get('jogador-1')!);
    assert.ok(tipos.includes('PRIMEIRO_TURNO_AVISO_FINAL'), 'aviso final no canal');
    assert.ok(!tipos.includes('FALTA_REGISTRADA'), 'sem falta no aviso final');
    assert.ok(!tipos.includes('TURNO_ENCERRADO'), 'sem avanço no aviso final');

    const estado = await lerEstado(montada);
    assert.equal(estado.jogadorAtivoId, 'jogador-1', 'vez mantida');
    assert.equal(estado.faltasPorJogador['jogador-1'] ?? 0, 0);
    assert.equal(estado.avisoFinalConsumidoPorJogador['jogador-1'], true);

    // Extensão única de +30s (carência do engine).
    const estendido = obterDeadlineDoTurno(montada.partidaId);
    assert.ok(typeof estendido === 'number');
    assert.ok(
      (estendido as number) >= antes + 30_000 && (estendido as number) <= depois + 30_000,
      'deadline ≈ agora + 30s',
    );

    // Bloqueante da PR (#431): o broadcast do aviso final carrega o deadline
    // estendido (wire aditivo para o HUD do #430) e o snapshot subsequente bate.
    const avisoFinal = montada.sockets.get('jogador-1')!.mensagens.find(
      (m) => m.type === 'PRIMEIRO_TURNO_AVISO_FINAL',
    );
    assert.ok(avisoFinal !== undefined, 'aviso final com deadline no broadcast');
    assert.equal(avisoFinal.deadlineDoTurnoEm, estendido);
    assert.ok(
      (avisoFinal.deadlineDoTurnoEm as number) >= antes + 30_000
        && (avisoFinal.deadlineDoTurnoEm as number) <= depois + 30_000,
      'broadcast ≈ agora + 30s',
    );
    const atomico = await montada.handlers.lerSnapshotAtomico(montada.partidaId);
    assert.ok(atomico !== null);
    assert.equal(atomico.deadlineDoTurnoEm, estendido, 'snapshot consistente com o broadcast');
    const snapshot = paraSnapshotWire(
      atomico.estado,
      [membro(1), membro(2), membro(3)],
      'em_andamento',
      Date.now(),
      atomico.historico,
      atomico.deadlineDoTurnoEm ?? undefined,
    );
    assert.equal(snapshot.deadlineDoTurnoEm, estendido);
  } finally {
    await limparPartida(montada);
  }
});

test('2º estouro do Primeiro Turno: Desistência causa tempo, sem nova extensão', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  try {
    await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 1 },
      { redis: montada.redis.comoRedis(), duracaoMs: 60_000, avisoEmMs: 50_000 },
    );
    assert.equal(await montada.handlers.resolverExpiracaoDoTurno(montada.partidaId), true);
    const nAvisosFinais = tiposDe(montada.sockets.get('jogador-1')!).filter(
      (t) => t === 'PRIMEIRO_TURNO_AVISO_FINAL',
    ).length;
    assert.equal(nAvisosFinais, 1);

    assert.equal(await montada.handlers.resolverExpiracaoDoTurno(montada.partidaId), true);
    const mensagens = montada.sockets.get('jogador-2')!.mensagens;
    const desistencia = mensagens.find((m) => m.type === 'DESISTENCIA_REGISTRADA');
    assert.deepEqual(desistencia, {
      type: 'DESISTENCIA_REGISTRADA',
      jogadorId: 'jogador-1',
      peaoId: 'peao-branco',
      causa: 'tempo',
    });
    assert.equal(
      tiposDe(montada.sockets.get('jogador-1')!).filter((t) => t === 'PRIMEIRO_TURNO_AVISO_FINAL').length,
      1,
      'sem segundo aviso final',
    );
    assert.ok(tiposDe(montada.sockets.get('jogador-2')!).includes('TURNO_INICIADO'), 'Passagem a bruno');

    const estado = await lerEstado(montada);
    assert.equal(estado.jogadorAtivoId, 'jogador-2');
    assert.ok(!estado.jogadores.some((j) => j.jogadorId === 'jogador-1'));
    await montada.handlers.drenarRetornosPendentes(2000);
    assert.equal(montada.desistencias.length, 1);
    assert.equal(montada.desistencias[0]!.causa, 'tempo');
  } finally {
    await limparPartida(montada);
  }
});

// ─── Estouro → falta + Passagem ───

test('estouro em turno normal: FALTA_REGISTRADA abre o lote e a vez passa', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    estado: estadoEmTurnoNormal(),
  });
  try {
    assert.equal(await montada.handlers.resolverExpiracaoDoTurno(montada.partidaId), true);

    const mensagens = montada.sockets.get('jogador-1')!.mensagens;
    assert.deepEqual(mensagens[0], {
      type: 'FALTA_REGISTRADA',
      jogadorId: 'jogador-1',
      totalDeFaltas: 1,
    });
    const tipos = tiposDe(montada.sockets.get('jogador-1')!);
    assert.ok(tipos.includes('TURNO_INICIADO'), 'Passagem no mesmo lote');

    const estado = await lerEstado(montada);
    assert.equal(estado.faltasPorJogador['jogador-1'], 1);
    assert.equal(estado.jogadorAtivoId, 'jogador-2');

    // O novo turno tem relógio próprio no canal.
    const turno = montada.sockets.get('jogador-2')!.mensagens.find((m) => m.type === 'TURNO_INICIADO');
    assert.ok(turno !== undefined && typeof turno.deadlineDoTurnoEm === 'number');
  } finally {
    await limparPartida(montada);
  }
});

test('4ª falta: Desistência causa tempo com término 2→1 e Retorno', async () => {
  const base = estadoEmTurnoNormal();
  const comFaltas: EstadoDaPartida = {
    ...base,
    jogadores: base.jogadores.filter((j) => j.jogadorId !== 'jogador-3'),
    faltasPorJogador: { 'jogador-1': 3 },
  };
  const montada = await montarPartida(['jogador-1', 'jogador-2'], { estado: comFaltas });
  try {
    assert.equal(await montada.handlers.resolverExpiracaoDoTurno(montada.partidaId), true);

    const mensagens = montada.sockets.get('jogador-1')!.mensagens;
    assert.deepEqual(mensagens[0], {
      type: 'FALTA_REGISTRADA',
      jogadorId: 'jogador-1',
      totalDeFaltas: 4,
    });
    const desistencia = mensagens.find((m) => m.type === 'DESISTENCIA_REGISTRADA');
    assert.deepEqual(desistencia, {
      type: 'DESISTENCIA_REGISTRADA',
      jogadorId: 'jogador-1',
      peaoId: 'peao-branco',
      causa: 'tempo',
    });
    assert.ok(tiposDe(montada.sockets.get('jogador-1')!).includes('PARTIDA_TERMINADA'));

    const estado = await lerEstado(montada);
    assert.notEqual(estado.resultado, null);
    await montada.handlers.drenarRetornosPendentes(2000);
    assert.equal(montada.avisos.length, 1);
    assert.equal(montada.avisos[0]!.resultado, 'derrota');
    assert.deepEqual(montada.avisos[0]!.jogadores, ['jogador-2']);
    assert.equal(montada.desistencias.length, 1);
    assert.equal(montada.desistencias[0]!.causa, 'tempo');

    // Terminou: sem relógio vigente.
    assert.equal(obterDeadlineDoTurno(montada.partidaId), null);
    assert.equal(await lerDeadlineDoTurno(montada.redis.comoRedis(), montada.partidaId), null);
  } finally {
    await limparPartida(montada);
  }
});

// ─── Pausa na reconexão ───

// Caracterização dos shapes (item 4 da #431, sem pendência): pausar anuncia
// TURNO_INICIADO sem deadline (cronômetro some) e retomar re-anuncia com o novo
// deadline — replay intencional, sem evento dedicado de pausa.
test('pausa esconde o deadline e a retomada re-anuncia com o novo marco (tempo falso)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    estado: estadoEmTurnoNormal(),
  });
  try {
    await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 2 },
      { redis: montada.redis.comoRedis(), duracaoMs: 60_000, avisoEmMs: 30_000 },
    );
    assert.equal(await pausarRelogioDoTurnoSeAtivo(montada.redis.comoRedis(), montada.partidaId, 'jogador-1'), true);
    assert.equal(obterDeadlineDoTurno(montada.partidaId), null, 'pausado: sem deadline vigente');

    // O deadline estouraria aqui — pausado, nada resolve nem avisa.
    t.mock.timers.tick(65_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(!tiposDe(montada.sockets.get('jogador-1')!).includes('FALTA_REGISTRADA'));
    assert.ok(!tiposDe(montada.sockets.get('jogador-1')!).includes('TURNO_AVISO_30S'));

    const antes = Date.now();
    assert.equal(await retomarRelogioDoTurnoSeAtivo(montada.redis.comoRedis(), montada.partidaId, 'jogador-1'), true);
    const retomado = obterDeadlineDoTurno(montada.partidaId);
    assert.ok(typeof retomado === 'number');
    // Restante congelado ≈ 60s (tolerância de 2s para o tick virtual).
    assert.ok((retomado as number) >= antes + 58_000 && (retomado as number) <= antes + 60_000);
    const reanuncios = montada.sockets.get('jogador-2')!.mensagens.filter((m) => m.type === 'TURNO_INICIADO');
    assert.equal(reanuncios.length, 2);
    assert.ok(!('deadlineDoTurnoEm' in reanuncios[0]!), 'pausa esconde o cronômetro');
    assert.equal(reanuncios[1]!.jogadorId, 'jogador-1');
    assert.equal(reanuncios[1]!.deadlineDoTurnoEm, retomado);
  } finally {
    t.mock.timers.reset();
    await limparPartida(montada);
  }
});

// Integração com tempo real (1/2, mantida contra flake): pausa→estouro ponta a
// ponta com o fire real do timer.
test('pausa no turno do Ativo ausente e retoma o restante na volta', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    estado: estadoEmTurnoNormal(),
    turnoSegundos: 2,
    avisoSegundos: 1,
  });
  try {
    await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 2 },
      { redis: montada.redis.comoRedis(), duracaoMs: 2000, avisoEmMs: 1000 },
    );
    assert.equal(await pausarRelogioDoTurnoSeAtivo(montada.redis.comoRedis(), montada.partidaId, 'jogador-1'), true);
    assert.equal(obterDeadlineDoTurno(montada.partidaId), null, 'pausado: sem deadline vigente');

    // O deadline estouraria aqui — pausado, nada resolve.
    await dormir(2500);
    assert.ok(
      !tiposDe(montada.sockets.get('jogador-1')!).includes('FALTA_REGISTRADA'),
      'pausado não resolve',
    );
    assert.ok(
      !tiposDe(montada.sockets.get('jogador-1')!).includes('TURNO_AVISO_30S'),
      'pausado não avisa',
    );
    const estadoPausado = await lerEstado(montada);
    assert.equal(estadoPausado.jogadorAtivoId, 'jogador-1', 'vez congelada');

    // Volta: retoma o restante (~2s) e re-anuncia o turno com novo deadline.
    const antes = Date.now();
    assert.equal(await retomarRelogioDoTurnoSeAtivo(montada.redis.comoRedis(), montada.partidaId, 'jogador-1'), true);
    const retomado = obterDeadlineDoTurno(montada.partidaId);
    assert.ok(typeof retomado === 'number');
    assert.ok((retomado as number) >= antes + 1500 && (retomado as number) <= Date.now() + 2500);
    const reanuncios = montada.sockets.get('jogador-2')!.mensagens.filter((m) => m.type === 'TURNO_INICIADO');
    // Pausa (sem deadline) + retomada (com novo deadline).
    assert.equal(reanuncios.length, 2);
    assert.ok(!('deadlineDoTurnoEm' in reanuncios[0]!), 'pausa esconde o cronômetro');
    assert.equal(reanuncios[1]!.jogadorId, 'jogador-1');
    assert.equal(reanuncios[1]!.deadlineDoTurnoEm, retomado);

    // O restante corre e o estouro resolve com falta.
    await dormir(2600);
    assert.ok(tiposDe(montada.sockets.get('jogador-1')!).includes('FALTA_REGISTRADA'));
    assert.equal((await lerEstado(montada)).jogadorAtivoId, 'jogador-2');
  } finally {
    await limparPartida(montada);
  }
});

// Caracterização da leniência (item 4 da #431, sem pendência): sem relógio mas
// com a partida em andamento e Ativo presente, a retomada arma um prazo cheio
// em vez de punir com falta imediata (cobre N-ésima admissão e vão de restart).
test('retomada sem relógio arma prazo cheio leniente', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  try {
    assert.equal(obterDeadlineDoTurno(montada.partidaId), null);
    const antes = Date.now();
    assert.equal(await retomarRelogioDoTurnoSeAtivo(montada.redis.comoRedis(), montada.partidaId, 'jogador-1'), true);
    const deadline = obterDeadlineDoTurno(montada.partidaId);
    assert.ok(typeof deadline === 'number');
    assert.ok((deadline as number) >= antes + 180_000 && (deadline as number) <= Date.now() + 180_000);
  } finally {
    await limparPartida(montada);
  }
});

// Review da PR #450 item 1: pausa (fire-and-forget no `close`) imediatamente
// seguida da retomada (`await` no upgrade) termina sempre retomada — a cadeia
// serial por partida ordena pausa→retomada mesmo sem `await` na pausa. Sem
// entrada em memória (restart simulado: só a chave), o caminho lento de Redis
// das duas competiria sem a cadeia. Tempo falso: determinístico, sem sleeps.
test('interleaving: pausa imediatamente seguida de retomada termina retomado (tempo falso)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    estado: estadoEmTurnoNormal(),
  });
  try {
    await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 2 },
      { redis: montada.redis.comoRedis(), duracaoMs: 60_000, avisoEmMs: 50_000 },
    );
    // Restart: derruba a memória, preserva a chave — pausa e retomada seguem
    // o caminho lento de Redis e competiriam sem a cadeia serial.
    __simularRestartDoRelogioParaTestes();
    assert.equal(obterDeadlineDoTurno(montada.partidaId), null);

    // Pausa disparada sem await (como no `close`) e retomada imediata (como
    // no upgrade): a ordem de enfileiramento define pausa→retomada.
    const pausa = pausarRelogioDoTurnoSeAtivo(montada.redis.comoRedis(), montada.partidaId, 'jogador-1');
    const retomada = retomarRelogioDoTurnoSeAtivo(montada.redis.comoRedis(), montada.partidaId, 'jogador-1');
    const [pausou, retomou] = await Promise.all([pausa, retomada]);
    assert.equal(pausou, true, 'pausa persistiu');
    assert.equal(retomou, true, 'retomada retomou o restante pausado');

    // Relógio retomado com o restante correto (≈60s, sem tempo decorrido no
    // relógio falso) — nunca termina pausado (deadline nulo = inconsistente).
    const deadline = obterDeadlineDoTurno(montada.partidaId);
    assert.ok(typeof deadline === 'number', 'retomado: deadline vigente');
    const agora = Date.now();
    assert.ok((deadline as number) >= agora + 58_000 && (deadline as number) <= agora + 60_000);
    assert.equal(await lerDeadlineDoTurno(montada.redis.comoRedis(), montada.partidaId), deadline);
  } finally {
    t.mock.timers.reset();
    await limparPartida(montada);
  }
});

test('pausa de quem não é o Ativo é no-op', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    estado: estadoEmTurnoNormal(),
  });
  try {
    await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 2 },
      { redis: montada.redis.comoRedis(), duracaoMs: 60_000, avisoEmMs: 50_000 },
    );
    const deadline = obterDeadlineDoTurno(montada.partidaId);
    assert.equal(await pausarRelogioDoTurnoSeAtivo(montada.redis.comoRedis(), montada.partidaId, 'jogador-2'), false);
    assert.equal(obterDeadlineDoTurno(montada.partidaId), deadline, 'relógio do Ativo segue');
  } finally {
    await limparPartida(montada);
  }
});

// ─── Rearme pós-restart ───

test('rearme: relógio vivo reagenda o restante exato', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    estado: estadoEmTurnoNormal(),
  });
  try {
    const deadline = await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 2 },
      { redis: montada.redis.comoRedis(), duracaoMs: 60_000, avisoEmMs: 50_000 },
    );
    __simularRestartDoRelogioParaTestes();
    assert.equal(obterDeadlineDoTurno(montada.partidaId), null, 'restart derruba a memória');

    await rearmarRelogioDoTurnoAposRestart(montada.redis.comoRedis());
    // Rearme preserva o deadline (reconstruído como agora+restante: tolera 5ms
    // de deriva entre as duas leituras do relógio de parede).
    const rearme = obterDeadlineDoTurno(montada.partidaId);
    assert.ok(typeof rearme === 'number');
    assert.ok(Math.abs((rearme as number) - deadline) <= 5, 'rearme preserva o deadline');
    assert.ok(
      Math.abs((await lerDeadlineDoTurno(montada.redis.comoRedis(), montada.partidaId))! - deadline) <= 5,
    );

    // Ainda vigente: verificação direta não resolve.
    assert.equal(await verificarExpiracaoDoTurnoSeNecessario(montada.redis.comoRedis(), montada.partidaId), false);
    assert.ok(!tiposDe(montada.sockets.get('jogador-1')!).includes('FALTA_REGISTRADA'));
  } finally {
    await limparPartida(montada);
  }
});

// Integração com tempo real (2/2, mantida contra flake): o jitter do rearme
// vencido só existe no relógio real.
test('rearme: deadline vencido no downtime resolve no próprio lote', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    estado: estadoEmTurnoNormal(),
  });
  try {
    await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 2 },
      { redis: montada.redis.comoRedis(), duracaoMs: 80 },
    );
    await dormir(150);
    __simularRestartDoRelogioParaTestes();

    await rearmarRelogioDoTurnoAposRestart(montada.redis.comoRedis());
    // O fire reagendado tem jitter (pode já ter resolvido sozinho): resolve
    // direto só se ainda pendente — determinístico nos dois casos.
    if (!tiposDe(montada.sockets.get('jogador-1')!).includes('FALTA_REGISTRADA')) {
      assert.equal(await verificarExpiracaoDoTurnoSeNecessario(montada.redis.comoRedis(), montada.partidaId), true);
    }
    assert.deepEqual(montada.sockets.get('jogador-1')!.mensagens[0], {
      type: 'FALTA_REGISTRADA',
      jogadorId: 'jogador-1',
      totalDeFaltas: 1,
    });
    assert.equal((await lerEstado(montada)).jogadorAtivoId, 'jogador-2');
  } finally {
    await limparPartida(montada);
  }
});

test('rearme: Ativo em reconexão rearma pausado e a volta retoma', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    estado: estadoEmTurnoNormal(),
    emReconexao: ['jogador-1'],
  });
  try {
    await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 2 },
      { redis: montada.redis.comoRedis(), duracaoMs: 60_000, avisoEmMs: 50_000 },
    );
    __simularRestartDoRelogioParaTestes();

    await rearmarRelogioDoTurnoAposRestart(montada.redis.comoRedis());
    assert.equal(obterDeadlineDoTurno(montada.partidaId), null, 'rearme pausado: sem deadline vigente');
    assert.equal(await verificarExpiracaoDoTurnoSeNecessario(montada.redis.comoRedis(), montada.partidaId), false);

    // Volta (presença volta a conectado): retoma o restante.
    const bruto = await montada.redis.comoRedis().get(chaveDaPartida(montada.partidaId));
    assert.ok(bruto !== null);
    const partida = JSON.parse(bruto) as { roster: Array<{ jogadorId: string; presenca: string }> };
    for (const m of partida.roster) {
      if (m.jogadorId === 'jogador-1') m.presenca = 'conectado';
    }
    await montada.redis.set(
      chaveDaPartida(montada.partidaId),
      JSON.stringify({
        partidaId: montada.partidaId,
        serverId: 'game-server-teste-relogio',
        salaId: 'sala-1',
        codigoDeSala: 'ABC123',
        roster: partida.roster,
        estado: 'em_andamento',
        criadaEm: new Date().toISOString(),
        iniciadaEm: Date.now(),
      }),
    );
    assert.equal(await retomarRelogioDoTurnoSeAtivo(montada.redis.comoRedis(), montada.partidaId, 'jogador-1'), true);
    assert.ok(typeof obterDeadlineDoTurno(montada.partidaId) === 'number');
  } finally {
    await limparPartida(montada);
  }
});

// ─── Amedrontado sem relógio ───

test('decisão do lote: Amedrontado cancela, término cancela, giro mantém', () => {
  const normal = estadoEmTurnoNormal();
  assert.deepEqual(proximoRelogioParaLote(normal, [{ tipo: 'peca_girada', pecaId: 'x', orientacaoAnterior: 0, orientacao: 90, sentido: 'horario' }]), {
    acao: 'manter',
  });
  assert.deepEqual(
    proximoRelogioParaLote(normal, [{ tipo: 'turno_iniciado', jogadorId: 'jogador-2', rodada: 2 }]),
    { acao: 'armar', jogadorAtivoId: 'jogador-2', rodada: 2 },
  );
  assert.deepEqual(
    proximoRelogioParaLote(normal, [
      { tipo: 'turno_iniciado', jogadorId: 'jogador-2', rodada: 2 },
      { tipo: 'partida_terminada', desfecho: { tipo: 'derrota', motivo: 'desistencia' } },
    ]),
    { acao: 'cancelar', motivo: 'termino' },
  );
  assert.deepEqual(
    proximoRelogioParaLote(normal, [{ tipo: 'aviso_final_do_primeiro_turno', jogadorId: 'jogador-1' }]),
    { acao: 'estender' },
  );

  // Alvo Amedrontado: sem relógio.
  const comMedo: EstadoDaPartida = {
    ...normal,
    jogadores: normal.jogadores.map((j) =>
      j.jogadorId === 'jogador-2' ? { ...j, sanidade: 0, amedrontado: true } : j,
    ),
  };
  assert.deepEqual(
    proximoRelogioParaLote(comMedo, [{ tipo: 'turno_iniciado', jogadorId: 'jogador-2', rodada: 2 }]),
    { acao: 'cancelar', motivo: 'amedrontado' },
  );
});

test('resolução com Ativo Amedrontado aborta sem mutar', async () => {
  const base = estadoFresco(['jogador-1', 'jogador-2', 'jogador-3']);
  const comMedo: EstadoDaPartida = {
    ...base,
    jogadores: base.jogadores.map((j) =>
      j.jogadorId === 'jogador-1' ? { ...j, sanidade: 0, amedrontado: true } : j,
    ),
  };
  const antes = JSON.stringify(comMedo);
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], { estado: comMedo });
  try {
    assert.equal(await montada.handlers.resolverExpiracaoDoTurno(montada.partidaId), false);
    assert.equal(JSON.stringify(await lerEstado(montada)), antes, 'estado intacto');
    assert.equal(montada.sockets.get('jogador-1')!.mensagens.length, 0, 'sem broadcast');
  } finally {
    await limparPartida(montada);
  }
});

// ─── Término cancela + corrida fire-vs-Passagem ───

test('término no lote cancela o relógio vigente', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2']);
  try {
    await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 1 },
      { redis: montada.redis.comoRedis(), duracaoMs: 60_000, avisoEmMs: 50_000 },
    );
    await montada.handlers.aplicarMensagem(
      montada.sockets.get('jogador-1')!.comoWebSocket(),
      montada.partidaId,
      'jogador-1',
      { type: 'DESISTIR_DA_PARTIDA', jogadorId: 'jogador-1' },
    );
    assert.equal(obterDeadlineDoTurno(montada.partidaId), null);
    assert.equal(await lerDeadlineDoTurno(montada.redis.comoRedis(), montada.partidaId), null);
    assert.equal(montada.redis.tem(chaveRelogioDoTurno(montada.partidaId)), false);
  } finally {
    await limparPartida(montada);
  }
});

test('corrida: Passagem venceu o fire — verificação tardia aborta sem mutar', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3'], {
    estado: estadoEmTurnoNormal(),
  });
  try {
    await armarRelogioDoTurno(
      montada.partidaId,
      { jogadorAtivoId: 'jogador-1', rodada: 2 },
      { redis: montada.redis.comoRedis(), duracaoMs: 60_000, avisoEmMs: 50_000 },
    );
    const fotoAntiga = obterRelogioAgendado(montada.partidaId);
    assert.ok(fotoAntiga !== null);

    // Passagem real (desistência do Ativo): rearma para jogador-2.
    await montada.handlers.aplicarMensagem(
      montada.sockets.get('jogador-1')!.comoWebSocket(),
      montada.partidaId,
      'jogador-1',
      { type: 'DESISTIR_DA_PARTIDA', jogadorId: 'jogador-1' },
    );
    assert.equal((await lerEstado(montada)).jogadorAtivoId, 'jogador-2');

    // Fire tardio do relógio antigo: aborta.
    const nMensagens = montada.sockets.get('jogador-2')!.mensagens.length;
    assert.equal(
      await verificarExpiracaoDoTurnoSeNecessario(montada.redis.comoRedis(), montada.partidaId, fotoAntiga),
      false,
    );
    assert.equal((await lerEstado(montada)).jogadorAtivoId, 'jogador-2', 'vez intacta');
    assert.ok(!tiposDe(montada.sockets.get('jogador-2')!).includes('FALTA_REGISTRADA'), 'sem falta fantasma');
    assert.equal(montada.sockets.get('jogador-2')!.mensagens.length, nMensagens, 'sem broadcast extra');
  } finally {
    await limparPartida(montada);
  }
});

// ─── Snapshot + anúncio com deadline ───

test('snapshot atômico e anúncio carregam deadlineDoTurnoEm', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  try {
    await montada.handlers.aplicarMensagem(
      montada.sockets.get('jogador-1')!.comoWebSocket(),
      montada.partidaId,
      'jogador-1',
      { type: 'DESISTIR_DA_PARTIDA', jogadorId: 'jogador-1' },
    );
    const deadline = obterDeadlineDoTurno(montada.partidaId);
    assert.ok(typeof deadline === 'number');

    const atomico = await montada.handlers.lerSnapshotAtomico(montada.partidaId);
    assert.ok(atomico !== null);
    assert.equal(atomico.deadlineDoTurnoEm, deadline);
    const snapshot = paraSnapshotWire(
      atomico.estado,
      [membro(1), membro(2), membro(3)],
      'em_andamento',
      Date.now(),
      atomico.historico,
      atomico.deadlineDoTurnoEm ?? undefined,
    );
    assert.equal(snapshot.deadlineDoTurnoEm, deadline);

    const retorno = criarSocketFalso();
    await montada.handlers.anunciarTurnoAtual(montada.partidaId, retorno.comoWebSocket());
    assert.deepEqual(retorno.mensagens[0], {
      type: 'TURNO_INICIADO',
      jogadorId: 'jogador-2',
      rodada: 1,
      deadlineDoTurnoEm: deadline,
    });
  } finally {
    await limparPartida(montada);
  }
});

test('sem relógio, snapshot e anúncio preservam o shape antigo', async () => {
  const montada = await montarPartida(['jogador-1', 'jogador-2', 'jogador-3']);
  try {
    const estado = await lerEstado(montada);
    const snapshot = paraSnapshotWire(estado, [membro(1), membro(2), membro(3)], 'em_andamento');
    assert.ok(!('deadlineDoTurnoEm' in snapshot), 'snapshot sem a chave');

    const retorno = criarSocketFalso();
    await montada.handlers.anunciarTurnoAtual(montada.partidaId, retorno.comoWebSocket());
    assert.deepEqual(retorno.mensagens[0], {
      type: 'TURNO_INICIADO',
      jogadorId: 'jogador-1',
      rodada: 1,
    });
  } finally {
    await limparPartida(montada);
  }
});
