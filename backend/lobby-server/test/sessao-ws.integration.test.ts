// Ciclo de vida da Sessão nas conexões WS do lobby (issue #410):
//   - Sessão removida do Redis é encerrada na revalidação periódica (4401);
//   - logout encerra as conexões vigentes na hora (sem esperar o intervalo);
//   - novo login (troca de Sessão) encerra as conexões antigas;
//   - rotação do refresh NÃO encerra: a revalidação migra o `sessaoId` e a
//     conexão segue viva/responsiva.
// Usa PG+Redis reais via `test/helpers/salas-ws.ts`; a revalidação é o
// singleton compartilhado com o WS e as rotas de auth. Estilo: node:test.

import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { WebSocket } from 'ws';
import {
  apelidoUnico,
  cadastroValido,
  comServidor,
  conectarWs,
  configurarHooks,
  enviar,
  esperarClose,
  esperarMensagem,
  extrairCookies,
  pool,
  postJson,
  redis,
  registrarJogador,
  sufixo,
} from './helpers/salas-ws.ts';
import {
  iniciarRevalidacaoDeSessao,
  type HandleRevalidacao,
} from '../src/ws/revalidacao-de-sessao.ts';
import {
  registroDeConexoes,
  type DadosDeConexaoWs,
  type RegistroDeConexoes,
} from '../src/ws/registro-de-conexoes.ts';
import { criarSessao, ttlMarcadorRotacaoSegundos } from '../src/sessoes.ts';
import { assinarAccess } from '../src/jwt.ts';

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

// O `registroDeConexoes` é um singleton compartilhado entre arquivos/roteadores
// de teste: sem reset explícito, sockets de um caso permanecem indexados e a
// revalidação do caso seguinte os visitaria. Como o `close` do socket nem
// sempre chega antes do fim do teste, limpamos os índices no `afterEach`.
afterEach(() => {
  for (const { socket } of registroDeConexoes.listar()) {
    registroDeConexoes.desregistrar(socket);
  }
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

// --- (e) TTL do marcador de rotação ---

test('TTL do marcador de rotação cobre 2 intervalos + margem quando maior que o access TTL', () => {
  // Intervalo de revalidação (60s) muito maior que o TTL de access (10s): sem
  // a fórmula, o marcador expiraria antes da varredura alcançar a Sessão
  // antiga. 2 ticks + 60s de margem = 180s.
  assert.equal(ttlMarcadorRotacaoSegundos(10, 60000), 180);
  assert.ok(
    ttlMarcadorRotacaoSegundos(10, 60000) > 10,
    'o marcador deveria sobreviver além de sessionAccessTtlSeconds',
  );
  // Access TTL dominante: preserva o valor de access (900s).
  assert.equal(ttlMarcadorRotacaoSegundos(900, 60000), 900);
  // Intervalo grande o bastante para superar o access TTL: 500s * 2 + 60 = 1060s.
  assert.equal(ttlMarcadorRotacaoSegundos(900, 500000), 1060);
});

// --- (f) Guarda anti-sobreposição ---

test('Ticks lentos não sobrepõem execuções da revalidação', async () => {
  const dados: DadosDeConexaoWs = {
    jogadorId: 'jogador-lento',
    sessaoId: 'sessao-lenta',
    email: 'lento@teste.local',
    apelido: 'Lento',
  };
  let varreduras = 0;
  let ciclosEmVoo = 0;
  let maxCiclosEmVoo = 0;
  const registroFake = {
    listar: () => [{ socket: {} as WebSocket, dados }],
    fecharConexao: () => undefined,
    migrarSessao: () => undefined,
  } as unknown as RegistroDeConexoes;

  const handle = iniciarRevalidacaoDeSessao({
    intervaloMs: 10,
    registro: registroFake,
    // Cada varredura "demora" 60ms — 6x o intervalo; sem a guarda vários
    // ciclos rodariam em paralelo.
    obterSessao: async () => {
      varreduras += 1;
      ciclosEmVoo += 1;
      maxCiclosEmVoo = Math.max(maxCiclosEmVoo, ciclosEmVoo);
      await new Promise((resolve) => setTimeout(resolve, 60));
      ciclosEmVoo -= 1;
      return { jogadorId: dados.jogadorId };
    },
    obterSucessorDeSessao: async () => null,
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    handle.parar();
  }

  assert.ok(varreduras >= 1, 'ao menos uma varredura deveria ter rodado');
  assert.equal(maxCiclosEmVoo, 1, 'ticks concorrentes não deveriam se sobrepor');
});

// --- (g) Isenção de bot pela flag `isBot` ---

test('Conexão de bot (@bot.teste) é isenta da revalidação de Sessão', async () => {
  await comServidor(async (servidor) => {
    const inserido = await pool.query<{ id: string; apelido: string; email: string }>(
      `INSERT INTO usuarios (apelido, email, senha, bot)
       VALUES ($1, $2, $3, true)
       RETURNING id, apelido, email`,
      [apelidoUnico('bot'), `bot-${sufixo()}@bot.teste`, 'bot_nopassword'],
    );
    const bot = inserido.rows[0]!;
    const { sessaoId } = await criarSessao(bot.id);
    const accessToken = assinarAccess(bot, sessaoId);

    const ws = await conectarWs(servidor.wsUrl, { access_token: accessToken });
    await aguardarAutenticacao(ws);

    // Sessão removida: um não-bot seria encerrado; o bot deve seguir vivo.
    await redis.del(`sessao:${sessaoId}`);

    const handle = iniciarRevalidacao();
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(ws.readyState, WebSocket.OPEN, 'conexão de bot não deveria fechar');
    } finally {
      handle.parar();
    }

    ws.close();
    await esperarClose(ws).catch(() => undefined);
  });
});
