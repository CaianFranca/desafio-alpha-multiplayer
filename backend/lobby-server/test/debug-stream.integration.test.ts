// Teste de integração handlers→debug do lobby-server (issue #340, "Modo
// Desenvolvedor"). Exercita o `criarContextoDasSalas` REAL (PG/Redis) e
// garante que o `DebugStreamDasSalas` é injetado no `SalasHandlers`: o
// `espelhar()` de um handler entrega o `DEBUG_LOG` ao socket que ativou o
// stream. Antes do fix, o contexto montava os handlers SEM `debug` — toda
// linha de debug virava no-op no lobby real e este assert falhava.
//
// O helper `test/helpers/salas-ws.ts` registra o arquivo no teardown único
// (`registrarArquivoDeTeste`) ao ser importado e traz os hooks de
// Postgres+Redis (`configurarHooks`).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { criarContextoDasSalas } from '../src/salas/index.ts';
import { criarSessao } from '../src/sessoes.ts';
import type { AuthenticatedWebSocket } from '../src/ws/ws.ts';
import { configurarHooks, pool } from './helpers/salas-ws.ts';

configurarHooks();

interface EventoRecebido {
  type: string;
  mensagem?: string;
}

function socketFalso(jogadorId: string, apelido: string, sessaoId: string): AuthenticatedWebSocket {
  const falso = {
    readyState: WebSocket.OPEN,
    data: { jogadorId, apelido, sessaoId },
  } as unknown as AuthenticatedWebSocket;
  (falso as unknown as { OPEN: number }).OPEN = WebSocket.OPEN;
  (falso as unknown as { recebidos: EventoRecebido[] }).recebidos = [];
  (falso as unknown as { send: (payload: string) => void }).send = (payload: string) => {
    (falso as unknown as { recebidos: EventoRecebido[] }).recebidos.push(
      JSON.parse(payload) as EventoRecebido,
    );
  };
  return falso;
}

function recebidos(socket: AuthenticatedWebSocket): EventoRecebido[] {
  return (socket as unknown as { recebidos: EventoRecebido[] }).recebidos;
}

/** Aguarda uma condição assíncrona (a re-resolução de escopo do `emitir` usa Redis). */
async function esperarAte(condicao: () => boolean, timeoutMs = 2000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('handlers espelham "sala criada" ao cliente de debug ativo', async () => {
  const contexto = criarContextoDasSalas();
  await contexto.estado.carregar(contexto.repo, contexto.projecao);

  // O FK de membros exige o usuário no PG; inserimos direto (mesmo padrão de
  // retorno.integration.test.ts) para exercitar o handler sem passar pelo HTTP.
  const jogadorId = randomUUID();
  await pool.query(
    `INSERT INTO usuarios (id, apelido, email, senha) VALUES ($1, $2, $3, $4)`,
    [jogadorId, 'dev-debug', `dev-debug-${jogadorId}@ex.local`, 'hash'],
  );
  // CRIAR_SALA exige Sessão revalidável: cria uma real no Redis (mesma store
  // de produção) para o default `revalidarSessao` do contexto aprovar.
  const { sessaoId } = await criarSessao(jogadorId);

  const socket = socketFalso(jogadorId, 'dev-debug', sessaoId);
  await contexto.debug?.receberComando(socket, 'ATIVAR_DEBUG');
  await contexto.handlers.aplicarMensagem(socket, { type: 'CRIAR_SALA' });

  await esperarAte(() => recebidos(socket).some((e) => e.mensagem?.includes('sala criada')));

  const logs = recebidos(socket).filter((e) => e.type === 'DEBUG_LOG');
  assert.ok(
    logs.some((e) => e.mensagem?.includes('sala criada')),
    `esperava DEBUG_LOG "sala criada"; recebidos: ${JSON.stringify(recebidos(socket))}`,
  );
});
