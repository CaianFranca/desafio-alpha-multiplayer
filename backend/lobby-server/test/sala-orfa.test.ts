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

function handlersComOrfa(engine: EstadoDoLobby) {
  const registro = {
    associacoesLimpas: [] as string[],
    saidasAtomics: [] as unknown[][],
    broadcasts: [] as unknown[],
    socketsRemovidos: 0,
  };
  const estadoFalso = {
    estado: engine,
    abertas: new Map([['sala-1', { sala: engine.salas[0], codigo: 'ABC123' }]]),
    apelidoPorJogadorId: new Map([['jogador-1', 'um'], ['jogador-2', 'dois']]),
    substituirEstado(novo: EstadoDoLobby) {
      estadoFalso.estado = novo;
      estadoFalso.abertas = new Map(
        [...novo.salas].map((sala) => [sala.id, { sala, codigo: 'ABC123' }]),
      );
    },
  };
  const redisFalso = {
    async exists(): Promise<number> {
      return 0;
    },
    async ttl(): Promise<number> {
      return 100;
    },
    async get(): Promise<null> {
      return null;
    },
  };
  const deps = {
    repo: {
      async obterSalaBruta() {
        return { partidaId: 'partida-1' };
      },
      async obterEncaminhamento() {
        return null;
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
      removerSocket() {
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
  return { handlers: new SalasHandlers(deps), registro, overridesAssociacao };
}

function limparAssociacaoOrfaDe(handlers: SalasHandlers): (jogadorId: string) => Promise<boolean> {
  return (handlers as unknown as { limparAssociacaoOrfaSeNecessario(jogadorId: string): Promise<boolean> })
    .limparAssociacaoOrfaSeNecessario.bind(handlers);
}

function limparOrfaDeOutraSalaDe(handlers: SalasHandlers): (jogadorId: string, salaIdAlvo: string) => Promise<void> {
  return (handlers as unknown as { limparOrfaDeOutraSalaSeNecessario(jogadorId: string, salaIdAlvo: string): Promise<void> })
    .limparOrfaDeOutraSalaSeNecessario.bind(handlers);
}

test('bypass órfã: membro comum sai via engine, com projeção, broadcast e PG', async () => {
  const { handlers, registro } = handlersComOrfa(estadoEncaminhado());
  const limpo = await limparAssociacaoOrfaDe(handlers)('jogador-2');

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
  const limpo = await limparAssociacaoOrfaDe(handlers)('jogador-1');

  assert.equal(limpo, true);
  assert.equal(registro.saidasAtomics.length, 1);
  assert.deepEqual(registro.saidasAtomics[0], ['sala-1', 'jogador-1', 'saida', false, 'jogador-2']);
});

test('bypass órfã: ramo PG (associação nula) passa pelo engine', async () => {
  const { handlers, registro, overridesAssociacao } = handlersComOrfa(estadoEncaminhado());
  overridesAssociacao.valor = null;
  await limparOrfaDeOutraSalaDe(handlers)('jogador-2', 'sala-alvo');

  // Saída via bypass do engine (não mais `sairMembroAtomico` cru), associação limpa.
  assert.equal(registro.saidasAtomics.length, 1);
  assert.deepEqual(registro.saidasAtomics[0], ['sala-1', 'jogador-2', 'saida', false, undefined]);
  assert.deepEqual(registro.associacoesLimpas, ['jogador-2']);
  assert.ok(registro.broadcasts.some((e) => (e as { type?: string }).type === 'MEMBRO_SAIU'));
});

function estadoSalas(handlers: SalasHandlers): EstadoDoLobby['salas'] {
  return (handlers as unknown as { estado: { estado: EstadoDoLobby } }).estado.estado.salas;
}
