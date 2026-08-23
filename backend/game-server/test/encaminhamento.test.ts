import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
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
import { chaveDaPartida, type PartidaPreparada } from '../src/partidas/partidas.ts';

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

let chavesCriadas: string[] = [];

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

async function aguardarExpiracao(chave: string, timeoutMs: number): Promise<boolean> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if ((await redis.exists(chave)) === 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return (await redis.exists(chave)) === 0;
}

async function naoHaPartidasNoRedis(): Promise<void> {
  const chaves = await redis.keys('game-server:partida:*');
  assert.deepEqual(chaves, []);
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

afterEach(async () => {
  if (chavesCriadas.length > 0) {
    await redis.del(...chavesCriadas);
    chavesCriadas = [];
  }
});

test('POST com roster válido cria partida preparada e responde aceite', async () => {
  const servidor = await subirServidor(600);
  try {
    const oferta = ofertaValida();
    const aceite = await criarPartidaViaPost(servidor.baseUrl, oferta);

    assert.equal(aceite.serverId, SERVER_ID);
    assert.ok(typeof aceite.partidaId === 'string' && aceite.partidaId.length > 0);

    const chave = chaveDaPartida(aceite.partidaId);
    chavesCriadas.push(chave);

    const bruto = await redis.get(chave);
    assert.ok(bruto !== null, 'chave da partida deve existir no Redis');

    const partida = JSON.parse(bruto as string) as PartidaPreparada;
    assert.equal(partida.partidaId, aceite.partidaId);
    assert.equal(partida.serverId, SERVER_ID);
    assert.equal(partida.salaId, oferta.salaId);
    assert.equal(partida.codigoDeSala, oferta.codigoDeSala);
    assert.equal(partida.estado, 'preparada');
    assert.deepEqual(partida.roster, oferta.roster);
    assert.ok(typeof partida.criadaEm === 'string' && partida.criadaEm.length > 0);

    const ttl = await redis.ttl(chave);
    assert.ok(ttl > 0 && ttl <= 600, `TTL deveria estar entre 1 e 600, foi ${ttl}`);
  } finally {
    await servidor.fechar();
  }
});

test('POST com roster de 3 membros responde ROSTER_INVALIDO sem criar chave', async () => {
  const servidor = await subirServidor(600);
  try {
    const resposta = await postOferta(servidor.baseUrl, ofertaValida({ roster: [membro(1), membro(2), membro(3)] }));
    assert.equal(resposta.status, 400);
    const recusa = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(recusa.codigo, 'ROSTER_INVALIDO');
    assert.ok(typeof recusa.motivo === 'string' && recusa.motivo.length > 0);
    await naoHaPartidasNoRedis();
  } finally {
    await servidor.fechar();
  }
});

test('POST com ids de membro duplicados responde ROSTER_INVALIDO sem criar chave', async () => {
  const servidor = await subirServidor(600);
  try {
    const oferta = ofertaValida({
      roster: [membro(1), membro(2, { id: 'membro-1' }), membro(3), membro(4)],
    });
    const resposta = await postOferta(servidor.baseUrl, oferta);
    assert.equal(resposta.status, 400);
    const recusa = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(recusa.codigo, 'ROSTER_INVALIDO');
    await naoHaPartidasNoRedis();
  } finally {
    await servidor.fechar();
  }
});

test('POST com jogadorIds duplicados responde ROSTER_INVALIDO sem criar chave', async () => {
  const servidor = await subirServidor(600);
  try {
    const oferta = ofertaValida({
      roster: [membro(1), membro(2, { jogadorId: 'jogador-1' }), membro(3), membro(4)],
    });
    const resposta = await postOferta(servidor.baseUrl, oferta);
    assert.equal(resposta.status, 400);
    const recusa = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(recusa.codigo, 'ROSTER_INVALIDO');
    await naoHaPartidasNoRedis();
  } finally {
    await servidor.fechar();
  }
});

test('POST com membro sem campo essencial responde ROSTER_INVALIDO sem criar chave', async () => {
  const servidor = await subirServidor(600);
  try {
    const membroIncompleto = { ...membro(2) } as Partial<MembroDaSala>;
    delete membroIncompleto.apelido;
    const oferta = ofertaValida({ roster: [membro(1), membroIncompleto as MembroDaSala, membro(3), membro(4)] });
    const resposta = await postOferta(servidor.baseUrl, oferta);
    assert.equal(resposta.status, 400);
    const recusa = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(recusa.codigo, 'ROSTER_INVALIDO');
    await naoHaPartidasNoRedis();
  } finally {
    await servidor.fechar();
  }
});

test('POST com salaId vazio responde ROSTER_INVALIDO sem criar chave', async () => {
  const servidor = await subirServidor(600);
  try {
    const resposta = await postOferta(servidor.baseUrl, ofertaValida({ salaId: '' }));
    assert.equal(resposta.status, 400);
    const recusa = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(recusa.codigo, 'ROSTER_INVALIDO');
    await naoHaPartidasNoRedis();
  } finally {
    await servidor.fechar();
  }
});

test('POST com codigoDeSala vazio responde ROSTER_INVALIDO sem criar chave', async () => {
  const servidor = await subirServidor(600);
  try {
    const resposta = await postOferta(servidor.baseUrl, ofertaValida({ codigoDeSala: '' }));
    assert.equal(resposta.status, 400);
    const recusa = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(recusa.codigo, 'ROSTER_INVALIDO');
    await naoHaPartidasNoRedis();
  } finally {
    await servidor.fechar();
  }
});

test('POST com corpo não-objeto responde ROSTER_INVALIDO sem criar chave', async () => {
  const servidor = await subirServidor(600);
  try {
    const respostaArray = await postOferta(servidor.baseUrl, JSON.stringify(['a', 'b', 'c', 'd']));
    assert.equal(respostaArray.status, 400);
    const recusaArray = (await respostaArray.json()) as RecusaDoEncaminhamento;
    assert.equal(recusaArray.codigo, 'ROSTER_INVALIDO');

    const respostaSemContentType = await fetch(`${servidor.baseUrl}/api/encaminhamento`, {
      method: 'POST',
      body: 'não sou json',
    });
    assert.equal(respostaSemContentType.status, 400);
    const recusaSemContentType = (await respostaSemContentType.json()) as RecusaDoEncaminhamento;
    assert.equal(recusaSemContentType.codigo, 'ROSTER_INVALIDO');

    await naoHaPartidasNoRedis();
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
    await naoHaPartidasNoRedis();
  } finally {
    await servidor.fechar();
  }
});

test('DELETE cancela partida preparada e segundo DELETE responde PARTIDA_NAO_ENCONTRADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaValida());
    const chave = chaveDaPartida(aceite.partidaId);
    chavesCriadas.push(chave);

    const cancelamento = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(cancelamento.status, 204);
    assert.equal(await redis.exists(chave), 0, 'chave da partida deve ser removida ao cancelar');

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
    const chave = chaveDaPartida(aceite.partidaId);
    chavesCriadas.push(chave);

    const expirou = await aguardarExpiracao(chave, 5000);
    assert.ok(expirou, 'chave da partida deveria expirar após o TTL sem conexão');

    const resposta = await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(resposta.status, 404);
    const corpo = (await resposta.json()) as RecusaDoEncaminhamento;
    assert.equal(corpo.codigo, 'PARTIDA_NAO_ENCONTRADA');
  } finally {
    await servidor.fechar();
  }
});
