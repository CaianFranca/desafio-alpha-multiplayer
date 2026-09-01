import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aplicarComando,
  estadoDoLobbyVazio,
  type EstadoDoLobby,
  type Comando,
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

const alternar = (jogadorId: string, salaId = 'sala-1') =>
  ({ tipo: 'alternar_prontidao', salaId, jogadorId } as const);

const aceitar = (salaId = 'sala-1') =>
  ({ tipo: 'aceitar_encaminhamento', salaId } as const);

const reabrir = (salaId = 'sala-1') =>
  ({ tipo: 'reabrir_sala', salaId } as const);

function aplicar(estado: EstadoDoLobby, comando: Comando): EstadoDoLobby {
  const resultado = aplicarComando(estado, comando);
  if (!resultado.sucesso) {
    throw new Error(`${resultado.erro.codigo}: ${resultado.erro.mensagem}`);
  }
  return resultado.estado;
}

function codigoDaRejeicao(estado: EstadoDoLobby, comando: Comando): string {
  const resultado = aplicarComando(estado, comando);
  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return '';
  return resultado.erro.codigo;
}

function salaComQuatroProntos(): EstadoDoLobby {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, entrar('jogador-3', 'membro-3'));
  estado = aplicar(estado, entrar('jogador-4', 'membro-4'));
  estado = aplicar(estado, alternar('jogador-1'));
  estado = aplicar(estado, alternar('jogador-2'));
  estado = aplicar(estado, alternar('jogador-3'));
  return aplicar(estado, alternar('jogador-4'));
}

test('reabrir_sala transiciona encaminhada → aberta com sala_reaberta', () => {
  const encaminhada = aplicar(salaComQuatroProntos(), aceitar());
  assert.equal(encaminhada.salas[0].estado, 'encaminhada');

  const resultado = aplicarComando(encaminhada, reabrir());
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(resultado.estado.salas[0].estado, 'aberta');
  assert.deepEqual(resultado.eventos, [{ tipo: 'sala_reaberta', salaId: 'sala-1' }]);
});

test('reabrir_sala reseta Prontidão mas preserva ordem, Anfitrião e presença', () => {
  const encaminhada = aplicar(salaComQuatroProntos(), aceitar());
  // marcar presença em_reconexao em um membro para garantir que não é alterada
  const comDesconexao = aplicar(encaminhada, {
    tipo: 'desconectar_jogador',
    salaId: 'sala-1',
    jogadorId: 'jogador-2',
  } as const);
  // presença agora em_reconexao
  const antes = comDesconexao.salas[0];

  const resultado = aplicarComando(comDesconexao, reabrir());
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const sala = resultado.estado.salas[0];
  // preserva id, codigo, proximaOrdemDeEntrada, anfitriaoId
  assert.equal(sala.id, antes.id);
  assert.equal(sala.codigo, antes.codigo);
  assert.equal(sala.proximaOrdemDeEntrada, antes.proximaOrdemDeEntrada);
  assert.equal(sala.anfitriaoId, antes.anfitriaoId);
  assert.deepEqual(sala.jogadoresBloqueados, antes.jogadoresBloqueados);
  // ordem preservada
  assert.deepEqual(
    sala.membros.map((m) => m.ordemDeEntrada),
    antes.membros.map((m) => m.ordemDeEntrada),
  );
  // todos pronto false
  for (const m of sala.membros) {
    if (m.estado === 'ativo') assert.equal(m.pronto, false);
  }
  // presença inalterada
  const membro2Antes = antes.membros.find((m) => m.jogadorId === 'jogador-2')!;
  const membro2Depois = sala.membros.find((m) => m.jogadorId === 'jogador-2')!;
  assert.equal(membro2Depois.presenca, membro2Antes.presenca);
  // anfitrião ainda membro-1
  assert.equal(sala.anfitriaoId, 'membro-1');
});

test('reabrir_sala rejeita quando Sala não está encaminhada', () => {
  const aberta = salaComQuatroProntos();
  assert.equal(codigoDaRejeicao(aberta, reabrir()), 'SALA_NAO_ENCAMINHADA');

  const encerrada = aplicar(aplicar(estadoDoLobbyVazio(), criar()), {
    tipo: 'sair_da_sala',
    salaId: 'sala-1',
    jogadorId: 'jogador-1',
  } as const);
  assert.equal(codigoDaRejeicao(encerrada, reabrir()), 'SALA_NAO_ENCAMINHADA');
});

test('reabrir_sala rejeita Sala inexistente e Sala inconsistente', () => {
  assert.equal(codigoDaRejeicao(estadoDoLobbyVazio(), reabrir('sala-fantasma')), 'SALA_NAO_ENCONTRADA');

  const base = salaComQuatroProntos();
  const inconsistente: EstadoDoLobby = {
    salas: [{ ...base.salas[0], consistente: false }],
  };
  assert.equal(codigoDaRejeicao(inconsistente, reabrir()), 'SALA_INCONSISTENTE');
});

test('reabrir_sala rejeita DADOS_INVALIDOS quando salaId vazio', () => {
  const encaminhada = aplicar(salaComQuatroProntos(), aceitar());
  const resultado = aplicarComando(encaminhada, { tipo: 'reabrir_sala', salaId: '' } as const);
  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'DADOS_INVALIDOS');
});

test('após reabertura, Sala volta a aceitar ALTERNAR_PRONTIDAO e permanece mutável', () => {
  const encaminhada = aplicar(salaComQuatroProntos(), aceitar());
  const reaberta = aplicar(encaminhada, reabrir());
  assert.equal(reaberta.salas[0].estado, 'aberta');
  // deve aceitar alternar
  const alternado = aplicarComando(reaberta, alternar('jogador-1'));
  assert.equal(alternado.sucesso, true);
  if (!alternado.sucesso) return;
  assert.equal(alternado.estado.salas[0].membros[0].pronto, true);
});

test('Sala reaberta preserva jogadoresBloqueados e não altera proximaOrdemDeEntrada', () => {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  estado = aplicar(estado, entrar('jogador-2', 'membro-2'));
  estado = aplicar(estado, entrar('jogador-3', 'membro-3'));
  estado = aplicar(estado, entrar('jogador-4', 'membro-4'));
  // expulsar um para gerar bloqueado, depois autorizar retorno, depois criar 4 novamente
  // simplificar: criar sala com bloqueado via expulsão manual no estado
  const base = salaComQuatroProntos();
  const comBloqueado: EstadoDoLobby = {
    salas: [
      {
        ...base.salas[0],
        jogadoresBloqueados: ['jogador-expulso'],
        proximaOrdemDeEntrada: 10,
      },
    ],
  };
  const encaminhada = aplicar(comBloqueado, aceitar());
  const resultado = aplicarComando(encaminhada, reabrir());
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.deepEqual(resultado.estado.salas[0].jogadoresBloqueados, ['jogador-expulso']);
  assert.equal(resultado.estado.salas[0].proximaOrdemDeEntrada, 10);
});
