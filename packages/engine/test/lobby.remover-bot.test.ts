import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aplicarComando,
  estadoDoLobbyVazio,
  type EstadoDoLobby,
  type Comando,
} from '../src/index.ts';

// Remoção de bot efêmero pelo Anfitrião (`remover_bot_da_sala`): sai sem
// bloquear (bots não são Jogadores) — o chamador purga o Cadastro em seguida.

const criar = (salaId = 'sala-1', jogadorId = 'jogador-1', membroId = 'membro-1') =>
  ({
    tipo: 'criar_sala',
    salaId,
    codigo: 'ABC123',
    jogadorId,
    membroId,
  } as const);

const entrar = (jogadorId: string, membroId: string, salaId = 'sala-1') =>
  ({ tipo: 'entrar_na_sala', salaId, jogadorId, membroId } as const);

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

function salaComBot(): EstadoDoLobby {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  return aplicar(estado, entrar('jogador-bot', 'membro-bot'));
}

test('remover_bot_da_sala encerra o vínculo sem bloquear e emite ehBot', () => {
  const resultado = aplicarComando(salaComBot(), {
    tipo: 'remover_bot_da_sala',
    salaId: 'sala-1',
    anfitriaoMembroId: 'membro-1',
    membroAlvoId: 'membro-bot',
  });
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const sala = resultado.estado.salas[0]!;
  assert.deepEqual(sala.jogadoresBloqueados, []);
  const alvo = sala.membros.find((m) => m.id === 'membro-bot')!;
  assert.equal(alvo.estado, 'encerrado');
  assert.equal(alvo.motivoEncerramento, 'expulsao');
  assert.deepEqual(resultado.eventos, [
    {
      tipo: 'membro_expulsado',
      salaId: 'sala-1',
      membroId: 'membro-bot',
      jogadorId: 'jogador-bot',
      ordemDeEntrada: alvo.ordemDeEntrada,
      motivo: 'expulsao',
      ehBot: true,
    },
  ]);
});

test('expulsar_membro segue bloqueando jogador humano (controle)', () => {
  const resultado = aplicarComando(salaComBot(), {
    tipo: 'expulsar_membro',
    salaId: 'sala-1',
    anfitriaoMembroId: 'membro-1',
    membroAlvoId: 'membro-bot',
  });
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.deepEqual(resultado.estado.salas[0]!.jogadoresBloqueados, ['jogador-bot']);
});

test('bot removido pode reentrar (não bloqueado)', () => {
  const semBot = aplicar(salaComBot(), {
    tipo: 'remover_bot_da_sala',
    salaId: 'sala-1',
    anfitriaoMembroId: 'membro-1',
    membroAlvoId: 'membro-bot',
  });
  const reentrou = aplicar(semBot, entrar('jogador-bot', 'membro-bot-2'));
  const ativos = reentrou.salas[0]!.membros.filter((m) => m.estado === 'ativo');
  assert.ok(ativos.some((m) => m.jogadorId === 'jogador-bot'));
});

test('remover_bot_da_sala exige Anfitrião e recusa auto-remoção', () => {
  const estado = salaComBot();
  assert.equal(
    codigoDaRejeicao(estado, {
      tipo: 'remover_bot_da_sala',
      salaId: 'sala-1',
      anfitriaoMembroId: 'membro-bot',
      membroAlvoId: 'membro-1',
    }),
    'APENAS_ANFITRIAO',
  );
  assert.equal(
    codigoDaRejeicao(estado, {
      tipo: 'remover_bot_da_sala',
      salaId: 'sala-1',
      anfitriaoMembroId: 'membro-1',
      membroAlvoId: 'membro-1',
    }),
    'APENAS_ANFITRIAO',
  );
});

test('remover_bot_da_sala recusa alvo fora da Sala', () => {
  assert.equal(
    codigoDaRejeicao(salaComBot(), {
      tipo: 'remover_bot_da_sala',
      salaId: 'sala-1',
      anfitriaoMembroId: 'membro-1',
      membroAlvoId: 'membro-inexistente',
    }),
    'MEMBRO_NAO_ENCONTRADO',
  );
});
