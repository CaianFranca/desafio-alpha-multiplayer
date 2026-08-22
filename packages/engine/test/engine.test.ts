import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aplicarComando,
  autorizarRetorno,
  confirmarConsistenciaDaSala,
  criarSala,
  desconectarJogador,
  entrarNaSala,
  estadoDoLobbyVazio,
  expirarReconexao,
  expulsarMembro,
  MOTIVOS_DE_ENCERRAMENTO,
  reconectarJogador,
  registrarReinicioDaSala,
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

const desconectar = (jogadorId: string, salaId = 'sala-1') =>
  ({ tipo: 'desconectar_jogador', salaId, jogadorId } as const);

const reconectar = (jogadorId: string, salaId = 'sala-1') =>
  ({ tipo: 'reconectar_jogador', salaId, jogadorId } as const);

const expirar = (membroId: string, salaId = 'sala-1') =>
  ({ tipo: 'expirar_reconexao', salaId, membroId } as const);

const confirmar = (salaId = 'sala-1') =>
  ({ tipo: 'confirmar_consistencia_da_sala', salaId } as const);

const registrarReinicio = (salaId = 'sala-1') =>
  ({ tipo: 'registrar_reinicio_da_sala', salaId } as const);

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
      presenca: 'conectado',
      pronto: false,
    }],
    proximaOrdemDeEntrada: 2,
    anfitriaoId: 'membro-1',
    jogadoresBloqueados: [],
    consistente: true,
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
        { id: 'membro-1', jogadorId: 'jogador-1', ordemDeEntrada: 1, estado: 'encerrado', motivoEncerramento: 'saida', presenca: 'conectado', pronto: false },
        { id: 'membro-5', jogadorId: 'jogador-5', ordemDeEntrada: 5, estado: 'ativo', motivoEncerramento: null, presenca: 'conectado', pronto: false },
        { id: 'membro-2', jogadorId: 'jogador-2', ordemDeEntrada: 2, estado: 'ativo', motivoEncerramento: null, presenca: 'conectado', pronto: false },
      ],
      proximaOrdemDeEntrada: 6,
      anfitriaoId: 'membro-5',
      jogadoresBloqueados: [],
      consistente: true,
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

