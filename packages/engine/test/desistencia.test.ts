import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aplicarComandoDePartida,
  estadoInicialDaPartida,
  type CodigoDeErroDaPartida,
  type ComandoDePartida,
  type EstadoDaPartida,
  type EventoDaPartida,
  type Orientacao,
  type PecaPosicionada,
  type TipoDaPeca,
} from '../src/index.ts';

const desistir = () => ({ tipo: 'desistir_da_partida' } as const);

function aplicar(
  estado: EstadoDaPartida,
  comando: ComandoDePartida,
  ator: string,
): { estado: EstadoDaPartida; eventos: readonly EventoDaPartida[] } {
  const resultado = aplicarComandoDePartida(estado, comando, ator);
  if (!resultado.sucesso) {
    throw new Error(`${resultado.erro.codigo}: ${resultado.erro.mensagem}`);
  }
  return { estado: resultado.estado, eventos: resultado.eventos };
}

function codigoDaRejeicao(
  estado: EstadoDaPartida,
  comando: ComandoDePartida,
  ator: string,
): CodigoDeErroDaPartida {
  const resultado = aplicarComandoDePartida(estado, comando, ator);
  assert.equal(resultado.sucesso, false, 'esperava uma rejeição de domínio');
  if (resultado.sucesso) {
    throw new Error('inacessível');
  }
  return resultado.erro.codigo;
}

function partidaIniciadaCom(roster: readonly string[]): EstadoDaPartida {
  const resultado = estadoInicialDaPartida(roster);
  if (!resultado.sucesso) {
    throw new Error('roster válido deveria iniciar a Partida');
  }
  return resultado.estado;
}

const peca = (
  pecaId: string,
  tipo: TipoDaPeca,
  linha: number,
  coluna: number,
  orientacao: Orientacao = 0,
): PecaPosicionada => ({
  pecaId,
  tipo,
  orientacao,
  celula: { linha, coluna },
});

// Estado montado diretamente (padrão dos testes de término/iluminação): os
// peões seguem a ordem do roster (null → Mesa) e o Primeiro Turno já foi
// concluído; a Caixa base (cheia) é preservada para não acionar a derrota
// contável.
function estadoMontado(
  opcoes: {
    readonly posicionadas: readonly PecaPosicionada[];
    readonly peoesSobre: readonly (string | null)[];
    readonly jogadorAtivoId?: string;
    readonly rodada?: number;
    readonly geradoresLigados?: readonly string[];
    readonly cartaoDeAcessoObtido?: boolean;
    readonly peoesNoAlcance?: Readonly<Record<string, readonly string[]>>;
  },
  roster: readonly string[],
): EstadoDaPartida {
  const base = partidaIniciadaCom(roster);
  return {
    ...base,
    jogadorAtivoId: opcoes.jogadorAtivoId ?? roster[0],
    rodada: opcoes.rodada ?? 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    atravessouNoTurno: false,
    celulasIluminadas: [],
    resultado: null,
    geradoresLigados: opcoes.geradoresLigados ?? [],
    cartaoDeAcessoObtido: opcoes.cartaoDeAcessoObtido ?? false,
    peoesNoAlcance: opcoes.peoesNoAlcance ?? {},
    pecasEmPeriodoDeGraca: [],
    jogadores: base.jogadores.map((jogador) => ({
      ...jogador,
      primeiroTurnoPendente: false,
    })),
    tabuleiro: {
      ...base.tabuleiro,
      posicionadas: opcoes.posicionadas,
      peoes: base.tabuleiro.peoes.map((peao, indice) => ({
        ...peao,
        pecaId: opcoes.peoesSobre[indice] ?? null,
      })),
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      recebidas: [],
    },
  };
}

// Critério 1: desistir fora do próprio turno remove peão/vez e o jogo
// continua com N−1.
test('desistencia fora do turno remove peao e vez; o jogo continua com N-1', () => {
  const estado = partidaIniciadaCom(['ana', 'bruno', 'carla', 'diogo']);
  const { estado: apos, eventos } = aplicar(estado, desistir(), 'bruno');

  assert.equal(apos.jogadores.length, 3);
  assert.ok(!apos.jogadores.some((jogador) => jogador.jogadorId === 'bruno'));
  assert.ok(
    !apos.tabuleiro.peoes.some((peao) => peao.peaoId === 'peao-vermelho'),
  );
  // A vez do Ativo vigente fica intacta.
  assert.equal(apos.jogadorAtivoId, 'ana');
  assert.equal(apos.rodada, 1);
  assert.equal(apos.resultado, null);
  assert.equal(eventos[0].tipo, 'desistencia_registrada');
  assert.equal(
    eventos[0].tipo === 'desistencia_registrada'
      ? eventos[0].jogadorId
      : undefined,
    'bruno',
  );
  // Sem Passagem: nenhum turno é encerrado ou iniciado.
  assert.ok(!eventos.some((evento) => evento.tipo === 'turno_encerrado'));
  assert.ok(!eventos.some((evento) => evento.tipo === 'turno_iniciado'));
});

