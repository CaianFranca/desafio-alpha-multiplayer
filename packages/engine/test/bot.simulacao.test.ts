import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estadoInicialDaPartida,
  executarTurnoDoBot,
  type EstadoDaPartida,
  type JogadorDaPartida,
} from '../src/index.ts';

// Camada Unit/Simulation pura: executa partidas 100% com bots sem I/O, rede ou banco.
// Ideal para CI/CD, testes de regressão rápida e validação de invariantes.

const JOGADORES_SIMULACAO = ['bot-1', 'bot-2', 'bot-3', 'bot-4'] as const;

test('Camada Unit/Simulation: 4 bots jogam múltiplos turnos sucessivos deterministicamente', () => {
  const init = estadoInicialDaPartida(JOGADORES_SIMULACAO, { seed: 42 });
  assert.equal(init.sucesso, true);
  if (!init.sucesso) throw new Error('Falha ao inicializar');
  let estado: EstadoDaPartida = init.estado;

  assert.equal(estado.jogadores.length, 4);
  assert.equal(estado.resultado, null);

  let turnosExecutados = 0;
  const MAX_TURNOS_SIMULACAO = 24;

  while (turnosExecutados < MAX_TURNOS_SIMULACAO && estado.resultado === null) {
    const jogadorAtivo = estado.jogadorAtivoId;
    assert.ok(jogadorAtivo, 'deve haver um jogador ativo enquanto a partida não termina');

    const resultadoTurno = executarTurnoDoBot(estado, jogadorAtivo);
    assert.ok(
      resultadoTurno.acoesExecutadas.length > 0,
      `bot ${jogadorAtivo} executou ao menos uma ação no turno ${turnosExecutados + 1}`,
    );

    estado = resultadoTurno.estado;
    turnosExecutados++;
  }

  assert.ok(turnosExecutados > 4, 'a simulação deve avançar além da primeira rodada');
  // Verifica se o estado permanece íntegro
  assert.ok(estado.tabuleiro.posicionadas.length >= 4, 'ao menos as peças iniciais devem estar posicionadas');
});
