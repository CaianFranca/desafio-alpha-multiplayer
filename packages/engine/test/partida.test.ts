import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aplicarComandoDePartida,
  estadoInicialDaPartida,
  type ComandoDePartida,
  type CodigoDeErroDaPartida,
  type EstadoDaPartida,
  type TipoDePecaDeCaminho,
} from '../src/index.ts';

const selecionarPeca = (pecaId: string) =>
  ({ tipo: 'selecionar_peca', pecaId } as const);

const girarPeca = (pecaId: string) =>
  ({ tipo: 'girar_peca', pecaId, sentido: 'horario' } as const);

const posicionarPeca = (pecaId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peca', pecaId, celula: { linha, coluna } } as const);

const selecionarPeao = (peaoId: string) =>
  ({ tipo: 'selecionar_peao', peaoId } as const);

const posicionarPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peao', peaoId, celula: { linha, coluna } } as const);

const escolherTipo = (recebidaId: string, tipoDaPeca: TipoDePecaDeCaminho) =>
  ({ tipo: 'escolher_tipo_da_peca_recebida', recebidaId, tipoDaPeca } as const);

const moverPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'mover_peao', peaoId, celula: { linha, coluna } } as const);

const permanecer = (peaoId: string) =>
  ({ tipo: 'permanecer', peaoId } as const);

const confirmarPosicao = (peaoId: string) =>
  ({ tipo: 'confirmar_posicao_do_peao', peaoId } as const);

const encerrarTurno = () => ({ tipo: 'encerrar_turno' } as const);

function aplicar(
  estado: EstadoDaPartida,
  comando: ComandoDePartida,
  ator: string,
): EstadoDaPartida {
  const resultado = aplicarComandoDePartida(estado, comando, ator);
  if (!resultado.sucesso) {
    throw new Error(`${resultado.erro.codigo}: ${resultado.erro.mensagem}`);
  }
  return resultado.estado;
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

const JOGADORES = ['ana', 'bruno', 'carla', 'diogo'];

function partidaIniciada(): EstadoDaPartida {
  const resultado = estadoInicialDaPartida(JOGADORES);
  if (!resultado.sucesso) {
    throw new Error('roster válido deveria iniciar a Partida');
  }
  return resultado.estado;
}

const jogadorAtivo = (estado: EstadoDaPartida) => {
  const jogador = estado.jogadores.find(
    (item) => item.jogadorId === estado.jogadorAtivoId,
  );
  if (!jogador) {
    throw new Error('Partida sem Jogador Ativo');
  }
  return jogador;
};

// Resolve todas as pendências do Recebimento do Peão selecionado: escolhe o
// tipo na Reserva e encaixa cada Recebida na célula-alvo fixada.
function resolverRecebidas(
  estado: EstadoDaPartida,
  ator: string,
  tipoDaPeca: TipoDePecaDeCaminho = 'reta',
): EstadoDaPartida {
  while (estado.tabuleiro.recebidas.length > 0) {
    const pendente = estado.tabuleiro.recebidas[0];
    estado = aplicar(estado, escolherTipo(pendente.recebidaId, tipoDaPeca), ator);
    const escolhida = estado.tabuleiro.recebidas.find(
      (item) => item.recebidaId === pendente.recebidaId,
    );
    if (!escolhida || escolhida.pecaId === null) {
      throw new Error('Recebida escolhida deveria ter Peça atribuída');
    }
    estado = aplicar(
      estado,
      posicionarPeca(
        escolhida.pecaId,
        escolhida.celulaAlvo.linha,
        escolhida.celulaAlvo.coluna,
      ),
      ator,
    );
  }
  return estado;
}

// Primeiro Turno completo do Jogador Ativo: Peça Inicial própria (com giros
// opcionais), Peão sobre ela, Recebimento automático resolvido e
// Encerramento do Turno.
function concluirPrimeiroTurno(
  estado: EstadoDaPartida,
  celula: { linha: number; coluna: number },
  giros = 0,
): EstadoDaPartida {
  const ator = estado.jogadorAtivoId;
  const jogador = jogadorAtivo(estado);
  const pecaId = `inicial-${jogador.ordem}`;
  estado = aplicar(estado, selecionarPeca(pecaId), ator);
  for (let giro = 0; giro < giros; giro++) {
    estado = aplicar(estado, girarPeca(pecaId), ator);
  }
  estado = aplicar(estado, posicionarPeca(pecaId, celula.linha, celula.coluna), ator);
  estado = aplicar(estado, selecionarPeao(jogador.peaoId), ator);
  estado = aplicar(
    estado,
    posicionarPeao(jogador.peaoId, celula.linha, celula.coluna),
    ator,
  );
  estado = resolverRecebidas(estado, ator);
  return aplicar(estado, encerrarTurno(), ator);
}

// Partida com os quatro Primeiros Turnos concluídos: a vez voltou ao primeiro
// Jogador, agora em turno normal (rodada 2).
function partidaEmRodada2(): EstadoDaPartida {
  let estado = partidaIniciada();
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 6 });
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 0 });
  return estado;
}

