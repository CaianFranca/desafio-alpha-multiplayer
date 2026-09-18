// Rota de desistência — causa informativa (issues #295/#429).
//
// Unitário, sem PG/Redis: monta o router com um contexto falso e exercita a
// aceitação/validação da `causa` sem mudar o detach — `desistencia`,
// `expiracao` e `tempo` desvinculam igual ao sem causa; valor estranho é 400.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { criarDesistenciaRouter } from '../src/routes/desistencia.ts';
import { assinarServiceToken } from '../src/jwt.ts';
import type { SalasContexto } from '../src/salas/index.ts';

function montarApp(remocoes: string[]): express.Express {
  const contexto = {
    estado: { abertas: new Map() },
    projecao: { limparAssociacaoJogador: async () => undefined },
    handlers: {
      executarNaFila: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      removerDesistente: async (salaId: string, jogadorId: string) => {
        remocoes.push(`${salaId}:${jogadorId}`);
        return { desvinculado: true };
      },
    },
    repo: {
      obterSalaBruta: async (salaId: string) => ({
        id: salaId,
        status: 'encaminhada',
        partidaId: 'partida-1',
        serverId: 'server-1',
      }),
      obterSalaAtivaDoJogador: async () => 'sala-1',
    },
  } as unknown as SalasContexto;
  const app = express();
  app.use(express.json());
  app.use('/api/desistencia', criarDesistenciaRouter(contexto));
  return app;
}

async function comApp<T>(remocoes: string[], exec: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = montarApp(remocoes);
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const endereco = server.address() as AddressInfo;
  try {
    return await exec(`http://127.0.0.1:${endereco.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err === undefined ? resolve() : reject(err)));
    });
  }
}

async function post(baseUrl: string, corpo: object): Promise<{ status: number; corpo: unknown }> {
  const res = await fetch(`${baseUrl}/api/desistencia`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${assinarServiceToken()}` },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, corpo: await res.json() };
}

const BASE = {
  salaId: 'sala-1',
  partidaId: 'partida-1',
  serverId: 'server-1',
  jogadorId: 'jogador-2',
};

test('causa desistencia, expiracao e tempo desvinculam igual ao sem causa (#295/#429)', async () => {
  const remocoes: string[] = [];
  await comApp(remocoes, async (baseUrl) => {
    for (const causa of [undefined, 'desistencia', 'expiracao', 'tempo'] as const) {
      const r = await post(baseUrl, causa === undefined ? BASE : { ...BASE, causa });
      assert.equal(r.status, 200);
      assert.deepEqual(r.corpo, { desvinculado: true });
    }
  });
  assert.deepEqual(remocoes, ['sala-1:jogador-2', 'sala-1:jogador-2', 'sala-1:jogador-2', 'sala-1:jogador-2']);
});

test('causa estranha é 400 sem desvincular', async () => {
  const remocoes: string[] = [];
  await comApp(remocoes, async (baseUrl) => {
    const r = await post(baseUrl, { ...BASE, causa: 'abandono' });
    assert.equal(r.status, 400);
    assert.deepEqual(r.corpo, { codigo: 'DADOS_INVALIDOS', mensagem: 'Payload inválido.' });
  });
  assert.equal(remocoes.length, 0);
});
