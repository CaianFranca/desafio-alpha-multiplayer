import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aplicarComando,
  criarSala,
  encaminharSala,
  entrarNaSala,
  aceitarEncaminhamento,
  estadoDoLobbyVazio,
  type EstadoDoLobby,
} from '@flicker/engine';
import { SalasHandlers } from '../src/salas/handlers.ts';

type Deps = ConstructorParameters<typeof SalasHandlers>[0];

function handlersCom(
  overrides: Partial<{
    salaBruta: { partidaId: string | null } | null;
    estadoSala: { encaminhamento?: { partidaId?: string } | null } | null;
    encaminhamento: { serverId: string; partidaId: string } | null;
    chaveExiste: boolean;
    markerEmVooIso: string | null;
  }>,
): { handlers: SalasHandlers; chamadas: { obterEncaminhamento: number } } {
  const chamadas = { obterEncaminhamento: 0 };
  const redisFalso = {
    async exists(): Promise<number> {
      return overrides.chaveExiste === true ? 1 : 0;
    },
    async ttl(): Promise<number> {
      return 100;
    },
    async get(chave: string): Promise<string | null> {
      if (chave.startsWith('lobby:encaminhamento-voo:')) {
        return overrides.markerEmVooIso ?? null;
      }
      return null;
    },
  };
  const deps = {
    repo: {
      async obterSalaBruta() {
        return overrides.salaBruta ?? null;
      },
      async obterEncaminhamento() {
        chamadas.obterEncaminhamento += 1;
        return overrides.encaminhamento ?? null;
      },
    },
    projecao: {
      async obterEstadoSala() {
        return overrides.estadoSala ?? null;
      },
    },
    broadcast: {},
    estado: {},
    reconexao: {},
    linkBase: 'http://localhost/convite',
    async revalidarSessao() {
      return true;
    },
    redis: redisFalso,
  } as unknown as Deps;
  return { handlers: new SalasHandlers(deps), chamadas };
}

function orfaDe(handlers: SalasHandlers): (salaId: string) => Promise<boolean> {
  return (handlers as unknown as { partidaDaSalaEstaOrfa(salaId: string): Promise<boolean> })
    .partidaDaSalaEstaOrfa.bind(handlers);
}

// Formato da previsão (interface privada de handlers.ts): o teste usa
// tipagem estrutural via cast.
type PrevisaoLimpezaOrfa = {
  salaId: string;
  decisao: { orfa: boolean; partidaId: string | null };
};

function preverDe(handlers: SalasHandlers): (jogadorId: string, salaIdAlvo?: string) => Promise<PrevisaoLimpezaOrfa | null> {
  return (handlers as unknown as {
    preverLimpezaOrfa(jogadorId: string, salaIdAlvo?: string): Promise<PrevisaoLimpezaOrfa | null>;
  }).preverLimpezaOrfa.bind(handlers);
}

function aplicarDe(handlers: SalasHandlers): (jogadorId: string, previsao: PrevisaoLimpezaOrfa) => Promise<boolean> {
  return (handlers as unknown as {
    aplicarLimpezaOrfa(jogadorId: string, previsao: PrevisaoLimpezaOrfa): Promise<boolean>;
  }).aplicarLimpezaOrfa.bind(handlers);
}

test('A8: sem partida nas 3 fontes não libera (fail-closed)', async () => {
  const { handlers, chamadas } = handlersCom({
    salaBruta: { partidaId: null },
    estadoSala: null,
    encaminhamento: null,
    chaveExiste: false,
  });
  const orfa = await orfaDe(handlers)('sala-1');
  assert.equal(chamadas.obterEncaminhamento, 1, 'deveria consultar a terceira fonte');
  assert.equal(orfa, false, 'sem partida nas 3 fontes a sala não é liberável');
});

test('A8: terceira fonte com partida + chave ausente mantém o bypass', async () => {
  const { handlers } = handlersCom({
    salaBruta: { partidaId: null },
    estadoSala: null,
    encaminhamento: { serverId: 'srv-1', partidaId: 'partida-1' },
    chaveExiste: false,
  });
  const orfa = await orfaDe(handlers)('sala-1');
  assert.equal(orfa, true, 'partida confirmada sem chave continua órfã liberável');
});