test('estadoInicialDaPartida monta o roster, a vez e o evento de abertura', () => {
  const resultado = estadoInicialDaPartida(JOGADORES);
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;

  const estado = resultado.estado;
  assert.deepEqual(estado.jogadores, [
    { jogadorId: 'ana', ordem: 1, cor: 'branco', peaoId: 'peao-branco', primeiroTurnoPendente: true },
    { jogadorId: 'bruno', ordem: 2, cor: 'vermelho', peaoId: 'peao-vermelho', primeiroTurnoPendente: true },
    { jogadorId: 'carla', ordem: 3, cor: 'azul', peaoId: 'peao-azul', primeiroTurnoPendente: true },
    { jogadorId: 'diogo', ordem: 4, cor: 'amarelo', peaoId: 'peao-amarelo', primeiroTurnoPendente: true },
  ]);
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.rodada, 1);
  assert.equal(estado.pecaDoInicioDoTurnoId, null);
  assert.equal(estado.posicaoConfirmada, false);
  assert.equal(estado.tabuleiro.reserva.length, 22);
  assert.equal(estado.tabuleiro.peoes.length, 4);
  assert.deepEqual(resultado.eventos, [
    { tipo: 'turno_iniciado', jogadorId: 'ana', rodada: 1 },
  ]);
});

test('estadoInicialDaPartida rejeita rosters com quantidade, duplicidade ou id inválido', () => {
  assert.equal(estadoInicialDaPartida(['ana', 'bruno', 'carla']).sucesso, false);
  assert.equal(
    estadoInicialDaPartida(['ana', 'bruno', 'carla', 'diogo', 'extra']).sucesso,
    false,
  );
  const duplicado = estadoInicialDaPartida(['ana', 'bruno', 'ana', 'diogo']);
  assert.equal(duplicado.sucesso, false);
  if (!duplicado.sucesso) {
    assert.equal(duplicado.erro.codigo, 'DADOS_INVALIDOS');
  }
  const vazio = estadoInicialDaPartida(['ana', 'bruno', 'carla', '   ']);
  assert.equal(vazio.sucesso, false);
  if (!vazio.sucesso) {
    assert.equal(vazio.erro.codigo, 'DADOS_INVALIDOS');
  }
});

