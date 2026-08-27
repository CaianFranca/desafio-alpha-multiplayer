// Testes de integração das Salas no lobby-server (issue #36, ST-06).
// Cobre o contrato WS de Sala (CRIAR_SALA, ENTRAR_NA_SALA, SAIR_DA_SALA),
// a persistência em PG (write-model, ADR-0002) e a projeção quente em
// Redis. Estilo: node:test + assert/strict; espelha
// `ws-auth.integration.test.ts`.
//
// Pré-condições: Postgres e Redis acessíveis via `getConfig()` (profile
// `backend` do compose). TRUNCATE+FLUSHDB entre testes, com cuidado
// para `salas_historico` que é referenciada por FKs (DELETE em vez de
// TRUNCATE para não cascatear em tabelas não pertinentes).
//
// Os cenários cobrem o quadro do plano. Casos fora do escopo (comandos
// `ALTERNAR_PRONTIDAO`, `ENVIAR_MENSAGEM_DE_CHAT`, etc.) são respondidos
// com `ERRO_DA_SALA { codigo: 'DADOS_INVALIDOS' }` — não há teste
// dedicado porque o handler é uma só ramificação `default` do switch.
//
// O harness (servidor efêmero, registro de jogador, conexão WS, esperas e
// hooks de infra) vive em `./helpers/salas-ws.ts` para ser reutilizado por
// `chat.integration.test.ts` (issue #34) sem duplicação.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  AnfitriaoSubstituidoEvento,
  CodigoDeErroDaSala,
  ErroDaSalaEvento,
  MembroDaSala,
  Sala,
  SalaAtualizadaEvento,
  SalaEventoDoServidor,
} from '@flicker/shared';
import {
  comServidor,
  subirServidor,
  registrarJogador,
  conectarWs,
  enviar,
  esperarMensagem,
  esperarSalaAtualizada,
  esperarErro,
  coletarEventos,
  esperarSilencio,
  esperarClose,
  postJson,
  configurarHooks,
  membroDaSala,
  RepositorioComFalhaNaSaida,
  RepositorioComCriacaoPausada,
  chaveJogadorSala,
  chaveSalaCodigo,
  redisClient,
  pool,
  type Cookies,
} from './helpers/salas-ws.ts';

configurarHooks();

// --- 1. CRIAR_SALA por jogador A → SALA_ATUALIZADA com A em ordem 1 ---

test('CRIAR_SALA: A cria sala, recebe SALA_ATUALIZADA com A em ordem 1 e anfitrião', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const evento = await esperarSalaAtualizada(wsA);

    assert.match(evento.sala.codigoDeSala, /^[A-Z0-9]{6}$/);
    assert.equal(evento.sala.estado, 'aberta');
    assert.equal(evento.sala.membros.length, 1);
    const membroA = membroDaSala(evento.sala, a.id);
    assert.equal(membroA.ordemDeEntrada, 1);
    assert.equal(membroA.jogadorId, a.id);
    assert.equal(evento.sala.anfitriaoId, membroA.id);

    wsA.close();
    await esperarClose(wsA).catch(() => undefined);
  });
});

test('CRIAR_SALA revalida a Sessão no Redis antes de criar vínculo', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);

    const logout = await postJson(servidor.baseUrl, '/api/auth/logout', {}, a.cookies);
    assert.equal(logout.status, 204);

    const close = esperarClose(wsA);
    enviar(wsA, { type: 'CRIAR_SALA' });
    assert.equal((await close).code, 4401);
  });
});

test('CRIAR_SALA repete Código de Sala após colisão e monta Convite público', async () => {
  const codigos = ['AAAAAA', 'AAAAAA', 'BBBBBB'];
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const salaA = await esperarSalaAtualizada(wsA);
    assert.equal(salaA.sala.codigoDeSala, 'AAAAAA');

    enviar(wsB, { type: 'CRIAR_SALA' });
    const salaB = await esperarSalaAtualizada(wsB);
    assert.equal(salaB.sala.codigoDeSala, 'BBBBBB');
    assert.equal(salaB.sala.convite.link, 'https://lobby.exemplo.test/convite/BBBBBB');

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  }, {
    gerarCodigo: () => codigos.shift() ?? 'CCCCCC',
    linkBase: 'https://lobby.exemplo.test/convite',
  });
});