// ===== Relógio do em-voo (review #304, item 3; ADR-0010) =====

test('relógio: marker do em-voo acima do teto libera a sala sem partida nas 3 fontes', async () => {
  const { handlers } = handlersCom({
    salaBruta: { partidaId: null },
    estadoSala: null,
    encaminhamento: null,
    chaveExiste: false,
    markerEmVooIso: new Date(Date.now() - 120_000).toISOString(),
  });
  const orfa = await orfaDe(handlers)('sala-1');
  assert.equal(orfa, true, 'órfã sem rastro com oferta velha (> teto) é liberável');
});

test('relógio: marker do em-voo dentro do teto mantém a sala presa', async () => {
  const { handlers } = handlersCom({
    salaBruta: { partidaId: null },
    estadoSala: null,
    encaminhamento: null,
    chaveExiste: false,
    markerEmVooIso: new Date().toISOString(),
  });
  const orfa = await orfaDe(handlers)('sala-1');
  assert.equal(orfa, false, 'oferta nova (a admissão ainda pode completar) permanece presa');
});

test('relógio: sem marker (órfã anterior ao deploy), fail-closed mantém', async () => {
  const { handlers } = handlersCom({
    salaBruta: { partidaId: null },
    estadoSala: null,
    encaminhamento: null,
    chaveExiste: false,
    markerEmVooIso: null,
  });
  const orfa = await orfaDe(handlers)('sala-1');
  assert.equal(orfa, false, 'sem rastro do em-voo, o caminho antigo (expiração) segue');
});

// ===== Caminhos felizes do bypass de órfã (review #304 item 5) =====

function estadoEncaminhado(): EstadoDoLobby {
  const aplicar = (estado: EstadoDoLobby, comando: Parameters<typeof aplicarComando>[1]): EstadoDoLobby => {
    const resultado = aplicarComando(estado, comando);
    if (!resultado.sucesso) {
      throw new Error(resultado.erro.mensagem);
    }
    return resultado.estado;
  };
  let estado = aplicar(estadoDoLobbyVazio(), { tipo: 'criar_sala', salaId: 'sala-1', codigo: 'ABC123', jogadorId: 'jogador-1', membroId: 'membro-1' });
  estado = aplicar(estado, { tipo: 'entrar_na_sala', salaId: 'sala-1', jogadorId: 'jogador-2', membroId: 'membro-2' });
  estado = aplicar(estado, { tipo: 'alternar_prontidao', salaId: 'sala-1', jogadorId: 'jogador-1' });
  estado = aplicar(estado, { tipo: 'alternar_prontidao', salaId: 'sala-1', jogadorId: 'jogador-2' });
  estado = aplicar(estado, { tipo: 'encaminhar_sala', salaId: 'sala-1', anfitriaoMembroId: 'membro-1' });
  // A oferta não congela; o aceite fixa o estado em `encaminhada`.
  return aplicar(estado, { tipo: 'aceitar_encaminhamento', salaId: 'sala-1' });
}