test('primeiro turno: Peça Inicial própria, Peão com Recebimento automático e Passagem de Vez', () => {
  let estado = partidaIniciada();

  const encaixeDoPeao = aplicarComandoDePartida(
    aplicar(
      aplicar(
        aplicar(estado, selecionarPeca('inicial-1'), 'ana'),
        posicionarPeca('inicial-1', 3, 3),
        'ana',
      ),
      selecionarPeao('peao-branco'),
      'ana',
    ),
    posicionarPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(encaixeDoPeao.sucesso, true);
  if (!encaixeDoPeao.sucesso) return;
  // O encaixe gera o Recebimento automaticamente (norte e leste vazias) e o
  // Peão segue selecionado para a sequência.
  assert.deepEqual(encaixeDoPeao.eventos, [
    {
      tipo: 'peao_posicionado',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    },
    {
      tipo: 'recebimento_gerado',
      recebidas: [
        { recebidaId: 'recebida-inicial-1-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
        { recebidaId: 'recebida-inicial-1-leste', bordaGeradora: 'leste', celulaAlvo: { linha: 3, coluna: 4 } },
      ],
    },
  ]);
  assert.equal(encaixeDoPeao.estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
  assert.equal(encaixeDoPeao.estado.tabuleiro.recebidas.length, 2);
  estado = encaixeDoPeao.estado;

  estado = resolverRecebidas(estado, 'ana');
  assert.equal(estado.tabuleiro.recebidas.length, 0);

  const encerramento = aplicarComandoDePartida(estado, encerrarTurno(), 'ana');
  assert.equal(encerramento.sucesso, true);
  if (!encerramento.sucesso) return;
  assert.deepEqual(encerramento.eventos, [
    { tipo: 'turno_encerrado', jogadorId: 'ana' },
    { tipo: 'turno_iniciado', jogadorId: 'bruno', rodada: 1 },
  ]);
  assert.equal(encerramento.estado.jogadorAtivoId, 'bruno');
  assert.equal(encerramento.estado.rodada, 1);
  assert.equal(encerramento.estado.posicaoConfirmada, false);
  assert.equal(encerramento.estado.tabuleiro.peaoSelecionadoId, null);
  const ana = encerramento.estado.jogadores.find((item) => item.jogadorId === 'ana');
  assert.equal(ana?.primeiroTurnoPendente, false);
  const bruno = encerramento.estado.jogadores.find((item) => item.jogadorId === 'bruno');
  assert.equal(bruno?.primeiroTurnoPendente, true);
  // Peão de bruno ainda sobre a Mesa: Peça do início do turno indefinida.
  assert.equal(encerramento.estado.pecaDoInicioDoTurnoId, null);
});

test('PECA_INICIAL_INDISPONIVEL: só a própria inicial, e só no próprio Primeiro Turno', () => {
  const estado = partidaIniciada();

  assert.equal(
    codigoDaRejeicao(estado, selecionarPeca('inicial-2'), 'ana'),
    'PECA_INICIAL_INDISPONIVEL',
  );
  assert.equal(
    codigoDaRejeicao(estado, posicionarPeca('inicial-2', 3, 3), 'ana'),
    'PECA_INICIAL_INDISPONIVEL',
  );

  // Mesmo a própria inicial é vedada fora do Primeiro Turno.
  const foraDoPrimeiro: EstadoDaPartida = {
    ...partidaIniciada(),
    jogadores: partidaIniciada().jogadores.map((jogador) =>
      jogador.jogadorId === 'ana'
        ? { ...jogador, primeiroTurnoPendente: false }
        : jogador,
    ),
  };
  assert.equal(
    codigoDaRejeicao(foraDoPrimeiro, selecionarPeca('inicial-1'), 'ana'),
    'PECA_INICIAL_INDISPONIVEL',
  );
  assert.equal(
    codigoDaRejeicao(foraDoPrimeiro, posicionarPeca('inicial-1', 3, 3), 'ana'),
    'PECA_INICIAL_INDISPONIVEL',
  );
});

test('MOVIMENTO_INDISPONIVEL no Primeiro Turno; encerrar exige Peão posicionado e zero pendências', () => {
  let estado = partidaIniciada();

  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 3, 3), 'ana'),
    'MOVIMENTO_INDISPONIVEL',
  );
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco'), 'ana'),
    'MOVIMENTO_INDISPONIVEL',
  );
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );

  // Peão posicionado com Recebimento pendente: encerramento bloqueado.
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'ana'),
    'PENDENCIA_NAO_RESOLVIDA',
  );

  estado = resolverRecebidas(estado, 'ana');
  estado = aplicar(estado, encerrarTurno(), 'ana');
  assert.equal(estado.jogadorAtivoId, 'bruno');
});

test('FORA_DA_VEZ: ator fora da vez, desconhecido e elemento de outro Jogador', () => {
  const estado = partidaIniciada();

  assert.equal(
    codigoDaRejeicao(estado, selecionarPeca('inicial-1'), 'bruno'),
    'FORA_DA_VEZ',
  );
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'fantasma'),
    'FORA_DA_VEZ',
  );
  // Ação sobre o Peão de outro Jogador, mesmo com o ator na vez.
  assert.equal(
    codigoDaRejeicao(estado, selecionarPeao('peao-vermelho'), 'ana'),
    'FORA_DA_VEZ',
  );
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-vermelho', 3, 3), 'ana'),
    'FORA_DA_VEZ',
  );
  assert.equal(
    codigoDaRejeicao(estado, confirmarPosicao('peao-vermelho'), 'ana'),
    'FORA_DA_VEZ',
  );
  // Ator com texto inválido: dados inválidos precedem a vez.
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), '  '),
    'DADOS_INVALIDOS',
  );

  // Invariante: exatamente um Jogador Ativo após as rejeições.
  assert.equal(estado.jogadores.filter((item) => item.jogadorId === estado.jogadorAtivoId).length, 1);
});

