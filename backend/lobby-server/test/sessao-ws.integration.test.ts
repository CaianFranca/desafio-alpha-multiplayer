// Ciclo de vida da Sessão nas conexões WS do lobby (issue #410):
//   - Sessão removida do Redis é encerrada na revalidação periódica (4401);
//   - logout encerra as conexões vigentes na hora (sem esperar o intervalo);
//   - novo login (troca de Sessão) encerra as conexões antigas;
//   - rotação do refresh NÃO encerra: a revalidação migra o `sessaoId` e a
//     conexão segue viva/responsiva.
// Usa PG+Redis reais via `test/helpers/salas-ws.ts`; a revalidação é o
// singleton compartilhado com o WS e as rotas de auth. Estilo: node:test.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { WebSocket } from 'ws';
import {
  cadastroValido,
  comServidor,
  conectarWs,
  configurarHooks,
  enviar,
  esperarClose,
  esperarMensagem,
  extrairCookies,
  postJson,
  redis,
  registrarJogador,
} from './helpers/salas-ws.ts';
import {
  iniciarRevalidacaoDeSessao,
  type HandleRevalidacao,
} from '../src/ws/revalidacao-de-sessao.ts';
import { registroDeConexoes } from '../src/ws/registro-de-conexoes.ts';

configurarHooks();

const handles: HandleRevalidacao[] = [];

/** Inicia a revalidação periódica e guarda o handle para parar no `after`. */
function iniciarRevalidacao(): HandleRevalidacao {
  const handle = iniciarRevalidacaoDeSessao({ intervaloMs: 50, registro: registroDeConexoes });
  handles.push(handle);
  return handle;
}

/**
 * Garante que a conexão foi autenticada e registrada antes de mexer na Sessão:
 * o `open` do WS antecede a validação assíncrona da Sessão no servidor, então
 * o round-trip PING/PONG é a prova de que o registro já contém o socket.
 */
async function aguardarAutenticacao(ws: WebSocket): Promise<void> {
  enviar(ws, { type: 'PING' });
  const raw = await esperarMensagem(ws);
  assert.equal((JSON.parse(raw) as { type: string }).type, 'PONG');
}

after(() => {
  for (const handle of handles) {
    handle.parar();
  }
  handles.length = 0;
});

// --- (a) Sessão removida do Redis -> fecha na revalidação ---

test('Sessão removida do Redis encerra a conexão na revalidação (4401)', async () => {
  await comServidor(async (servidor) => {
    const jogador = await registrarJogador(servidor.baseUrl);
    const ws = await conectarWs(servidor.wsUrl, jogador.cookies);
    await aguardarAutenticacao(ws);

    const sessaoId = await redis.get(`sessao:jogador:${jogador.id}`);
    assert.ok(sessaoId, 'mapping sessao:jogador:<id> ausente');
    await redis.del(`sessao:${sessaoId}`);

    const close = esperarClose(ws);
    const handle = iniciarRevalidacao();
    try {
      const { code, reason } = await close;
      assert.equal(code, 4401, `esperava 4401, recebeu ${code}`);
      assert.equal(reason, 'SESSAO_INVALIDA');
    } finally {
      handle.parar();
    }
  });
});

// --- (b) Logout -> fecha imediato, sem intervalo ---

test('Logout encerra a conexão vigente de imediato (4401 SESSAO_ENCERRADA)', async () => {
  await comServidor(async (servidor) => {
    const jogador = await registrarJogador(servidor.baseUrl);
    const ws = await conectarWs(servidor.wsUrl, jogador.cookies);
    await aguardarAutenticacao(ws);

    // Listener antes do POST para não perder o close.
    const close = esperarClose(ws);
    const res = await postJson(servidor.baseUrl, '/api/auth/logout', {}, jogador.cookies);
    assert.equal(res.status, 204);

    const { code, reason } = await close;
    assert.equal(code, 4401, `esperava 4401, recebeu ${code}`);
    assert.equal(reason, 'SESSAO_ENCERRADA');
  });
});

// --- (c) Novo login (troca de Sessão) -> fecha conexões antigas ---

test('Novo login encerra as conexões antigas do Jogador (4401 SESSAO_SUBSTITUIDA)', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', corpo);
    assert.equal(reg.status, 201);
    const cookies = extrairCookies(reg);

    const ws = await conectarWs(servidor.wsUrl, cookies);
    await aguardarAutenticacao(ws);

    const close = esperarClose(ws);
    const login = await postJson(servidor.baseUrl, '/api/auth/login', {
      email: corpo.email,
      senha: corpo.senha,
    });
    assert.equal(login.status, 200);

    const { code, reason } = await close;
    assert.equal(code, 4401, `esperava 4401, recebeu ${code}`);
    assert.equal(reason, 'SESSAO_SUBSTITUIDA');
  });
});

// --- (d) Rotação do refresh -> conexão permanece viva ---

test('Rotação do refresh preserva a conexão, que segue responsiva a PING/PONG', async () => {
  await comServidor(async (servidor) => {
    const jogador = await registrarJogador(servidor.baseUrl);
    const ws = await conectarWs(servidor.wsUrl, jogador.cookies);
    await aguardarAutenticacao(ws);

    const refresh = await postJson(servidor.baseUrl, '/api/auth/refresh', {}, jogador.cookies);
    assert.equal(refresh.status, 200);

    const handle = iniciarRevalidacao();
    try {
      // Deixa alguns ciclos passarem sobre a Sessão antiga já rotacionada.
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(ws.readyState, WebSocket.OPEN, 'a conexão deveria permanecer aberta');
      await aguardarAutenticacao(ws);
    } finally {
      handle.parar();
    }

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  });
});