// Critério 2: desistir sendo o Jogador Ativo destrava o turno (Passagem
// imediata ao seguinte na ordem).
test('desistencia do ativo passa a vez imediata ao seguinte na ordem', () => {
  const estado = partidaIniciadaCom(['ana', 'bruno', 'carla']);
  const { estado: apos, eventos } = aplicar(estado, desistir(), 'ana');

  assert.equal(apos.jogadores.length, 2);
  assert.equal(apos.jogadorAtivoId, 'bruno');
  assert.equal(apos.rodada, 1);
  assert.ok(!apos.tabuleiro.peoes.some((peao) => peao.peaoId === 'peao-branco'));
  const tipos = eventos.map((evento) => evento.tipo);
  assert.equal(tipos[0], 'desistencia_registrada');
  assert.ok(tipos.includes('turno_encerrado'));
  assert.ok(tipos.includes('turno_iniciado'));
  const iniciado = eventos.find((evento) => evento.tipo === 'turno_iniciado');
  assert.ok(iniciado && iniciado.tipo === 'turno_iniciado');
  assert.equal(iniciado.jogadorId, 'bruno');
  assert.equal(iniciado.rodada, 1);
});

// A Passagem ancorada no índice removido abre nova rodada quando o desistente
// era o último da ordem.
test('desistencia do ultimo da ordem abre nova rodada no seguinte', () => {
  const estado = estadoMontado(
    { posicionadas: [], peoesSobre: [null, null, null] },
    ['ana', 'bruno', 'carla'],
  );
  const comAtivoNoFim: EstadoDaPartida = {
    ...estado,
    jogadorAtivoId: 'carla',
    rodada: 1,
  };
  const { estado: apos } = aplicar(comAtivoNoFim, desistir(), 'carla');

  assert.equal(apos.jogadorAtivoId, 'ana');
  assert.equal(apos.rodada, 2);
});

// Critério 3: peças que só o desistente iluminava caem pela Limpeza no ato;
// as iluminadas pelos restantes ficam.
test('limpeza no ato remove so o que o desistente iluminava', () => {
  // Peões: ana (branco) em (4,4), bruno (vermelho) em (0,0), carla (azul) em
  // (4,5). A peça (0,2) só é iluminada por bruno; a peça (3,4) segue
  // iluminada por ana.
  const posicionadas = [
    peca('peca-ana', 'reta', 4, 4),
    peca('peca-bruno', 'reta', 0, 0),
    peca('peca-carla', 'reta', 4, 5),
    peca('peca-so-bruno', 'reta', 0, 2),
    peca('peca-iluminada', 'reta', 3, 4),
  ];
  const estado = estadoMontado(
    {
      posicionadas,
      peoesSobre: ['peca-ana', 'peca-bruno', 'peca-carla'],
    },
    ['ana', 'bruno', 'carla'],
  );
  const { estado: apos, eventos } = aplicar(estado, desistir(), 'bruno');

  const ids = apos.tabuleiro.posicionadas.map((item) => item.pecaId);
  assert.ok(!ids.includes('peca-so-bruno'));
  assert.ok(!ids.includes('peca-bruno'));
  assert.ok(ids.includes('peca-ana'));
  assert.ok(ids.includes('peca-carla'));
  assert.ok(ids.includes('peca-iluminada'));
  const limpeza = eventos.find(
    (evento) => evento.tipo === 'limpeza_aplicada',
  );
  assert.ok(limpeza && limpeza.tipo === 'limpeza_aplicada', 'esperava limpeza_aplicada no ato');
  assert.ok(limpeza.pecasRemovidas.includes('peca-so-bruno'));
  // O snapshot do Alcance poda o peão do desistente.
  assert.ok(
    Object.values(apos.peoesNoAlcance).every(
      (peaoIds) => !peaoIds.includes('peao-vermelho'),
    ),
  );
});

