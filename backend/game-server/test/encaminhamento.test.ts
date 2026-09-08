import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { criarClienteRedis } from '@flicker/config';
import type {
  AceiteDoEncaminhamento,
  MembroDaSala,
  OfertaDeEncaminhamento,
  RecusaDoEncaminhamento,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';

const SERVER_ID = 'game-server-teste';
const JWT_SECRET = 'test_secret_para_admissao';

const redis = criarClienteRedis();

interface ServidorEfemero {
  baseUrl: string;
  fechar(): Promise<void>;
}

async function subirServidor(ttlSegundos: number): Promise<ServidorEfemero> {
  const app = createApp({ redis, serverId: SERVER_ID, jwtSecret: JWT_SECRET, partidaPreparadaTtlSegundos: ttlSegundos });
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const endereco = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${endereco.port}`,
    fechar: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      }),
  };
}

async function comServidor<T>(
  ttlSegundos: number,
  executar: (servidor: ServidorEfemero) => Promise<T>,
): Promise<T> {
  const servidor = await subirServidor(ttlSegundos);
  try {
    return await executar(servidor);
  } finally {
    await servidor.fechar();
  }
}

function membro(n: number, sobrescreve: Partial<MembroDaSala> = {}): MembroDaSala {
  return {
    id: `membro-${n}`,
    jogadorId: `jogador-${n}`,
    apelido: `Jogador ${n}`,
    ordemDeEntrada: n,
    presenca: 'conectado',
    prontidao: true,
    ...sobrescreve,
  };
}

interface SobrescritaDaOferta {
  salaId?: string;
  codigoDeSala?: string;
  roster?: readonly MembroDaSala[];
}

function ofertaValida(sobrescreve: SobrescritaDaOferta = {}): OfertaDeEncaminhamento {
  const { roster, ...resto } = sobrescreve;
  return {
    salaId: 'sala-1',
    codigoDeSala: 'ABC123',
    ...resto,
    roster: (roster ?? [membro(1), membro(2), membro(3), membro(4)]) as OfertaDeEncaminhamento['roster'],
  };
}

function postOferta(baseUrl: string, corpo: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/encaminhamento`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

function deletePartida(baseUrl: string, partidaId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/encaminhamento/${partidaId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ partidaId, motivo: 'composição da sala mudou antes da conexão' }),
  });
}

function deletePartidaSemCorpo(baseUrl: string, partidaId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/encaminhamento/${partidaId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
  });
}