test('CRIAR_SALA revalida a Sessão depois de aguardar uma mutação anterior', async () => {
  const repo = new RepositorioComCriacaoPausada();
  let jogadorRevogado: string | null = null;
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    await repo.primeiraCriacaoIniciada;

    enviar(wsB, { type: 'CRIAR_SALA' });
    jogadorRevogado = b.id;
    const closeB = esperarClose(wsB);
    repo.liberarCriacao();

    await esperarSalaAtualizada(wsA);
    assert.equal((await closeB).code, 4401);

    wsA.close();
    await esperarClose(wsA).catch(() => undefined);
  }, {
    repo,
    revalidarSessao: async (_sessaoId, jogadorId) => jogadorId !== jogadorRevogado,
  });
});

// --- 2. A entra com próprio codigoDeSala → idempotente ---

test('CRIAR_SALA + ENTRAR_NA_SALA pelo próprio A é idempotente', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    // O engine trata ENTRAR_NA_SALA por jogador já ativo como no-op
    // (sucesso sem eventos). Sem broadcast no socket de A.
    enviar(wsA, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarSilencio(wsA);

    wsA.close();
    await esperarClose(wsA).catch(() => undefined);
  });
});

// --- 3. B entra com codigoDeSala → MEMBRO_ENTROU + SALA_ATUALIZADA, ordem=2 ---

test('ENTRAR_NA_SALA: B entra na sala de A → MEMBRO_ENTROU + SALA_ATUALIZADA com ordem=2', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    // B recebe MEMBRO_ENTROU e SALA_ATUALIZADA (2 eventos).
    const eventosB = await coletarEventos(wsB, 2);
    assert.equal(eventosB[0]?.type, 'MEMBRO_ENTROU');
    assert.equal(eventosB[1]?.type, 'SALA_ATUALIZADA');
    const membroB = membroDaSala((eventosB[1] as SalaAtualizadaEvento).sala, b.id);
    assert.equal(membroB.ordemDeEntrada, 2);

    // A recebe MEMBRO_ENTROU e SALA_ATUALIZADA.
    const eventosA = await coletarEventos(wsA, 2);
    assert.equal(eventosA[0]?.type, 'MEMBRO_ENTROU');
    assert.equal(eventosA[1]?.type, 'SALA_ATUALIZADA');
    assert.equal((eventosA[1] as SalaAtualizadaEvento).sala.membros.length, 2);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

test('ENTRAR_NA_SALA revalida a Sessão no Redis antes de adicionar vínculo', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);

    const logout = await postJson(servidor.baseUrl, '/api/auth/logout', {}, b.cookies);
    assert.equal(logout.status, 204);

    const close = esperarClose(wsB);
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: criacao.sala.codigoDeSala });
    assert.equal((await close).code, 4401);

    wsA.close();
    await esperarClose(wsA).catch(() => undefined);
  });
});

// --- 4. C, D entram com codigoDeSala → ordens 3 e 4 ---

test('ENTRAR_NA_SALA: C e D entram em sequência, ordens 3 e 4', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const d = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);
    const wsD = await conectarWs(servidor.wsUrl, d.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const eventosC = await coletarEventos(wsC, 2);
    const salaC = (eventosC[1] as SalaAtualizadaEvento).sala;
    assert.equal(membroDaSala(salaC, c.id).ordemDeEntrada, 3);
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);

    enviar(wsD, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const eventosD = await coletarEventos(wsD, 2);
    const salaD = (eventosD[1] as SalaAtualizadaEvento).sala;
    assert.equal(membroDaSala(salaD, d.id).ordemDeEntrada, 4);
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);
    await coletarEventos(wsC, 2);

    wsA.close();
    wsB.close();
    wsC.close();
    wsD.close();
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
      esperarClose(wsD).catch(() => undefined),
    ]);
  });
});

// --- 5. E entra com codigoDeSala → ERRO_DA_SALA { codigo: 'SALA_CHEIA' } ---

test('ENTRAR_NA_SALA: 5º jogador recebe ERRO_DA_SALA SALA_CHEIA', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const d = await registrarJogador(servidor.baseUrl);
    const e = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);
    const wsD = await conectarWs(servidor.wsUrl, d.cookies);
    const wsE = await conectarWs(servidor.wsUrl, e.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    for (const ws of [wsB, wsC, wsD]) {
      enviar(ws, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
      await coletarEventos(ws, 2);
    }
    // Drena broadcasts de A.
    await coletarEventos(wsA, 6);
    await coletarEventos(wsB, 4);
    await coletarEventos(wsC, 2);

    enviar(wsE, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarErro(wsE, 'SALA_CHEIA');

    for (const ws of [wsA, wsB, wsC, wsD, wsE]) {
      ws.close();
    }
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
      esperarClose(wsD).catch(() => undefined),
      esperarClose(wsE).catch(() => undefined),
    ]);
  });
});