// Critério 4a: N=4→3 continua e vence com N−1 peões no Portão (+ 3 Geradores
// + Cartão).
test('4 para 3 vence com os 3 peoes no portao mais objetivos', () => {
  const posicionadas = [
    peca('portao-1', 'portao_de_saida', 3, 3),
    peca('fora-do-portao', 'reta', 0, 0),
  ];
  const estado = estadoMontado(
    {
      posicionadas,
      peoesSobre: ['portao-1', 'portao-1', 'portao-1', 'fora-do-portao'],
      geradoresLigados: ['g1', 'g2', 'g3'],
      cartaoDeAcessoObtido: true,
    },
    ['ana', 'bruno', 'carla', 'diogo'],
  );
  const resultado = aplicarComandoDePartida(estado, desistir(), 'diogo');
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) {
    throw new Error('inacessível');
  }
  assert.deepEqual(resultado.estado.resultado, { tipo: 'vitoria' });
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo.tipo, 'partida_terminada');
  assert.ok(ultimo.tipo === 'partida_terminada');
  assert.deepEqual(ultimo.desfecho, { tipo: 'vitoria' });
});

// Critério 4b: N=3→2 continua e vence com N−1 peões no Portão.
test('3 para 2 vence com os 2 peoes no portao mais objetivos', () => {
  const posicionadas = [
    peca('portao-1', 'portao_de_saida', 3, 3),
    peca('fora-do-portao', 'reta', 0, 0),
  ];
  const estado = estadoMontado(
    {
      posicionadas,
      peoesSobre: ['portao-1', 'portao-1', 'fora-do-portao'],
      geradoresLigados: ['g1', 'g2', 'g3'],
      cartaoDeAcessoObtido: true,
    },
    ['ana', 'bruno', 'carla'],
  );
  const resultado = aplicarComandoDePartida(estado, desistir(), 'carla');
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) {
    throw new Error('inacessível');
  }
  assert.deepEqual(resultado.estado.resultado, { tipo: 'vitoria' });
});

// Critério 5a: N=2→1 termina em derrota por desistência — mesmo com os
// objetivos completos e o restante no Portão (o quórum precede a vitória).
test('2 para 1 termina em derrota por desistencia', () => {
  const posicionadas = [
    peca('portao-1', 'portao_de_saida', 3, 3),
    peca('fora-do-portao', 'reta', 0, 0),
  ];
  const estado = estadoMontado(
    {
      posicionadas,
      peoesSobre: ['portao-1', 'fora-do-portao'],
      geradoresLigados: ['g1', 'g2', 'g3'],
      cartaoDeAcessoObtido: true,
    },
    ['ana', 'bruno'],
  );
  const resultado = aplicarComandoDePartida(estado, desistir(), 'bruno');
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) {
    throw new Error('inacessível');
  }
  assert.deepEqual(resultado.estado.resultado, {
    tipo: 'derrota',
    motivo: 'desistencia',
  });
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo.tipo, 'partida_terminada');
});

// A derrota do quórum também vale quando o desistente era o Ativo (com
// Passagem imediata antes do término).
test('2 para 1 com o ativo desistindo passa a vez e termina em derrota', () => {
  const estado = partidaIniciadaCom(['ana', 'bruno']);
  const resultado = aplicarComandoDePartida(estado, desistir(), 'ana');
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) {
    throw new Error('inacessível');
  }
  assert.deepEqual(resultado.estado.resultado, {
    tipo: 'derrota',
    motivo: 'desistencia',
  });
  const tipos = resultado.eventos.map((evento) => evento.tipo);
  assert.deepEqual(tipos, [
    'desistencia_registrada',
    'turno_encerrado',
    'turno_iniciado',
    'partida_terminada',
  ]);
});

// Critério 5b: desistência de quem já saiu ou de fora da partida é recusada;
// após o término, qualquer comando é PARTIDA_TERMINADA.
test('desistencia de fora do roster e recusada; pos-termino e terminada', () => {
  const estado = partidaIniciadaCom(['ana', 'bruno', 'carla']);
  assert.equal(
    codigoDaRejeicao(estado, desistir(), 'ze'),
    'JOGADOR_NAO_NA_PARTIDA',
  );
  const { estado: aposUma } = aplicar(estado, desistir(), 'bruno');
  assert.equal(
    codigoDaRejeicao(aposUma, desistir(), 'bruno'),
    'JOGADOR_NAO_NA_PARTIDA',
  );

  const duelo = partidaIniciadaCom(['ana', 'bruno']);
  const fim = aplicar(duelo, desistir(), 'bruno');
  assert.deepEqual(fim.estado.resultado, {
    tipo: 'derrota',
    motivo: 'desistencia',
  });
  assert.equal(
    codigoDaRejeicao(fim.estado, desistir(), 'ana'),
    'PARTIDA_TERMINADA',
  );
  assert.equal(
    codigoDaRejeicao(fim.estado, { tipo: 'encerrar_turno' }, 'ana'),
    'PARTIDA_TERMINADA',
  );
});
