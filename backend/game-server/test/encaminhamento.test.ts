import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import { getConfig } from '@flicker/config';
import type {
  AceiteDoEncaminhamento,
  MembroDaSala,
  OfertaDeEncaminhamento,
  RecusaDoEncaminhamento,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';

const SERVER_ID = 'game-server-teste';

function criarClienteRedis(): Redis {
  const { redis } = getConfig();
  return new Redis({
    host: redis.host,
    port: redis.port,
    password: redis.password,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
}

const redis = criarClienteRedis();

interface ServidorEfemero {
  baseUrl: string;
  fechar(): Promise<void>;
}

function restaurarEnv(nome: string, anterior: string | undefined): void {
  if (anterior === undefined) {
    delete process.env[nome];
  } else {
    process.env[nome] = anterior;
  }
}

async function subirServidor(ttlSegundos: number): Promise<ServidorEfemero> {
  const ttlAnterior = process.env.PARTIDA_PREPARADA_TTL_SEGUNDOS;
  process.env.PARTIDA_PREPARADA_TTL_SEGUNDOS = String(ttlSegundos);
  try {
    const app = createApp(redis, SERVER_ID);
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
  } finally {
    restaurarEnv('PARTIDA_PREPARADA_TTL_SEGUNDOS', ttlAnterior);
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
  const servidor = await subirServidor(600);
  try {
    const oferta = ofertaValida();
    const aceite = await criarPartidaViaPost(servidor.baseUrl, oferta);

    assert.equal(aceite.serverId, SERVER_ID);
    assert.ok(typeof aceite.partidaId === 'string' && aceite.partidaId.length > 0);

    const del = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(del.status, 204);
    const secondDel = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(secondDel.status, 404);
  } finally {
    await servidor.fechar();
  }
});

test('POST com roster de 3 membros responde ROSTER_INVALIDO', async () => {
  const servidor = await subirServidor(600);
  try {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(2), membro(3)] }));
  } finally {
    await servidor.fechar();
  }
});

test('POST com ids de membro duplicados responde ROSTER_INVALIDO', async () => {
  const servidor = await subirServidor(600);
  try {
    const oferta = ofertaValida({
      roster: [membro(1), membro(2, { id: 'membro-1' }), membro(3), membro(4)],
    });
    await postOfertaInvalida(servidor.baseUrl, oferta);
  } finally {
    await servidor.fechar();
  }
});

test('POST com jogadorIds duplicados responde ROSTER_INVALIDO', async () => {
  const servidor = await subirServidor(600);
  try {
    const oferta = ofertaValida({
      roster: [membro(1), membro(2, { jogadorId: 'jogador-1' }), membro(3), membro(4)],
    });
    await postOfertaInvalida(servidor.baseUrl, oferta);
  } finally {
    await servidor.fechar();
  }
});

test('POST com membro sem campo essencial responde ROSTER_INVALIDO', async () => {
  const servidor = await subirServidor(600);
  try {
    const membroIncompleto = { ...membro(2) } as Partial<MembroDaSala>;
    delete membroIncompleto.apelido;
    const oferta = ofertaValida({ roster: [membro(1), membroIncompleto as MembroDaSala, membro(3), membro(4)] });
    await postOfertaInvalida(servidor.baseUrl, oferta);
  } finally {
    await servidor.fechar();
  }
});

test('POST com salaId vazio responde ROSTER_INVALIDO', async () => {
  const servidor = await subirServidor(600);
  try {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ salaId: '' }));
  } finally {
    await servidor.fechar();
  }
});

test('POST com codigoDeSala vazio responde ROSTER_INVALIDO', async () => {
  const servidor = await subirServidor(600);
  try {
    await postOfertaInvalida(servidor.baseUrl, ofertaValida({ codigoDeSala: '' }));
  } finally {
    await servidor.fechar();
  }
});

test('POST com corpo não-objeto responde ROSTER_INVALIDO', async () => {
  const servidor = await subirServidor(600);
  try {
    await postOfertaInvalida(servidor.baseUrl, JSON.stringify(['a', 'b', 'c', 'd']));

    const resposta = await fetch(`${servidor.baseUrl}/api/encaminhamento`, {
      method: 'POST',
      body: 'não sou json',
    });
    assert.equal(resposta.status, 400);
    const recusa = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(recusa.codigo, 'ROSTER_INVALIDO');
  } finally {
    await servidor.fechar();
  }
});

test('POST com JSON malformado responde DADOS_INVALIDOS', async () => {
  const servidor = await subirServidor(600);
  try {
    const resposta = await postOferta(servidor.baseUrl, '{"salaId":"sala-1",');
    assert.equal(resposta.status, 400);
    const corpo = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(corpo.codigo, 'DADOS_INVALIDOS');
  } finally {
    await servidor.fechar();
  }
});

test('DELETE cancela partida preparada e segundo DELETE responde PARTIDA_NAO_ENCONTRADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaValida());

    const cancelamento = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(cancelamento.status, 204);

    const segundoCancelamento = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(segundoCancelamento.status, 404);
    const corpo = (await segundoCancelamento.json()) as RecusaDoEncaminhamento;
    assert.equal(corpo.codigo, 'PARTIDA_NAO_ENCONTRADA');
  } finally {
    await servidor.fechar();
  }
});

test('DELETE de partida inexistente responde PARTIDA_NAO_ENCONTRADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const resposta = await deletePartida(servidor.baseUrl, 'partida-que-nao-existe');
    assert.equal(resposta.status, 404);
    const corpo = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(corpo.codigo, 'PARTIDA_NAO_ENCONTRADA');
  } finally {
    await servidor.fechar();
  }
});

test('partida preparada expira pelo TTL e DELETE posterior responde PARTIDA_NAO_ENCONTRADA', async () => {
  const servidor = await subirServidor(1);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaValida());

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const resposta = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(resposta.status, 404);
    const corpo = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(corpo.codigo, 'PARTIDA_NAO_ENCONTRADA');
  } finally {
    await servidor.fechar();
  }
});