function deletePartidaComCorpo(baseUrl: string, partidaId: string, corpo: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/encaminhamento/${partidaId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

async function assertCancelamentoInvalido(resposta: Response): Promise<void> {
  assert.equal(resposta.status, 400);
  const corpo = (await resposta.json()) as RecusaDoEncaminhamento;
  assert.equal(corpo.codigo, 'DADOS_INVALIDOS');
  assert.ok(typeof corpo.motivo === 'string' && corpo.motivo.length > 0);
}

async function criarPartidaViaPost(baseUrl: string, oferta: OfertaDeEncaminhamento): Promise<AceiteDoEncaminhamento> {
  const resposta = await postOferta(baseUrl, oferta);
  assert.equal(resposta.status, 200);
  return (await resposta.json()) as AceiteDoEncaminhamento;
}

async function postOfertaInvalida(baseUrl: string, corpo: unknown): Promise<RecusaDoEncaminhamento> {
  const resposta = await postOferta(baseUrl, corpo);
  assert.equal(resposta.status, 400);
  const recusa = (await resposta.json()) as RecusaDoEncaminhamento;
  assert.equal(recusa.codigo, 'ROSTER_INVALIDO');
  assert.ok(typeof recusa.motivo === 'string' && recusa.motivo.length > 0);
  return recusa;
}

before(async () => {
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis indisponível para os testes de integração: ${(error as Error).message}`);
  }
});

after(async () => {
  if (redis.status === 'ready') {
    await redis.quit();
  } else {
    redis.disconnect();
  }
});

test('POST com roster válido cria partida preparada e responde aceite', async () => {
  await comServidor(600, async (servidor) => {
    const oferta = ofertaValida();
    const aceite = await criarPartidaViaPost(servidor.baseUrl, oferta);

    assert.equal(aceite.serverId, SERVER_ID);
    assert.ok(typeof aceite.partidaId === 'string' && aceite.partidaId.length > 0);

    const del = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(del.status, 204);
    const secondDel = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(secondDel.status, 404);
  });
});

test('POST com roster de 3 membros cria partida preparada', async () => {
  await comServidor(600, async (servidor) => {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(2), membro(3)] }));
    assert.equal(aceite.serverId, SERVER_ID);
    assert.ok(typeof aceite.partidaId === 'string' && aceite.partidaId.length > 0);
    const del = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(del.status, 204);
  });
});

test('POST com roster de 2 membros cria partida preparada', async () => {
  await comServidor(600, async (servidor) => {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(2)] }));
    assert.equal(aceite.serverId, SERVER_ID);
    assert.ok(typeof aceite.partidaId === 'string' && aceite.partidaId.length > 0);
    const del = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(del.status, 204);
  });
});

test('POST com roster de 1 membro responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ roster: [membro(1)] }));
  });
});

test('POST com roster de 5 membros responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(2), membro(3), membro(4), membro(5)] }));
  });
});

test('POST com roster vazio responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ roster: [] }));
  });
});

test('POST com ids de membro duplicados responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    const oferta = ofertaValida({
      roster: [membro(1), membro(2, { id: 'membro-1' }), membro(3), membro(4)],
    });
    await postOfertaInvalida(servidor.baseUrl, oferta);
  });
});

test('POST com jogadorIds duplicados responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    const oferta = ofertaValida({
      roster: [membro(1), membro(2, { jogadorId: 'jogador-1' }), membro(3), membro(4)],
    });
    await postOfertaInvalida(servidor.baseUrl, oferta);
  });
});

test('POST com membro em_reconexao responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(2, { presenca: 'em_reconexao' }), membro(3)] }));
  });
});

test('POST com membro não pronto responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(2, { prontidao: false }), membro(3)] }));
  });
});

test('POST com ordemDeEntrada duplicada responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(2, { ordemDeEntrada: 1 }), membro(3)] }));
  });
});

test('POST com ordemDeEntrada fora do intervalo responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(2, { ordemDeEntrada: 0 }), membro(3)] }));
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(2, { ordemDeEntrada: -1 }), membro(3)] }));
  });
});

test('POST com ordemDeEntrada alta monotônica aceita roster pós-churn', async () => {
  await comServidor(600, async (servidor) => {
    // lobby gera ordens monotônicas: após churn, ordem 5 é válida
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(3, { ordemDeEntrada: 3 }), membro(4, { ordemDeEntrada: 5 })] }));
    assert.equal(aceite.serverId, SERVER_ID);
    const del = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(del.status, 204);
  });
});

test('POST com membro sem campo essencial responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    const membroIncompleto = { ...membro(2) } as Partial<MembroDaSala>;
    delete membroIncompleto.apelido;
    const oferta = ofertaValida({ roster: [membro(1), membroIncompleto as MembroDaSala, membro(3), membro(4)] });
    await postOfertaInvalida(servidor.baseUrl, oferta);
  });
});

test('POST com salaId vazio responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ salaId: '' }));
  });
});

test('POST com codigoDeSala vazio responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ codigoDeSala: '' }));
  });
});

test('POST com salaId só espaços e codigo só espaços responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ salaId: '   ' }));
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ codigoDeSala: '   ' }));
  });
});

test('POST com ordemDeEntrada excedendo teto responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(2, { ordemDeEntrada: 10001 }), membro(3)] }));
  });
});

test('POST com corpo não-objeto responde ROSTER_INVALIDO', async () => {
  await comServidor(600, async (servidor) => {
    await postOfertaInvalida(servidor.baseUrl, JSON.stringify(['a', 'b', 'c', 'd']));

    const resposta = await fetch(`${servidor.baseUrl}/api/encaminhamento`, {
      method: 'POST',
      body: 'não sou json',
    });
    assert.equal(resposta.status, 400);
    const recusa = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(recusa.codigo, 'ROSTER_INVALIDO');
  });
});

test('POST com JSON malformado responde DADOS_INVALIDOS', async () => {
  await comServidor(600, async (servidor) => {
    const resposta = await postOferta(servidor.baseUrl, '{"salaId":"sala-1",');
    assert.equal(resposta.status, 400);
    const corpo = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(corpo.codigo, 'DADOS_INVALIDOS');
  });
});

test('DELETE cancela partida preparada e segundo DELETE responde PARTIDA_NAO_ENCONTRADA', async () => {
  await comServidor(600, async (servidor) => {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaValida());

    const cancelamento = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(cancelamento.status, 204);

    const segundoCancelamento = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(segundoCancelamento.status, 404);
    const corpo = (await segundoCancelamento.json()) as RecusaDoEncaminhamento;
    assert.equal(corpo.codigo, 'PARTIDA_NAO_ENCONTRADA');
  });
});

test('DELETE de partida inexistente responde PARTIDA_NAO_ENCONTRADA', async () => {
  await comServidor(600, async (servidor) => {
    const resposta = await deletePartida(servidor.baseUrl, 'partida-que-nao-existe');
    assert.equal(resposta.status, 404);
    const corpo = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(corpo.codigo, 'PARTIDA_NAO_ENCONTRADA');
  });
});

test('DELETE sem corpo responde DADOS_INVALIDOS e não remove a partida', async () => {
  await comServidor(600, async (servidor) => {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaValida());

    await assertCancelamentoInvalido(await deletePartidaSemCorpo(servidor.baseUrl, aceite.partidaId));
    assert.equal((await deletePartida(servidor.baseUrl, aceite.partidaId)).status, 204);
  });
});

test('DELETE com motivo vazio responde DADOS_INVALIDOS e não remove a partida', async () => {
  await comServidor(600, async (servidor) => {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaValida());

    await assertCancelamentoInvalido(await deletePartidaComCorpo(servidor.baseUrl, aceite.partidaId, {
      partidaId: aceite.partidaId,
      motivo: '   ',
    }));
    assert.equal((await deletePartida(servidor.baseUrl, aceite.partidaId)).status, 204);
  });
});

test('DELETE com ids divergentes responde DADOS_INVALIDOS e não remove a partida', async () => {
  await comServidor(600, async (servidor) => {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaValida());

    await assertCancelamentoInvalido(await deletePartidaComCorpo(servidor.baseUrl, aceite.partidaId, {
      partidaId: 'outra-partida',
      motivo: 'composição da sala mudou antes da conexão',
    }));
    assert.equal((await deletePartida(servidor.baseUrl, aceite.partidaId)).status, 204);
  });
});

test('partida preparada expira pelo TTL e DELETE posterior responde PARTIDA_NAO_ENCONTRADA', async () => {
  await comServidor(1, async (servidor) => {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaValida());

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const resposta = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(resposta.status, 404);
    const corpo = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(corpo.codigo, 'PARTIDA_NAO_ENCONTRADA');
  });
});