test('saída de Membro comum preserva o Anfitrião sem evento de sucessão', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  const resultado = sairDaSala(estado, sair('jogador-2'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(resultado.estado.salas[0].anfitriaoId, 'membro-1');
  assert.equal(
    resultado.eventos.some((evento) => evento.tipo === 'anfitriao_sucedido'),
    false,
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

test('expulsão libera a vaga que um novo Jogador admite imediatamente', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, expulsar('membro-1', 'membro-2'));

  const resultado = entrarNaSala(estado, entrar('jogador-3', 'membro-3'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const sala = resultado.estado.salas[0];
  assert.equal(sala.membros.filter((membro) => membro.estado === 'ativo').length, 2);
  assert.deepEqual(sala.jogadoresBloqueados, ['jogador-2']);
  const reentrada = entrarNaSala(resultado.estado, entrar('jogador-2', 'membro-4'));
  assert.equal(reentrada.sucesso, false);
  if (reentrada.sucesso) return;
  assert.equal(reentrada.erro.codigo, 'JOGADOR_EXPULSO');
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

test('presença é agregada por Jogador: desconectar e reconectar refletem o vínculo', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, desconectar('jogador-1'));

  const membro = estado.salas[0].membros[0];
  assert.equal(membro.estado, 'ativo');
  assert.equal(membro.presenca, 'em_reconexao');

  const resultado = reconectarJogador(estado, reconectar('jogador-1'));
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.deepEqual(resultado.eventos.map((evento) => evento.tipo), ['membro_reconectado']);
  const evento = resultado.eventos[0];
  if (evento.tipo === 'membro_reconectado') {
    assert.equal(evento.membroId, 'membro-1');
    assert.equal(evento.jogadorId, 'jogador-1');
    assert.equal(evento.ordemDeEntrada, 1);
  }
});

test('perda de conexão entra em reconexão preservando vínculo, vaga, ordem, pronto e papel', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  const antes = structuredClone(estado);
  const resultado = desconectarJogador(estado, desconectar('jogador-1'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const sala = resultado.estado.salas[0];
  const anfitriao = sala.membros.find((membro) => membro.id === 'membro-1');
  assert.ok(anfitriao);
  assert.equal(anfitriao.estado, 'ativo');
  assert.equal(anfitriao.presenca, 'em_reconexao');
  assert.equal(anfitriao.ordemDeEntrada, 1);
  assert.equal(anfitriao.pronto, false);
  assert.equal(sala.anfitriaoId, 'membro-1');
  assert.equal(sala.proximaOrdemDeEntrada, 3);
  assert.deepEqual(resultado.eventos.map((evento) => evento.tipo), ['membro_desconectado']);
  const evento = resultado.eventos[0];
  if (evento.tipo === 'membro_desconectado') {
    assert.equal(evento.membroId, 'membro-1');
    assert.equal(evento.jogadorId, 'jogador-1');
    assert.equal(evento.ordemDeEntrada, 1);
  }
  assert.notEqual(resultado.estado, estado);
  assert.notDeepEqual(resultado.estado.salas[0].membros[0], antes.salas[0].membros[0]);
});

test('desconectar_jogador é idempotente quando o Membro já está em reconexão', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, desconectar('jogador-1'));
  const resultado = desconectarJogador(estado, desconectar('jogador-1'));

  assert.deepEqual(resultado, { sucesso: true, estado, eventos: [] });
});

test('reconectar_jogador é idempotente quando o Membro já está conectado', () => {
  const estado = aplicar(estadoDoLobbyVazio(), criar());
  const resultado = reconectarJogador(estado, reconectar('jogador-1'));

  assert.deepEqual(resultado, { sucesso: true, estado, eventos: [] });
});

test('expiração encerra o vínculo com motivo expiracao e libera a vaga para novo Jogador', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, desconectar('jogador-2'));
  const resultado = expirarReconexao(estado, expirar('membro-2'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const sala = resultado.estado.salas[0];
  const expirado = sala.membros.find((membro) => membro.id === 'membro-2');
  assert.equal(expirado?.estado, 'encerrado');
  assert.equal(expirado?.motivoEncerramento, 'expiracao');
  assert.equal(expirado?.presenca, 'conectado');
  assert.equal(expirado?.pronto, false);
  assert.deepEqual(
    resultado.eventos.map((evento) => evento.tipo),
    ['vinculo_expirado'],
  );

  const novaEntrada = entrarNaSala(resultado.estado, entrar('jogador-3', 'membro-3'));
  assert.equal(novaEntrada.sucesso, true);
  if (!novaEntrada.sucesso) return;
  const novoMembro = novaEntrada.estado.salas[0].membros.find(
    (membro) => membro.id === 'membro-3',
  );
  assert.equal(novoMembro?.estado, 'ativo');
  assert.equal(novoMembro?.ordemDeEntrada, 3);
});

test('expiração exige Membro ativo em janela de reconexão', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  const conectado = expirarReconexao(estado, expirar('membro-1'));
  assert.equal(conectado.sucesso, false);
  if (conectado.sucesso) return;
  assert.equal(conectado.erro.codigo, 'MEMBRO_NAO_EM_RECONEXAO');

  estado = aplicar(estado, sair('jogador-1'));
  const encerrado = expirarReconexao(estado, expirar('membro-1'));
  assert.equal(encerrado.sucesso, false);
  if (encerrado.sucesso) return;
  assert.equal(encerrado.erro.codigo, 'MEMBRO_NAO_ATIVO');
});

test('expulsão continua válida contra Membro em reconexão', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, desconectar('jogador-2'));
  const resultado = expulsarMembro(estado, expulsar('membro-1', 'membro-2'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const alvo = resultado.estado.salas[0].membros.find(
    (membro) => membro.id === 'membro-2',
  );
  assert.equal(alvo?.estado, 'encerrado');
  assert.equal(alvo?.motivoEncerramento, 'expulsao');
});

test('último vínculo terminado por expiração marca a Sala como expirada', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, desconectar('jogador-1'));
  const resultado = expirarReconexao(estado, expirar('membro-1'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const sala = resultado.estado.salas[0];
  assert.equal(sala.estado, 'expirada');
  assert.equal(sala.anfitriaoId, null);
  assert.deepEqual(resultado.eventos.map((evento) => evento.tipo), [
    'vinculo_expirado',
    'sala_expirada',
  ]);

  const entrada = entrarNaSala(resultado.estado, entrar('jogador-2', 'membro-2'));
  assert.equal(entrada.sucesso, false);
  if (entrada.sucesso) return;
  assert.equal(entrada.erro.codigo, 'SALA_ENCERRADA');
});

test('sucessão circular pela ordem de entrada quando o vínculo do Anfitrião expira', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-3', 'membro-3'));
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, desconectar('jogador-1'));
  const resultado = expirarReconexao(estado, expirar('membro-1'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(resultado.estado.salas[0].anfitriaoId, 'membro-3');
  assert.equal(resultado.estado.salas[0].estado, 'aberta');
  const sucessao = resultado.eventos.find(
    (evento): evento is Extract<typeof evento, { tipo: 'anfitriao_sucedido' }> =>
      evento.tipo === 'anfitriao_sucedido',
  );
  assert.ok(sucessao);
  assert.equal(sucessao.anfitriaoAnteriorId, 'membro-1');
  assert.equal(sucessao.anfitriaoNovoId, 'membro-3');
});

test('Sala inconsistente rejeita mutações com SALA_INCONSISTENTE até confirmação', () => {
  const base = aplicar(estadoDoLobbyVazio(), criar());
  const estado: EstadoDoLobby = {
    salas: [{ ...base.salas[0], consistente: false }],
  };

  const entrada = entrarNaSala(estado, entrar('jogador-2', 'membro-2'));
  assert.equal(entrada.sucesso, false);
  if (entrada.sucesso) return;
  assert.equal(entrada.erro.codigo, 'SALA_INCONSISTENTE');

  const saida = sairDaSala(estado, sair('jogador-1'));
  assert.equal(saida.sucesso, false);
  if (saida.sucesso) return;
  assert.equal(saida.erro.codigo, 'SALA_INCONSISTENTE');

  const desconexao = desconectarJogador(estado, desconectar('jogador-1'));
  assert.equal(desconexao.sucesso, false);
  if (desconexao.sucesso) return;
  assert.equal(desconexao.erro.codigo, 'SALA_INCONSISTENTE');

  const confirmacao = confirmarConsistenciaDaSala(estado, confirmar());
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.equal(confirmacao.estado.salas[0].consistente, true);
  assert.deepEqual(confirmacao.eventos.map((evento) => evento.tipo), [
    'consistencia_confirmada',
  ]);

  const entradaApos = entrarNaSala(confirmacao.estado, entrar('jogador-2', 'membro-2'));
  assert.equal(entradaApos.sucesso, true);
});

test('confirmar_consistencia_da_sala é idempotente quando a Sala já é consistente', () => {
  const estado = aplicar(estadoDoLobbyVazio(), criar());
  const resultado = confirmarConsistenciaDaSala(estado, confirmar());

  assert.deepEqual(resultado, { sucesso: true, estado, eventos: [] });
});

test('confirmar_consistencia_da_sala em Sala inexistente retorna SALA_NAO_ENCONTRADA', () => {
  const resultado = confirmarConsistenciaDaSala(estadoDoLobbyVazio(), confirmar('sala-fantasma'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'SALA_NAO_ENCONTRADA');
});

test('expulsar_membro rejeita Sala inconsistente com SALA_INCONSISTENTE', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  const inconsistente: EstadoDoLobby = {
    salas: [{ ...estado.salas[0], consistente: false }],
  };

  const resultado = expulsarMembro(inconsistente, expulsar('membro-1', 'membro-2'));
  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'SALA_INCONSISTENTE');
});

test('autorizar_retorno rejeita Sala inconsistente com SALA_INCONSISTENTE', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, expulsar('membro-1', 'membro-2'));
  const inconsistente: EstadoDoLobby = {
    salas: [{ ...estado.salas[0], consistente: false }],
  };

  const resultado = autorizarRetorno(inconsistente, autorizar('membro-1', 'jogador-2'));
  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'SALA_INCONSISTENTE');
});