test('selecionar_peao reentra na sequência sem Recebimento (ST-11)', () => {
  let estado = partidaEmRodada2();

  // Ana em rodada 2: Peça do início é a inicial-1, onde o Peão está.
  assert.equal(estado.pecaDoInicioDoTurnoId, 'inicial-1');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  assert.deepEqual(estado.tabuleiro.recebidas, []);

  // Muda de Peça e re-seleciona: a Peça recém-ocupada (reta-1, norte vazio)
  // NÃO gera recebimento na seleção.
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  assert.equal(estado.tabuleiro.peaoSelecionadoId, null);
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  assert.deepEqual(estado.tabuleiro.recebidas, []);

  // Permanecer fora da Peça do início do turno: encerramento inválido, sem
  // alterar o estado.
  const antes = estado;
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco'), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );
  assert.deepEqual(estado, antes);
});

test('turno normal: mover, desfazer pela conexão simétrica, confirmar com Recebimento e encerrar', () => {
  let estado = partidaEmRodada2();

  // Mover para a reta-1 (2,3), desfazer voltando à inicial-1 e mover de novo.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const movimento = aplicarComandoDePartida(estado, moverPeao('peao-branco', 2, 3), 'ana');
  assert.equal(movimento.sucesso, true);
  if (!movimento.sucesso) return;
  assert.deepEqual(movimento.eventos, [
    {
      tipo: 'peao_movido',
      peaoId: 'peao-branco',
      pecaIdDe: 'inicial-1',
      pecaIdPara: 'reta-1',
      celula: { linha: 2, coluna: 3 },
    },
  ]);
  estado = movimento.estado;
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');

  // Re-seleção reentra na sequência sem Recebimento; a Confirmação de
  // Posição trava o Peão na Peça em que terminou e gera o Recebimento
  // (norte da reta-1 vazio; o sul aponta para a inicial-1 ocupada).
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const confirmacao = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.deepEqual(confirmacao.eventos, [
    { tipo: 'posicao_confirmada', jogadorId: 'ana', peaoId: 'peao-branco', pecaId: 'reta-1' },
    {
      tipo: 'recebimento_gerado',
      recebidas: [
        { recebidaId: 'recebida-reta-1-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 1, coluna: 3 } },
      ],
    },
  ]);
  assert.equal(confirmacao.estado.posicaoConfirmada, true);
  estado = confirmacao.estado;

  // Após confirmar, mover, permanecer e re-confirmar são rejeitados.
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 3, 3), 'ana'),
    'POSICAO_CONFIRMADA',
  );
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco'), 'ana'),
    'POSICAO_CONFIRMADA',
  );
  assert.equal(
    codigoDaRejeicao(estado, confirmarPosicao('peao-branco'), 'ana'),
    'POSICAO_CONFIRMADA',
  );

  estado = resolverRecebidas(estado, 'ana', 'cruz');
  const encerramento = aplicarComandoDePartida(estado, encerrarTurno(), 'ana');
  assert.equal(encerramento.sucesso, true);
  if (!encerramento.sucesso) return;
  assert.deepEqual(encerramento.eventos, [
    { tipo: 'turno_encerrado', jogadorId: 'ana' },
    { tipo: 'turno_iniciado', jogadorId: 'bruno', rodada: 2 },
  ]);
  assert.equal(encerramento.estado.jogadorAtivoId, 'bruno');
  assert.equal(encerramento.estado.rodada, 2);
  assert.equal(encerramento.estado.posicaoConfirmada, false);
  // Peça do início do turno de bruno: a inicial-2, onde o Peão dele ficou.
  assert.equal(encerramento.estado.pecaDoInicioDoTurnoId, 'inicial-2');
  assert.equal(encerramento.estado.tabuleiro.peaoSelecionadoId, null);
});

