import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aplicarComando,
  autorizarRetorno,
  criarSala,
  entrarNaSala,
  estadoDoLobbyVazio,
  expulsarMembro,
  MOTIVOS_DE_ENCERRAMENTO,
  sairDaSala,
  type Comando,
  type EstadoDoLobby,
} from '../src/index.ts';

const criar = (salaId = 'sala-1', jogadorId = 'jogador-1', membroId = 'membro-1') =>
  ({
    tipo: 'criar_sala',
    salaId,
    codigo: salaId === 'sala-1' ? 'ABC123' : salaId.toUpperCase(),
    jogadorId,
    membroId,
  } as const);

const entrar = (jogadorId: string, membroId: string, salaId = 'sala-1') =>
  ({ tipo: 'entrar_na_sala', salaId, jogadorId, membroId } as const);

const sair = (jogadorId: string, salaId = 'sala-1') =>
  ({ tipo: 'sair_da_sala', salaId, jogadorId } as const);

const expulsar = (anfitriaoMembroId: string, membroAlvoId: string, salaId = 'sala-1') =>
  ({ tipo: 'expulsar_membro', salaId, anfitriaoMembroId, membroAlvoId } as const);

const autorizar = (anfitriaoMembroId: string, jogadorId: string, salaId = 'sala-1') =>
  ({ tipo: 'autorizar_retorno', salaId, anfitriaoMembroId, jogadorId } as const);

function aplicar(estado: EstadoDoLobby, comando: Comando): EstadoDoLobby {
  const resultado = aplicarComando(estado, comando);
  if (!resultado.sucesso) {
    throw new Error(resultado.erro.mensagem);
  }
  return resultado.estado;
}

test('cria Sala com o criador como primeiro Membro e Anfitrião', () => {
  const resultado = criarSala(estadoDoLobbyVazio(), criar());

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.deepEqual(resultado.estado.salas[0], {
    id: 'sala-1',
    codigo: 'ABC123',
    estado: 'aberta',
    membros: [{
      id: 'membro-1',
      jogadorId: 'jogador-1',
      ordemDeEntrada: 1,
      estado: 'ativo',
      motivoEncerramento: null,
    }],
    proximaOrdemDeEntrada: 2,
    anfitriaoId: 'membro-1',
    jogadoresBloqueados: [],
  });
  assert.deepEqual(resultado.eventos.map((evento) => evento.tipo), ['sala_criada']);
});

test('admite Membros em ordem monotônica e não reutiliza ordem após saída', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, sair('jogador-2'));
  estado = aplicar(estado, entrar('jogador-3', 'membro-3'));

  const sala = estado.salas[0];
  assert.deepEqual(sala.membros.map((membro) => membro.ordemDeEntrada), [1, 2, 3]);
  assert.equal(sala.proximaOrdemDeEntrada, 4);
  assert.equal(sala.membros[1].estado, 'encerrado');
});

test('retry do mesmo Jogador na mesma Sala é idempotente', () => {
  const estado = aplicar(estadoDoLobbyVazio(), criar());
  const resultado = entrarNaSala(estado, entrar('jogador-1', 'outro-membro'));

  assert.deepEqual(resultado, { sucesso: true, estado, eventos: [] });
});

test('aceita quatro Membros ativos e rejeita o quinto', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, entrar('jogador-3', 'membro-3'));
  estado = aplicar(estado, entrar('jogador-4', 'membro-4'));
  const resultado = entrarNaSala(estado, entrar('jogador-5', 'membro-5'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'SALA_CHEIA');
});

test('impede um Jogador de possuir duas associações ativas', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar('sala-1', 'jogador-1', 'membro-1'));
  estado = aplicar(estado, criar('sala-2', 'jogador-2', 'membro-2'));
  const resultado = entrarNaSala(estado, entrar('jogador-1', 'membro-3', 'sala-2'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'JOGADOR_JA_ASSOCIADO');
});