// --- 6. Concorrência: 4 sockets em paralelo, 1 entra, 3 recebem SALA_CHEIA ---

test('ENTRAR_NA_SALA: 4 sockets em paralelo, exatamente 1 entra e 3 recebem SALA_CHEIA', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const concorrentes = [
      await registrarJogador(servidor.baseUrl),
      await registrarJogador(servidor.baseUrl),
      await registrarJogador(servidor.baseUrl),
      await registrarJogador(servidor.baseUrl),
    ];
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);
    const wsConcorrentes = await Promise.all(
      concorrentes.map((j) => conectarWs(servidor.wsUrl, j.cookies)),
    );

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    for (const ws of [wsB, wsC]) {
      enviar(ws, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    }
    await Promise.all([
      coletarEventos(wsB, 2),
      coletarEventos(wsC, 2),
    ]);
    await coletarEventos(wsA, 4);

    // Dispara 4 ENTRAR_NA_SALA em paralelo — apenas 1 deve entrar.
    for (const ws of wsConcorrentes) {
      enviar(ws, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    }

    // Cada socket recebe OU (MEMBRO_ENTROU + SALA_ATUALIZADA) OU ERRO_DA_SALA.
    const resultados = await Promise.all(
      wsConcorrentes.map(async (ws) => {
        const raw = await esperarMensagem(ws, 2000);
        return JSON.parse(raw) as SalaEventoDoServidor;
      }),
    );

    const sucessos = resultados.filter((e) => e.type === 'MEMBRO_ENTROU');
    const erros = resultados.filter((e) => e.type === 'ERRO_DA_SALA');
    assert.equal(sucessos.length, 1, `esperava 1 MEMBRO_ENTROU, recebi ${sucessos.length}`);
    assert.equal(erros.length, 3, `esperava 3 ERRO_DA_SALA, recebi ${erros.length}`);
    for (const erro of erros) {
      assert.equal((erro as ErroDaSalaEvento).codigo, 'SALA_CHEIA');
    }

    for (const ws of [wsA, wsB, wsC, ...wsConcorrentes]) {
      ws.close();
    }
    await Promise.all(
      [wsA, wsB, wsC, ...wsConcorrentes].map((ws) =>
        esperarClose(ws).catch(() => undefined),
      ),
    );
  });
});

// --- 7. B reenvia ENTRAR_NA_SALA → idempotente (sem evento broadcast) ---

test('ENTRAR_NA_SALA: reenvio pelo próprio B é idempotente (sem broadcast)', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    // B reenvia — engine trata como no-op (membro já ativo). Sem broadcast.
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarSilencio(wsB);

    // A também não recebe nada.
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarSilencio(wsA);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 8. C em sala ativa tenta entrar em outra → ERRO_DA_SALA { codigo: 'JOGADOR_JA_ASSOCIADO' } ---

test('ENTRAR_NA_SALA: jogador já associado a outra sala recebe JOGADOR_JA_ASSOCIADO', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const d = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);
    const wsD = await conectarWs(servidor.wsUrl, d.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const salaA = await esperarSalaAtualizada(wsA);
    const codigoA = salaA.sala.codigoDeSala;

    enviar(wsB, { type: 'CRIAR_SALA' });
    const salaB = await esperarSalaAtualizada(wsB);
    const codigoB = salaB.sala.codigoDeSala;

    // C entra na sala de B.
    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigoB });
    await coletarEventos(wsC, 2);
    await coletarEventos(wsB, 2);

    // C tenta entrar na sala de A — engine rejeita.
    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigoA });
    await esperarErro(wsC, 'JOGADOR_JA_ASSOCIADO');

    // Garante que A não recebeu broadcast da tentativa de C.
    enviar(wsD, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigoA });
    await coletarEventos(wsD, 2);
    await coletarEventos(wsA, 2);

    for (const ws of [wsA, wsB, wsC, wsD]) {
      ws.close();
    }
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
      esperarClose(wsD).catch(() => undefined),
    ]);
  });
});