test('confirmar sem mudança de Peça e no Primeiro Turno são ENCERRAMENTO_INVALIDO', () => {
  let estado = partidaEmRodada2();

  // Sem movimento: o Peão segue na Peça do início do turno.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  assert.equal(
    codigoDaRejeicao(estado, confirmarPosicao('peao-branco'), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );

  // No Primeiro Turno não existe Confirmação de Posição.
  let primeiro = partidaIniciada();
  primeiro = aplicar(primeiro, selecionarPeca('inicial-1'), 'ana');
  primeiro = aplicar(primeiro, posicionarPeca('inicial-1', 3, 3), 'ana');
  primeiro = aplicar(primeiro, selecionarPeao('peao-branco'), 'ana');
  primeiro = aplicar(primeiro, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(
    codigoDaRejeicao(primeiro, confirmarPosicao('peao-branco'), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );
});

test('permanecer sem mudança de Peça encerra o turno direto, sem Recebimento', () => {
  let estado = partidaEmRodada2();

  // Ana em rodada 2: Peça do início é a inicial-1, Peão ainda sobre ela.
  assert.equal(estado.pecaDoInicioDoTurnoId, 'inicial-1');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');

  const permanencia = aplicarComandoDePartida(estado, permanecer('peao-branco'), 'ana');
  assert.equal(permanencia.sucesso, true);
  if (!permanencia.sucesso) return;
  assert.deepEqual(permanencia.eventos, [
    { tipo: 'peao_permaneceu', peaoId: 'peao-branco', pecaId: 'inicial-1' },
    { tipo: 'turno_encerrado', jogadorId: 'ana' },
    { tipo: 'turno_iniciado', jogadorId: 'bruno', rodada: 2 },
  ]);
  assert.ok(!permanencia.eventos.some((evento) => evento.tipo === 'recebimento_gerado'));
  assert.equal(permanencia.estado.jogadorAtivoId, 'bruno');
  assert.equal(permanencia.estado.posicaoConfirmada, false);
  assert.equal(permanencia.estado.pecaDoInicioDoTurnoId, 'inicial-2');
});

test('permanecer após mudar de Peça é ENCERRAMENTO_INVALIDO e preserva o estado', () => {
  let estado = partidaEmRodada2();

  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');

  const antes = estado;
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco'), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );
  assert.deepEqual(estado, antes);
  assert.equal(estado.jogadorAtivoId, 'ana');
});

test('encerrar_turno em turno normal sem Confirmação é ENCERRAMENTO_INVALIDO', () => {
  const estado = partidaEmRodada2();

  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );
});

test('avanço circular: os quatro encerram o Primeiro Turno e a vez volta ao primeiro na rodada 2', () => {
  let estado = partidaIniciada();

  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  assert.equal(estado.jogadorAtivoId, 'bruno');
  assert.equal(estado.rodada, 1);

  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 6 });
  assert.equal(estado.jogadorAtivoId, 'diogo');
  assert.equal(estado.rodada, 1);

  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 0 });
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.rodada, 2);
  assert.ok(estado.jogadores.every((jogador) => !jogador.primeiroTurnoPendente));
  assert.equal(estado.pecaDoInicioDoTurnoId, 'inicial-1');
});

test('após qualquer rejeição o estado da Partida fica inalterado, com um único Jogador Ativo', () => {
  let estado = partidaIniciada();
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');

  const antes = estado;
  const rejeicoes: ComandoDePartida[] = [
    moverPeao('peao-branco', 3, 4),
    permanecer('peao-branco'),
    confirmarPosicao('peao-branco'),
    encerrarTurno(),
    selecionarPeao('peao-vermelho'),
    selecionarPeca('inicial-2'),
  ];
  for (const comando of rejeicoes) {
    const resultado = aplicarComandoDePartida(estado, comando, 'ana');
    assert.equal(resultado.sucesso, false, `esperava rejeição para ${comando.tipo}`);
    assert.deepEqual(estado, antes);
    assert.equal(
      estado.jogadores.filter((jogador) => jogador.jogadorId === estado.jogadorAtivoId).length,
      1,
    );
    assert.equal(estado.rodada, 1);
  }
});