function handlersComOrfa(
  engine: EstadoDoLobby,
  opcoes: {
    semSalaNoEngine?: boolean;
    partidaNoRedis?: { estado: string; roster: Array<{ presenca: string }> };
  } = {},
) {
  const registro = {
    associacoesLimpas: [] as string[],
    saidasAtomics: [] as unknown[][],
    broadcasts: [] as unknown[],
    socketsRemovidos: 0,
    hidratacoes: 0,
  };
  const salaDominio = engine.salas[0];
  const estadoFalso = {
    estado: opcoes.semSalaNoEngine ? estadoDoLobbyVazio() : engine,
    abertas: opcoes.semSalaNoEngine
      ? new Map()
      : new Map([['sala-1', { sala: engine.salas[0], codigo: 'ABC123' }]]),
    apelidoPorJogadorId: new Map([['jogador-1', 'um'], ['jogador-2', 'dois']]),
    substituirEstado(novo: EstadoDoLobby) {
      estadoFalso.estado = novo;
      estadoFalso.abertas = new Map(
        [...novo.salas].map((sala) => [sala.id, { sala, codigo: 'ABC123' }]),
      );
    },
    hidratarSala(_repo: unknown, salaId: string): Promise<boolean> {
      // Espelha a hidratação real: injeta a sala do PG no engine/memória.
      registro.hidratacoes += 1;
      const sala = salaDominio;
      estadoFalso.estado = { salas: [...estadoFalso.estado.salas, sala] };
      estadoFalso.abertas.set(salaId, { sala, codigo: 'ABC123' });
      return Promise.resolve(true);
    },
  };
  // Estado Redis mutável: os testes de revalidação mudam-no ENTRE a decisão
  // (fora da fila) e a aplicação (dentro da fila).
  const estadoRedis = {
    existe: opcoes.partidaNoRedis !== undefined ? 1 : 0,
    partidaJson: opcoes.partidaNoRedis !== undefined ? JSON.stringify(opcoes.partidaNoRedis) : null,
    quebrarGet: false,
  };
  const redisFalso = {
    async exists(chave: string): Promise<number> {
      return chave === 'game-server:partida:partida-1' ? estadoRedis.existe : 0;
    },
    async ttl(): Promise<number> {
      return 100;
    },
    async get(chave: string): Promise<string | null> {
      if (estadoRedis.quebrarGet) {
        return Promise.reject(new Error('redis fora do ar'));
      }
      if (chave === 'game-server:partida:partida-1') {
        return estadoRedis.partidaJson;
      }
      return null;
    },
  };
  const deps = {
    repo: {
      async obterSalaBruta() {
        return {
          id: 'sala-1',
          codigo: 'ABC123',
          anfitriaoId: 'jogador-1',
          status: 'encaminhada',
          serverId: 'srv-1',
          partidaId: 'partida-1',
        };
      },
      async obterEncaminhamento() {
        return null;
      },
      async listarMembrosDaSala() {
        return [];
      },
      async obterSalaAtivaDoJogador() {
        return 'sala-1';
      },
      async sairMembroAtomico(...args: unknown[]) {
        registro.saidasAtomics.push(args);
      },
    },
    projecao: {
      async obterEstadoSala() {
        return null;
      },
      async obterAssociacaoJogador(jogadorId: string) {
        void jogadorId;
        return overridesAssociacao.valor;
      },
      async limparAssociacaoJogador(jogadorId: string) {
        registro.associacoesLimpas.push(jogadorId);
      },
      async definirEstadoSala() {},
      async limparSala() {},
    },
    broadcast: {
      enviar(_salaId: string, evento: unknown) {
        registro.broadcasts.push(evento);
      },
      // Review JF532, O3: o bypass remove os sockets do jogador, não um
      // socket específico.
      removerSocketPorJogadorId() {
        registro.socketsRemovidos += 1;
      },
    },
    estado: estadoFalso,
    reconexao: {},
    linkBase: 'http://localhost/convite',
    async revalidarSessao() {
      return true;
    },
    redis: redisFalso,
  } as unknown as Deps;
  const overridesAssociacao = { valor: 'sala-1' as string | null };
  return { handlers: new SalasHandlers(deps), registro, overridesAssociacao, estadoRedis };
}

// Review JF532 (item 1): a limpeza de órfã virou um par prever (fora da
// fila) / aplicar (dentro da fila) — os helpers chamam as duas etapas.
async function limparAssociacaoOrfaDe(handlers: SalasHandlers, jogadorId: string): Promise<boolean> {
  const previsao = await preverDe(handlers)(jogadorId);
  if (previsao === null) {
    return false;
  }
  return aplicarDe(handlers)(jogadorId, previsao);
}

async function limparOrfaDeOutraSalaDe(handlers: SalasHandlers, jogadorId: string, salaIdAlvo: string): Promise<boolean> {
  const previsao = await preverDe(handlers)(jogadorId, salaIdAlvo);
  if (previsao === null) {
    return false;
  }
  return aplicarDe(handlers)(jogadorId, previsao);
}