// --- 9. B envia SAIR_DA_SALA → MEMBRO_SAIU + SALA_ATUALIZADA ---

test('SAIR_DA_SALA: B sai, A, C, D recebem MEMBRO_SAIU + SALA_ATUALIZADA, vaga liberada', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const d = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);
    const wsD = await conectarWs(servidor.wsUrl, d.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;
    for (const ws of [wsB, wsC, wsD]) {
      enviar(ws, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
      await coletarEventos(ws, 2);
    }
    await coletarEventos(wsA, 6);
    await coletarEventos(wsB, 4);
    await coletarEventos(wsC, 2);

    // B sai.
    enviar(wsB, { type: 'SAIR_DA_SALA' });
    // B recebe MEMBRO_SAIU + SALA_ATUALIZADA.
    const eventosB = await coletarEventos(wsB, 2);
    assert.equal(eventosB[0]?.type, 'MEMBRO_SAIU');
    assert.equal(eventosB[1]?.type, 'SALA_ATUALIZADA');
    // A, C, D também recebem os 2 eventos.
    for (const ws of [wsA, wsC, wsD]) {
      const eventos = await coletarEventos(ws, 2);
      assert.equal(eventos[0]?.type, 'MEMBRO_SAIU');
      assert.equal(eventos[1]?.type, 'SALA_ATUALIZADA');
    }
    // B não está mais nos membros da sala atualizada.
    const salaAtualizada = (eventosB[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaAtualizada.membros.length, 3);
    assert.equal(salaAtualizada.membros.find((m) => m.jogadorId === b.id), undefined);

    // Vaga liberada: novo jogador E entra com sucesso.
    const e = await registrarJogador(servidor.baseUrl);
    const wsE = await conectarWs(servidor.wsUrl, e.cookies);
    enviar(wsE, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const eventosE = await coletarEventos(wsE, 2);
    const salaE = (eventosE[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaE.membros.length, 4);
    assert.equal(membroDaSala(salaE, e.id).ordemDeEntrada, 5);

    for (const ws of [wsA, wsB, wsC, wsD, wsE]) {
      ws.close();
    }
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
      esperarClose(wsD).catch(() => undefined),
      esperarClose(wsE).catch(() => undefined),
    ]);
  });
});

// --- 10. Última saída anuncia a Sala encerrada ---

test('SAIR_DA_SALA: última saída anuncia SALA_ATUALIZADA encerrada e sem Membros', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsB, { type: 'SAIR_DA_SALA' });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsA, { type: 'SAIR_DA_SALA' });
    const eventosDeA = await coletarEventos(wsA, 2);
    const salaFinal = eventosDeA[1] as SalaAtualizadaEvento;
    assert.equal(salaFinal.type, 'SALA_ATUALIZADA');
    assert.equal(salaFinal.sala.estado, 'encerrada');
    assert.deepEqual(salaFinal.sala.membros, []);

    for (const ws of [wsA, wsB]) {
      ws.close();
    }
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
    ]);
  });
});

test('SAIR_DA_SALA não altera a Sala em memória quando a transação falha', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: criacao.sala.codigoDeSala });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsB, { type: 'SAIR_DA_SALA' });
    await esperarErro(wsB, 'DADOS_INVALIDOS');

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: criacao.sala.codigoDeSala });
    const eventosC = await coletarEventos(wsC, 2);
    const salaC = (eventosC[1] as SalaAtualizadaEvento).sala;
    assert.ok(
      salaC.membros.some((membro) => membro.jogadorId === b.id),
      'B deve permanecer na Sala depois de rollback da saída',
    );

    for (const ws of [wsA, wsB, wsC]) {
      ws.close();
    }
    await Promise.all([wsA, wsB, wsC].map((ws) => esperarClose(ws).catch(() => undefined)));
  }, { repo: new RepositorioComFalhaNaSaida() });
});

// --- 11. Todos recebem SALA_ATUALIZADA em todas as mutações ---