test('também aplica unicidade global quando o Jogador tenta criar outra Sala', () => {
  const estado = aplicar(estadoDoLobbyVazio(), criar());
  const resultado = criarSala(estado, criar('sala-2', 'jogador-1', 'membro-2'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'JOGADOR_JA_ASSOCIADO');
});

test('preserva o vínculo encerrado, libera a vaga e registra motivo saida', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  const antesDaSaida = estado;
  const resultado = sairDaSala(estado, sair('jogador-2'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.notEqual(resultado.estado, antesDaSaida);
  assert.equal(resultado.estado.salas[0].membros[1].motivoEncerramento, 'saida');
  assert.equal(resultado.estado.salas[0].membros.filter((membro) => membro.estado === 'ativo').length, 1);
  assert.deepEqual(resultado.eventos.map((evento) => evento.tipo), ['membro_saiu']);
});

test('sucede o Anfitrião pelo próximo Membro na ordem de entrada quando ele sai', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, entrar('jogador-3', 'membro-3'));
  const resultado = sairDaSala(estado, sair('jogador-1'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(resultado.estado.salas[0].anfitriaoId, 'membro-2');
  assert.equal(resultado.estado.salas[0].estado, 'aberta');
  const sucessao = resultado.eventos.find(
    (evento): evento is Extract<typeof evento, { tipo: 'anfitriao_sucedido' }> =>
      evento.tipo === 'anfitriao_sucedido',
  );
  assert.ok(sucessao);
  assert.equal(sucessao.anfitriaoAnteriorId, 'membro-1');
  assert.equal(sucessao.anfitriaoNovoId, 'membro-2');
});

test('sucessão circular: Anfitrião com a maior ordem é sucedido pelo de menor ordem', () => {
  const estado: EstadoDoLobby = {
    salas: [{
      id: 'sala-1',
      codigo: 'ABC123',
      estado: 'aberta',
      membros: [
        { id: 'membro-1', jogadorId: 'jogador-1', ordemDeEntrada: 1, estado: 'encerrado', motivoEncerramento: 'saida' },
        { id: 'membro-5', jogadorId: 'jogador-5', ordemDeEntrada: 5, estado: 'ativo', motivoEncerramento: null },
        { id: 'membro-2', jogadorId: 'jogador-2', ordemDeEntrada: 2, estado: 'ativo', motivoEncerramento: null },
      ],
      proximaOrdemDeEntrada: 6,
      anfitriaoId: 'membro-5',
      jogadoresBloqueados: [],
    }],
  };
  const resultado = sairDaSala(estado, sair('jogador-5'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(resultado.estado.salas[0].anfitriaoId, 'membro-2');
  assert.deepEqual(
    resultado.eventos.filter((evento) => evento.tipo === 'anfitriao_sucedido'),
    [{
      tipo: 'anfitriao_sucedido',
      salaId: 'sala-1',
      anfitriaoAnteriorId: 'membro-5',
      anfitriaoNovoId: 'membro-2',
    }],
  );
});

test('saída do último Membro encerra a Sala sem Anfitrião e sem evento de sucessão', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, sair('jogador-1'));
  const resultado = sairDaSala(estado, sair('jogador-2'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(resultado.estado.salas[0].anfitriaoId, null);
  assert.equal(resultado.estado.salas[0].estado, 'encerrada');
  assert.equal(
    resultado.eventos.some((evento) => evento.tipo === 'anfitriao_sucedido'),
    false,
  );
});

test('encerra a Sala quando o último Membro sai', () => {
  const estado = aplicar(estadoDoLobbyVazio(), criar());
  const resultado = sairDaSala(estado, sair('jogador-1'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(resultado.estado.salas[0].estado, 'encerrada');
  assert.equal(resultado.estado.salas[0].anfitriaoId, null);
  assert.deepEqual(resultado.eventos.map((evento) => evento.tipo), [
    'membro_saiu',
    'sala_encerrada',
  ]);
  assert.equal(resultado.eventos[1].tipo, 'sala_encerrada');
  if (resultado.eventos[1].tipo === 'sala_encerrada') {
    assert.equal(resultado.eventos[1].motivo, 'saida');
  }
});

test('não aceita entrada em Sala encerrada e expõe os motivos futuros', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, sair('jogador-1'));
  const resultado = entrarNaSala(estado, entrar('jogador-2', 'membro-2'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'SALA_ENCERRADA');
  assert.deepEqual(MOTIVOS_DE_ENCERRAMENTO, [
    'saida',
    'expulsao',
    'expiracao',
    'encerramento',
  ]);
});

test('opera de forma determinística e não muta o estado recebido', () => {
  const original = aplicar(estadoDoLobbyVazio(), criar());
  const snapshot = structuredClone(original);
  const primeira = entrarNaSala(original, entrar('jogador-2', 'membro-2'));
  const segunda = entrarNaSala(original, entrar('jogador-2', 'membro-2'));

  assert.deepEqual(original, snapshot);
  assert.deepEqual(primeira, segunda);
});

test('uma corrida sequencial pela última vaga admite somente a primeira entrada', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, entrar('jogador-3', 'membro-3'));

  const primeira = entrarNaSala(estado, entrar('jogador-5', 'membro-5'));
  assert.equal(primeira.sucesso, true);
  if (!primeira.sucesso) return;
  const segunda = entrarNaSala(primeira.estado, entrar('jogador-6', 'membro-6'));

  assert.equal(segunda.sucesso, false);
  if (segunda.sucesso) return;
  assert.equal(segunda.erro.codigo, 'SALA_CHEIA');
});

test('expulsa Membro ativo com motivo expulsao, libera a vaga e bloqueia o retorno', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  const resultado = expulsarMembro(estado, expulsar('membro-1', 'membro-2'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const sala = resultado.estado.salas[0];
  const alvo = sala.membros.find((membro) => membro.id === 'membro-2');
  assert.equal(alvo?.estado, 'encerrado');
  assert.equal(alvo?.motivoEncerramento, 'expulsao');
  assert.deepEqual(sala.jogadoresBloqueados, ['jogador-2']);
  assert.equal(
    sala.membros.filter((membro) => membro.estado === 'ativo').length,
    1,
  );
  assert.equal(sala.anfitriaoId, 'membro-1');
  assert.deepEqual(resultado.eventos.map((evento) => evento.tipo), ['membro_expulsado']);
  const evento = resultado.eventos[0];
  if (evento.tipo === 'membro_expulsado') {
    assert.equal(evento.jogadorId, 'jogador-2');
    assert.equal(evento.ordemDeEntrada, 2);
    assert.equal(evento.motivo, 'expulsao');
  }
});

test('rejeita expulsão por Membro que não é o Anfitrião atual', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, entrar('jogador-3', 'membro-3'));
  const resultado = expulsarMembro(estado, expulsar('membro-2', 'membro-3'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'APENAS_ANFITRIAO');
});

test('rejeita auto-expulsão do Anfitrião', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  const resultado = expulsarMembro(estado, expulsar('membro-1', 'membro-1'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'APENAS_ANFITRIAO');
});

test('bloqueia a reentrada de Jogador expulso enquanto o retorno não é autorizado', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, expulsar('membro-1', 'membro-2'));
  const resultado = entrarNaSala(estado, entrar('jogador-2', 'membro-3'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'JOGADOR_EXPULSO');
});

test('após autorizar_retorno, a reentrada cria nova participação com nova ordem', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, expulsar('membro-1', 'membro-2'));
  const autorizacao = autorizarRetorno(estado, autorizar('membro-1', 'jogador-2'));

  assert.equal(autorizacao.sucesso, true);
  if (!autorizacao.sucesso) return;
  assert.deepEqual(
    autorizacao.eventos.map((evento) => evento.tipo),
    ['retorno_autorizado'],
  );
  assert.deepEqual(autorizacao.estado.salas[0].jogadoresBloqueados, []);

  estado = aplicar(autorizacao.estado, entrar('jogador-2', 'membro-3'));
  const sala = estado.salas[0];
  const novoVinculo = sala.membros.find((membro) => membro.id === 'membro-3');
  assert.equal(novoVinculo?.estado, 'ativo');
  assert.equal(novoVinculo?.motivoEncerramento, null);
  assert.equal(novoVinculo?.ordemDeEntrada, 3);
});

test('rejeita autorizar_retorno por Membro que não é o Anfitrião atual', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, expulsar('membro-1', 'membro-2'));
  const resultado = autorizarRetorno(estado, autorizar('membro-2', 'jogador-2'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'APENAS_ANFITRIAO');
});

test('rejeita autorizar_retorno para Jogador que não está bloqueado', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  const resultado = autorizarRetorno(estado, autorizar('membro-1', 'jogador-2'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'JOGADOR_NAO_BLOQUEADO');
});