test('bypass órfã: membro comum sai via engine, com projeção, broadcast e PG', async () => {
  const { handlers, registro } = handlersComOrfa(estadoEncaminhado());
  const limpo = await limparAssociacaoOrfaDe(handlers, 'jogador-2');

  assert.equal(limpo, true);
  // Sucesso do bypass no engine: saída gravada no PG sem sucessão.
  assert.equal(registro.saidasAtomics.length, 1);
  assert.deepEqual(registro.saidasAtomics[0], ['sala-1', 'jogador-2', 'saida', false, undefined]);
  // Estado em memória reflete o membro encerrado.
  const membro = estadoSalas(handlers).find((s) => s.id === 'sala-1')?.membros.find((m) => m.jogadorId === 'jogador-2');
  assert.equal(membro?.estado, 'encerrado');
  // Projeção da associação limpa e broadcast do MEMBRO_SAIU.
  assert.deepEqual(registro.associacoesLimpas, ['jogador-2']);
  assert.ok(registro.broadcasts.some((e) => (e as { type?: string }).type === 'MEMBRO_SAIU'));
  assert.equal(registro.socketsRemovidos, 1);
});

test('bypass órfã: anfitrião que sai grava a sucessão no mesmo commit', async () => {
  const { handlers, registro } = handlersComOrfa(estadoEncaminhado());
  const limpo = await limparAssociacaoOrfaDe(handlers, 'jogador-1');

  assert.equal(limpo, true);
  assert.equal(registro.saidasAtomics.length, 1);
  assert.deepEqual(registro.saidasAtomics[0], ['sala-1', 'jogador-1', 'saida', false, 'jogador-2']);
});

test('bypass órfã: ramo PG (associação nula) passa pelo engine', async () => {
  const { handlers, registro, overridesAssociacao } = handlersComOrfa(estadoEncaminhado());
  overridesAssociacao.valor = null;
  await limparOrfaDeOutraSalaDe(handlers, 'jogador-2', 'sala-alvo');

  // Saída via bypass do engine (não mais `sairMembroAtomico` cru), associação limpa.
  assert.equal(registro.saidasAtomics.length, 1);
  assert.deepEqual(registro.saidasAtomics[0], ['sala-1', 'jogador-2', 'saida', false, undefined]);
  assert.deepEqual(registro.associacoesLimpas, ['jogador-2']);
  assert.ok(registro.broadcasts.some((e) => (e as { type?: string }).type === 'MEMBRO_SAIU'));
});

// Review #304, item 2: com a memória vazia (pós-restart sem hidratação dessa
// sala), o fallback PG hidrata a sala no engine e o bypass destrava o
// jogador — antes, o `abertas.get(...)` desistia e `JOGADOR_JA_ASSOCIADO`
// persistia.
test('bypass órfã: memória vazia hidrata do PG e libera (fallback PG do item 2)', async () => {
  const { handlers, registro, overridesAssociacao } = handlersComOrfa(estadoEncaminhado(), {
    semSalaNoEngine: true,
  });
  overridesAssociacao.valor = null;
  await limparOrfaDeOutraSalaDe(handlers, 'jogador-2', 'sala-alvo');

  // O fallback hidratou e o bypass aplicou a saída via engine.
  assert.equal(registro.saidasAtomics.length, 1);
  assert.deepEqual(registro.saidasAtomics[0], ['sala-1', 'jogador-2', 'saida', false, undefined]);
  assert.deepEqual(registro.associacoesLimpas, ['jogador-2']);
  assert.ok(registro.broadcasts.some((e) => (e as { type?: string }).type === 'MEMBRO_SAIU'));
  // A sala hidratada permanece no engine (estado consistente pós-bypass).
  assert.equal(estadoSalas(handlers).some((s) => s.id === 'sala-1'), true);
});

// Review de hidratação: a Partida Órfã é confirmada ANTES da hidratação —
// hidratar sala não-órfã fabricaria presença (`conectado`/`consistente`) fora
// do bypass.
test('bypass órfã: não-órfã não hidrata (partida parcial no Redis)', async () => {
  const { handlers, registro, overridesAssociacao } = handlersComOrfa(estadoEncaminhado(), {
    semSalaNoEngine: true,
    partidaNoRedis: { estado: 'preparada', roster: [{ presenca: 'conectado' }] },
  });
  overridesAssociacao.valor = 'sala-1';
  const limpo = await limparAssociacaoOrfaDe(handlers, 'jogador-2');

  assert.equal(limpo, false, 'roster com admissão parcial não libera o bypass');
  assert.equal(registro.hidratacoes, 0, 'sala não-órfã não pode ser hidratada');
  assert.equal(estadoSalas(handlers).some((s) => s.id === 'sala-1'), false, 'sala permanece fora do engine');
  assert.equal(registro.saidasAtomics.length, 0);
  assert.deepEqual(registro.associacoesLimpas, []);
  assert.equal(registro.broadcasts.length, 0);
});