test('expirar_reconexao rejeita Sala inconsistente com SALA_INCONSISTENTE', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, desconectar('jogador-1'));
  const inconsistente: EstadoDoLobby = {
    salas: [{ ...estado.salas[0], consistente: false }],
  };

  const resultado = expirarReconexao(inconsistente, expirar('membro-1'));
  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'SALA_INCONSISTENTE');
});

test('registrar_reinicio_da_sala torna a Sala inconsistente e membros ativos reaparecem desconectados e não prontos', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  const antes = estado;

  const resultado = registrarReinicioDaSala(estado, registrarReinicio());
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;

  const sala = resultado.estado.salas[0];
  assert.equal(sala.consistente, false);
  for (const membro of sala.membros) {
    assert.equal(membro.estado, 'ativo');
    assert.equal(membro.presenca, 'em_reconexao');
    assert.equal(membro.pronto, false);
    assert.equal(membro.motivoEncerramento, null);
  }
  assert.deepEqual(resultado.eventos, [
    { tipo: 'reinicio_registrado', salaId: 'sala-1' },
  ]);

  // Membros encerrados permanecem intactos.
  const comEncerrado = aplicar(antes, sair('jogador-2'));
  const reinicioComEncerrado = registrarReinicioDaSala(comEncerrado, registrarReinicio());
  assert.equal(reinicioComEncerrado.sucesso, true);
  if (!reinicioComEncerrado.sucesso) return;
  const encerrado = reinicioComEncerrado.estado.salas[0].membros.find(
    (membro) => membro.jogadorId === 'jogador-2',
  );
  assert.ok(encerrado);
  assert.equal(encerrado.estado, 'encerrado');
  assert.equal(encerrado.motivoEncerramento, 'saida');

  // Mutações ficam bloqueadas enquanto a Sala estiver inconsistente.
  const entrada = entrarNaSala(resultado.estado, entrar('jogador-3', 'membro-3'));
  assert.equal(entrada.sucesso, false);
  if (entrada.sucesso) return;
  assert.equal(entrada.erro.codigo, 'SALA_INCONSISTENTE');

  const desconexao = desconectarJogador(resultado.estado, desconectar('jogador-1'));
  assert.equal(desconexao.sucesso, false);
  if (desconexao.sucesso) return;
  assert.equal(desconexao.erro.codigo, 'SALA_INCONSISTENTE');

  // Confirmar consistência restaura as mutações; reconexão volta a funcionar
  // porque o vínculo ativo existe mas a presença não é observada pós-reinício.
  const confirmacao = confirmarConsistenciaDaSala(resultado.estado, confirmar());
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.equal(confirmacao.estado.salas[0].consistente, true);

  const reconexao = reconectarJogador(confirmacao.estado, reconectar('jogador-1'));
  assert.equal(reconexao.sucesso, true);
  if (!reconexao.sucesso) return;
  const membroReconectado = reconexao.estado.salas[0].membros[0];
  assert.equal(membroReconectado.presenca, 'conectado');

  const entradaApos = entrarNaSala(confirmacao.estado, entrar('jogador-3', 'membro-3'));
  assert.equal(entradaApos.sucesso, true);
});

test('registrar_reinicio_da_sala é idempotente quando a Sala já está inconsistente', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, registrarReinicio());

  const resultado = registrarReinicioDaSala(estado, registrarReinicio());

  assert.deepEqual(resultado, { sucesso: true, estado, eventos: [] });
});

test('registrar_reinicio_da_sala em Sala inexistente retorna SALA_NAO_ENCONTRADA', () => {
  const resultado = registrarReinicioDaSala(estadoDoLobbyVazio(), registrarReinicio('sala-fantasma'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'SALA_NAO_ENCONTRADA');
});