test('Broadcast: cada mutação emite SALA_ATUALIZADA para todos os membros', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    // B entra → A recebe MEMBRO_ENTROU + SALA_ATUALIZADA, B idem.
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const evB1 = await coletarEventos(wsB, 2);
    assert.equal(evB1[1]?.type, 'SALA_ATUALIZADA');
    const evA1 = await coletarEventos(wsA, 2);
    assert.equal(evA1[1]?.type, 'SALA_ATUALIZADA');

    // B sai → ambos recebem MEMBRO_SAIU + SALA_ATUALIZADA.
    enviar(wsB, { type: 'SAIR_DA_SALA' });
    const evB2 = await coletarEventos(wsB, 2);
    assert.equal(evB2[1]?.type, 'SALA_ATUALIZADA');
    const evA2 = await coletarEventos(wsA, 2);
    assert.equal(evA2[1]?.type, 'SALA_ATUALIZADA');

    for (const ws of [wsA, wsB]) {
      ws.close();
    }
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 12. Geração: 30 Salas produzem Códigos válidos e distintos ---

test('Geração: 30 salas geradas produzem Códigos válidos e únicos', async () => {
  await comServidor(async (servidor) => {
    const N = 30;
    const jogadores = await Promise.all(
      Array.from({ length: N }, () => registrarJogador(servidor.baseUrl)),
    );
    const sockets = await Promise.all(
      jogadores.map((j) => conectarWs(servidor.wsUrl, j.cookies)),
    );

    const eventos = await Promise.all(
      sockets.map(async (ws) => {
        enviar(ws, { type: 'CRIAR_SALA' });
        const ev = await esperarSalaAtualizada(ws);
        assert.match(ev.sala.codigoDeSala, /^[A-Z0-9]{6}$/);
        return ev;
      }),
    );
    const unicos = new Set(eventos.map((evento) => evento.sala.codigoDeSala));
    assert.equal(unicos.size, N, `esperava ${N} codigos únicos, encontrei ${unicos.size}`);

    for (const ws of sockets) {
      ws.close();
    }
    await Promise.all(sockets.map((ws) => esperarClose(ws).catch(() => undefined)));
  });
});

// --- 13. Projeção Redis expira → fallback ao write-model com cura de cache ---

test('ENTRAR_NA_SALA recorre ao PostgreSQL quando a chave do Código expira', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    // Simula a expiração do TTL da projeção quente (ADR-0002: reconstruível).
    assert.equal(await redisClient.del(chaveSalaCodigo(codigo)), 1);

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const eventosB = await coletarEventos(wsB, 2);
    assert.equal(eventosB[0]?.type, 'MEMBRO_ENTROU');
    assert.equal(eventosB[1]?.type, 'SALA_ATUALIZADA');
    const salaB = (eventosB[1] as SalaAtualizadaEvento).sala;
    assert.equal(membroDaSala(salaB, b.id).ordemDeEntrada, 2);

    // Cura: a chave de código volta a existir após o fallback.
    const salaIdCurado = await redisClient.get(chaveSalaCodigo(codigo));
    assert.ok(typeof salaIdCurado === 'string' && salaIdCurado.length > 0);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

test('SAIR_DA_SALA recorre ao PostgreSQL quando a associação do Jogador expira', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    // Expira a associação jogador→sala; o vínculo ativo segue no PG.
    assert.equal(await redisClient.del(chaveJogadorSala(b.id)), 1);

    enviar(wsB, { type: 'SAIR_DA_SALA' });
    const eventosB = await coletarEventos(wsB, 2);
    assert.equal(eventosB[0]?.type, 'MEMBRO_SAIU');
    assert.equal(eventosB[1]?.type, 'SALA_ATUALIZADA');

    const eventosA = await coletarEventos(wsA, 2);
    assert.equal(eventosA[0]?.type, 'MEMBRO_SAIU');
    assert.equal(eventosA[1]?.type, 'SALA_ATUALIZADA');

    // A associação é curada pelo fallback e então removida pela saída.
    const associacaoPosSaida = await redisClient.get(chaveJogadorSala(b.id));
    assert.equal(associacaoPosSaida, null);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 14. Sucessão do Anfitrião sobrevive ao reinício via write-model ---

test('Sucessão do Anfitrião é persistida e restaurada na reconstrução', async () => {
  const codigo = { valor: '' };
  let cookiesB: Cookies | undefined;
  let jogadorIdB = '';

  {
    const servidor = await subirServidor();
    try {
      const a = await registrarJogador(servidor.baseUrl);
      const b = await registrarJogador(servidor.baseUrl);
      cookiesB = b.cookies;
      jogadorIdB = b.id;
      const wsA = await conectarWs(servidor.wsUrl, a.cookies);
      const wsB = await conectarWs(servidor.wsUrl, b.cookies);

      enviar(wsA, { type: 'CRIAR_SALA' });
      const criacao = await esperarSalaAtualizada(wsA);
      codigo.valor = criacao.sala.codigoDeSala;

      enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo.valor });
      await coletarEventos(wsB, 2);
      await coletarEventos(wsA, 2);

      // A (Anfitrião) sai: sucessão circular escolhe B (ordem seguinte).
      enviar(wsA, { type: 'SAIR_DA_SALA' });
      // MEMBRO_SAIU + SALA_ATUALIZADA + ANFITRIAO_SUBSTITUIDO + SALA_ATUALIZADA.
      await coletarEventos(wsA, 4);
      await coletarEventos(wsB, 4);

      // Contrato novo: o write-model reflete a sucessão no mesmo commit.
      const linha = await pool.query<{ anfitriaoId: string }>(
        `SELECT anfitriao_id AS "anfitriaoId"
         FROM salas_historico
         WHERE codigo_sala = $1 AND status = 'aberta'`,
        [codigo.valor],
      );
      assert.equal(linha.rows[0]?.anfitriaoId, b.id);

      wsA.close();
      wsB.close();
      await Promise.all([
        esperarClose(wsA).catch(() => undefined),
        esperarClose(wsB).catch(() => undefined),
      ]);
    } finally {
      await servidor.fechar();
    }
  }

  // Nova instância reconstrói do PostgreSQL: B permanece Anfitrião.
  await comServidor(async (servidor) => {
    assert.ok(cookiesB !== undefined, 'cookies de B ausentes');
    const c = await registrarJogador(servidor.baseUrl);
    const wsB = await conectarWs(servidor.wsUrl, cookiesB!);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo.valor });
    const eventosC = await coletarEventos(wsC, 2);
    const salaC = (eventosC[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaC.membros.length, 2);
    assert.equal(salaC.anfitriaoId, membroDaSala(salaC, jogadorIdB).id);

    wsB.close();
    wsC.close();
    await Promise.all([
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
    ]);
  });
});