test('bypass órfã: ramo PG não hidrata sala não-órfã', async () => {
  const { handlers, registro, overridesAssociacao } = handlersComOrfa(estadoEncaminhado(), {
    semSalaNoEngine: true,
    partidaNoRedis: { estado: 'preparada', roster: [{ presenca: 'conectado' }] },
  });
  overridesAssociacao.valor = null;
  await limparOrfaDeOutraSalaDe(handlers, 'jogador-2', 'sala-alvo');

  assert.equal(registro.hidratacoes, 0, 'sala não-órfã no fallback PG não pode ser hidratada');
  assert.equal(registro.saidasAtomics.length, 0);
  assert.deepEqual(registro.associacoesLimpas, []);
  assert.equal(registro.broadcasts.length, 0);
});

test('bypass órfã: órfã hidrata uma vez e libera (contagem do fallback PG)', async () => {
  const { handlers, registro, overridesAssociacao } = handlersComOrfa(estadoEncaminhado(), {
    semSalaNoEngine: true,
  });
  overridesAssociacao.valor = null;
  await limparOrfaDeOutraSalaDe(handlers, 'jogador-2', 'sala-alvo');

  assert.equal(registro.hidratacoes, 1, 'a sala órfã confirmada hidrata exatamente uma vez');
  assert.equal(registro.saidasAtomics.length, 1, 'bypass aplicado via engine');
  assert.deepEqual(registro.associacoesLimpas, ['jogador-2']);
  assert.ok(registro.broadcasts.some((e) => (e as { type?: string }).type === 'MEMBRO_SAIU'));
});

// ===== Revalidação quente dentro da fila (review JF532, item 1) =====

// Decisão fora da fila + revalidação dentro: partida que vira `em_andamento`
// entre decisão e aplicação trava o bypass — zero mutações.
test('revalidação: partida vira em_andamento entre decisão e aplicação — fail-closed', async () => {
  const { handlers, registro, overridesAssociacao, estadoRedis } = handlersComOrfa(estadoEncaminhado(), {
    partidaNoRedis: { estado: 'preparada', roster: [{ presenca: 'em_reconexao' }] },
  });
  overridesAssociacao.valor = 'sala-1';
  const previsao = await preverDe(handlers)('jogador-2');
  assert.ok(previsao !== null, 'órfã confirmada na decisão (fora da fila)');

  // Entre a decisão e a aplicação, a admissão completa: partida em_andamento.
  estadoRedis.existe = 1;
  estadoRedis.partidaJson = JSON.stringify({ estado: 'em_andamento', roster: [{ presenca: 'conectado' }] });

  const limpo = await aplicarDe(handlers)('jogador-2', previsao);
  assert.equal(limpo, false, 'partida em andamento não libera o bypass');
  assert.equal(registro.hidratacoes, 0, 'nenhuma hidratação');
  assert.equal(registro.saidasAtomics.length, 0, 'nenhuma saída no PG');
  assert.deepEqual(registro.associacoesLimpas, [], 'nenhuma associação limpa');
  assert.equal(registro.broadcasts.length, 0, 'nenhum broadcast');
});

// Roster parcial (admissão parcial) entre decisão e aplicação: fail-closed.
test('revalidação: roster parcial entre decisão e aplicação — fail-closed', async () => {
  const { handlers, registro, overridesAssociacao, estadoRedis } = handlersComOrfa(estadoEncaminhado(), {
    partidaNoRedis: { estado: 'preparada', roster: [{ presenca: 'em_reconexao' }] },
  });
  overridesAssociacao.valor = 'sala-1';
  const previsao = await preverDe(handlers)('jogador-2');
  assert.ok(previsao !== null);

  // Um dos membros admitiu entre a decisão e a aplicação.
  estadoRedis.partidaJson = JSON.stringify({
    estado: 'preparada',
    roster: [{ presenca: 'em_reconexao' }, { presenca: 'conectado' }],
  });

  const limpo = await aplicarDe(handlers)('jogador-2', previsao);
  assert.equal(limpo, false, 'roster parcial não libera o bypass');
  assert.equal(registro.saidasAtomics.length, 0);
  assert.deepEqual(registro.associacoesLimpas, []);
  assert.equal(registro.broadcasts.length, 0);
});

