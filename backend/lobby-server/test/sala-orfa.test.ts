import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SalasHandlers } from '../src/salas/handlers.ts';

type Deps = ConstructorParameters<typeof SalasHandlers>[0];

function handlersCom(
  overrides: Partial<{
    salaBruta: { partidaId: string | null } | null;
    estadoSala: { encaminhamento?: { partidaId?: string } | null } | null;
    encaminhamento: { serverId: string; partidaId: string } | null;
    chaveExiste: boolean;
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
    async get(): Promise<null> {
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