// --- 15. Saída do Anfitrião anuncia a sucessão no broadcast ---

test('SAIR_DA_SALA do Anfitrião anuncia ANFITRIAO_SUBSTITUIDO com o sucessor', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const membroAnfitriaoOriginal = criacao.sala.membros[0]?.id ?? '';
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsC, 2);
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);

    // A (Anfitrião) sai: sucessão circular escolhe B (ordem seguinte).
    enviar(wsA, { type: 'SAIR_DA_SALA' });

    const eventosB = await coletarEventos(wsB, 4);
    assert.equal(eventosB[0]?.type, 'MEMBRO_SAIU');
    assert.equal(eventosB[1]?.type, 'SALA_ATUALIZADA');
    assert.equal(eventosB[2]?.type, 'ANFITRIAO_SUBSTITUIDO');
    assert.equal(eventosB[3]?.type, 'SALA_ATUALIZADA');

    const sucessao = eventosB[2] as AnfitriaoSubstituidoEvento;
    assert.equal(sucessao.anfitriaoAnteriorId, membroAnfitriaoOriginal);
    const salaFinal = (eventosB[3] as SalaAtualizadaEvento).sala;
    assert.equal(salaFinal.anfitriaoId, membroDaSala(salaFinal, b.id).id);

    // A e C recebem os mesmos 4 eventos.
    await coletarEventos(wsC, 4);
    const eventosA = await coletarEventos(wsA, 4);
    assert.equal(eventosA[2]?.type, 'ANFITRIAO_SUBSTITUIDO');

    for (const ws of [wsA, wsB, wsC]) {
      ws.close();
    }
    await Promise.all(
      [wsA, wsB, wsC].map((ws) => esperarClose(ws).catch(() => undefined)),
    );
  });
});

// --- 16. Código inexistente é recusado sem tocar o write-model ---

test('ENTRAR_NA_SALA com Código inexistente recebe SALA_NAO_ENCONTRADA', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);

    enviar(wsA, { type: 'ENTRAR_NA_SALA', codigoDeSala: 'ZZZZZZ' });
    const erro = await esperarErro(wsA, 'SALA_NAO_ENCONTRADA');
    assert.ok(erro.mensagem.length > 0);

    wsA.close();
    await esperarClose(wsA).catch(() => undefined);
  });
});