// Erro de I/O na revalidação: fail-closed, zero mutações.
test('revalidação: erro de I/O no Redis trava o bypass', async () => {
  const { handlers, registro, overridesAssociacao, estadoRedis } = handlersComOrfa(estadoEncaminhado(), {
    partidaNoRedis: { estado: 'preparada', roster: [{ presenca: 'em_reconexao' }] },
  });
  overridesAssociacao.valor = 'sala-1';
  const previsao = await preverDe(handlers)('jogador-2');
  assert.ok(previsao !== null, 'decisão sai antes do erro de I/O');

  // Entre a decisão e a aplicação, o Redis começa a rejeitar leituras.
  estadoRedis.quebrarGet = true;

  const limpo = await aplicarDe(handlers)('jogador-2', previsao);
  assert.equal(limpo, false, 'erro de I/O na revalidação é fail-closed');
  assert.equal(registro.hidratacoes, 0);
  assert.equal(registro.saidasAtomics.length, 0);
  assert.deepEqual(registro.associacoesLimpas, []);
  assert.equal(registro.broadcasts.length, 0);
});

// Encaminhamento em voo para a sala: fail-closed.
test('revalidação: encaminhamento em voo para a sala trava o bypass', async () => {
  const { handlers, registro, overridesAssociacao } = handlersComOrfa(estadoEncaminhado());
  overridesAssociacao.valor = 'sala-1';
  const previsao = await preverDe(handlers)('jogador-2');
  assert.ok(previsao !== null);

  (handlers as unknown as { encaminhamentosEmVoo: Set<string> }).encaminhamentosEmVoo.add('sala-1');

  const limpo = await aplicarDe(handlers)('jogador-2', previsao);
  assert.equal(limpo, false, 'encaminhamento em voo é fail-closed');
  assert.equal(registro.saidasAtomics.length, 0);
  assert.deepEqual(registro.associacoesLimpas, []);
  assert.equal(registro.broadcasts.length, 0);
});

// Jogador divergiu para outra Sala entre a decisão e a aplicação: aborta.
test('revalidação: jogador reassociação para outra sala entre decisão e aplicação — aborta', async () => {
  const { handlers, registro, overridesAssociacao } = handlersComOrfa(estadoEncaminhado());
  overridesAssociacao.valor = 'sala-1';
  const previsao = await preverDe(handlers)('jogador-2');
  assert.ok(previsao !== null);

  overridesAssociacao.valor = 'sala-alvo';

  const limpo = await aplicarDe(handlers)('jogador-2', previsao);
  assert.equal(limpo, false, 'associação divergente aborta a aplicação');
  assert.equal(registro.saidasAtomics.length, 0);
  assert.deepEqual(registro.broadcasts.length, 0);
});

// Fluxo completo (decisão fora + revalidação dentro): órfã confirmada libera
// com hidratação exatamente 1× e bypass via engine.
test('fluxo completo: órfã confirmada no par prever/aplicar hidrata exatamente 1×', async () => {
  const { handlers, registro, overridesAssociacao } = handlersComOrfa(estadoEncaminhado(), {
    semSalaNoEngine: true,
  });
  overridesAssociacao.valor = 'sala-1';
  const limpo = await limparAssociacaoOrfaDe(handlers, 'jogador-2');

  assert.equal(limpo, true);
  assert.equal(registro.hidratacoes, 1, 'a sala órfã confirmada hidrata exatamente uma vez');
  assert.equal(registro.saidasAtomics.length, 1);
  assert.deepEqual(registro.associacoesLimpas, ['jogador-2']);
  assert.ok(registro.broadcasts.some((e) => (e as { type?: string }).type === 'MEMBRO_SAIU'));
});

function estadoSalas(handlers: SalasHandlers): EstadoDoLobby['salas'] {
  return (handlers as unknown as { estado: { estado: EstadoDoLobby } }).estado.estado.salas;
}
