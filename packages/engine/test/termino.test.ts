import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aplicarComandoDePartida,
  avaliarTerminoDaPartida,
  estadoInicialDaPartida,
  type ComandoDePartida,
  type CodigoDeErroDaPartida,
  type EstadoDaPartida,
  type Orientacao,
  type PecaDaCaixa,
  type PecaPosicionada,
  type TipoDaPeca,
} from '../src/index.ts';

const selecionarPeao = (peaoId: string) =>
  ({ tipo: 'selecionar_peao', peaoId } as const);

const moverPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'mover_peao', peaoId, celula: { linha, coluna } } as const);

const confirmarPosicao = (peaoId: string) =>
  ({ tipo: 'confirmar_posicao_do_peao', peaoId } as const);

const escolherVaga = (
  recebidaId: string,
  borda: 'norte' | 'leste' | 'sul' | 'oeste',
) =>
  ({ tipo: 'escolher_vaga_da_peca_recebida', recebidaId, borda } as const);

const posicionarPeca = (pecaId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peca', pecaId, celula: { linha, coluna } } as const);

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

function partidaBaseCom(roster: readonly string[]): EstadoDaPartida {
  const resultado = estadoInicialDaPartida(roster);
  if (!resultado.sucesso) {
    throw new Error('roster válido deveria iniciar a Partida');
  }
  return resultado.estado;
}

function partidaBase(): EstadoDaPartida {
  return partidaBaseCom(JOGADORES);
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

// Pré-condições do término (issue #176) montadas DIRETAMENTE sobre o estado
// (padrão dos testes de iluminação/limpeza); os comandos reais — selecionar,
// mover e confirmar — seguem pelo caminho de domínio. Peão sem peça indicada
// fica sobre a Mesa (pecaId null). O peão-branco (do Jogador Ativo ana) é o
// ator padrão das Confirmações, já selecionado.
function construirEstado(
  opcoes: {
    readonly posicionadas: readonly PecaPosicionada[];
    // Peça sob o Peão do ator da Confirmação (o primeiro peão do roster).
    readonly pecaDoPeao: string | null;
    // pecaIds dos demais peões na ordem do roster (null → Mesa).
    readonly peoesRestantes?: readonly (string | null)[];
    readonly pecaDoInicioDoTurnoId?: string | null;
    readonly jogadorAtivoId?: string;
    readonly caixa?: readonly PecaDaCaixa[];
    readonly geradoresLigados?: readonly string[];
    readonly cartaoDeAcessoObtido?: boolean;
    // Sanidades na ordem do roster.
    readonly sanidades?: readonly number[];
  },
  roster: readonly string[] = JOGADORES,
): EstadoDaPartida {
  const base = partidaBaseCom(roster);
  const peoesRestantes = opcoes.peoesRestantes ?? [];
  return {
    ...base,
    jogadorAtivoId: opcoes.jogadorAtivoId ?? roster[0],
    pecaDoInicioDoTurnoId:
      opcoes.pecaDoInicioDoTurnoId === undefined
        ? 'inicial-1'
        : opcoes.pecaDoInicioDoTurnoId,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    resultado: null,
    geradoresLigados: opcoes.geradoresLigados ?? [],
    cartaoDeAcessoObtido: opcoes.cartaoDeAcessoObtido ?? false,
    jogadores: base.jogadores.map((jogador, indice) => ({
      ...jogador,
      primeiroTurnoPendente: false,
      sanidade: opcoes.sanidades?.[indice] ?? 3,
    })),
    tabuleiro: {
      ...base.tabuleiro,
      posicionadas: opcoes.posicionadas,
      peoes: base.tabuleiro.peoes.map((peao, indiceDoPeao) => {
        if (indiceDoPeao === 0) {
          return { ...peao, pecaId: opcoes.pecaDoPeao };
        }
        return { ...peao, pecaId: peoesRestantes[indiceDoPeao - 1] ?? null };
      }),
      peaoSelecionadoId: base.tabuleiro.peoes[0].peaoId,
      recebidas: [],
      caixa: opcoes.caixa ?? base.tabuleiro.caixa,
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
    },
  };
}

// Condições de vitória pendentes apenas da Confirmação do 4º Peão no
// Portão: 3 geradores ligados + cartão obtido + os 4 peões já sobre o
// portao-1 (a Peça do início do turno é a inicial-1, distinta do Portão).
function estadoDaVitoriaPendente(extra?: {
  readonly caixa?: readonly PecaDaCaixa[];
  readonly sanidades?: readonly number[];
}): EstadoDaPartida {
  return construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('portao-1', 'portao_de_saida', 3, 2),
    ],
    pecaDoPeao: 'portao-1',
    peoesRestantes: ['portao-1', 'portao-1', 'portao-1'],
    geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
    cartaoDeAcessoObtido: true,
    ...extra,
  });
}

test('vitória: a Confirmação que completa as 3 condições emite partida_terminada como último evento', () => {
  const estado = estadoDaVitoriaPendente();
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;

  // A Confirmação seguiu pelo caminho real do domínio.
  assert.ok(
    resultado.eventos.some((evento) => evento.tipo === 'posicao_confirmada'),
  );
  // Desfecho no máximo uma vez, como ÚLTIMO evento do lote.
  assert.equal(
    resultado.eventos.filter((evento) => evento.tipo === 'partida_terminada')
      .length,
    1,
  );
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo?.tipo, 'partida_terminada');
  if (ultimo?.tipo !== 'partida_terminada') return;
  assert.deepEqual(ultimo.desfecho, { tipo: 'vitoria' });
  assert.deepEqual(resultado.estado.resultado, { tipo: 'vitoria' });
});

test('vitória tem prioridade sobre derrota simultânea no mesmo evento', () => {
  // caixa_esgotada é logicamente disjunta da vitória: ela exige contadores
  // incompletos ou Portão ausente — o oposto das condições de vitória. A
  // simultaneidade realizable é com equipe_amedrontada, que a posição dos
  // peões não considera. Equipe inteira amedrontada + vitória → vitoria.
  const estado = estadoDaVitoriaPendente({
    sanidades: [0, 0, 0, 0],
    caixa: [],
  });
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo?.tipo, 'partida_terminada');
  if (ultimo?.tipo !== 'partida_terminada') return;
  assert.deepEqual(ultimo.desfecho, { tipo: 'vitoria' });
  assert.deepEqual(resultado.estado.resultado, { tipo: 'vitoria' });
});

test('vitória considera apenas a posição dos peões: jogador amedrontado não a impede', () => {
  const estado = estadoDaVitoriaPendente({ sanidades: [0, 3, 3, 3] });
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo?.tipo, 'partida_terminada');
  if (ultimo?.tipo !== 'partida_terminada') return;
  assert.deepEqual(ultimo.desfecho, { tipo: 'vitoria' });
  assert.deepEqual(resultado.estado.resultado, { tipo: 'vitoria' });
});

test('confirmação sobre gerador liga o contador: acumula por peça e é idempotente', () => {
  // Primeiro gerador ligado pela Confirmação (caixa cheia: sem avaliação de
  // caixa esgotada).
  let estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('gerador-1', 'gerador', 3, 2),
      peca('gerador-2', 'gerador', 2, 2),
    ],
    pecaDoPeao: 'gerador-1',
  });
  estado = aplicar(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.deepEqual(estado.geradoresLigados, ['gerador-1']);
  assert.equal(estado.cartaoDeAcessoObtido, false);
  assert.equal(estado.resultado, null);

  // Reconfirmação sobre OUTRO gerador (turno seguinte montado diretamente):
  // acumula o segundo pecaId.
  const proximoTurno: EstadoDaPartida = {
    ...estado,
    jogadorAtivoId: 'bruno',
    pecaDoInicioDoTurnoId: 'inicial-2',
    posicaoConfirmada: false,
    geradoresLigados: ['gerador-1'],
    tabuleiro: {
      ...estado.tabuleiro,
      peaoSelecionadoId: 'peao-vermelho',
      peoes: estado.tabuleiro.peoes.map((peao) =>
        peao.cor === 'vermelho' ? { ...peao, pecaId: 'gerador-2' } : peao,
      ),
      recebidas: [],
    },
  };
  const segundo = aplicar(
    proximoTurno,
    confirmarPosicao('peao-vermelho'),
    'bruno',
  );
  assert.deepEqual(segundo.geradoresLigados, ['gerador-1', 'gerador-2']);

  // Idempotente: ligar o MESMO gerador de novo não duplica o pecaId.
  const repetido = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('gerador-1', 'gerador', 3, 2),
    ],
    pecaDoPeao: 'gerador-1',
    geradoresLigados: ['gerador-1'],
  });
  const confirmado = aplicar(repetido, confirmarPosicao('peao-branco'), 'ana');
  assert.deepEqual(confirmado.geradoresLigados, ['gerador-1']);
});

test('confirmação sobre sala_do_diretor obtém o cartão, de forma idempotente', () => {
  const estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('sala-1', 'sala_do_diretor', 3, 2),
    ],
    pecaDoPeao: 'sala-1',
  });
  const primeiro = aplicar(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(primeiro.cartaoDeAcessoObtido, true);
  assert.deepEqual(primeiro.geradoresLigados, []);

  // Idempotente: com o cartão já obtido, a Confirmação o mantém.
  const comCartao = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('sala-1', 'sala_do_diretor', 3, 2),
    ],
    pecaDoPeao: 'sala-1',
    cartaoDeAcessoObtido: true,
  });
  const segundo = aplicar(comCartao, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(segundo.cartaoDeAcessoObtido, true);
});

test('confirmação sobre peça comum não altera geradores ligados nem o cartão', () => {
  const estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('reta-1', 'reta', 3, 2),
    ],
    pecaDoPeao: 'reta-1',
    geradoresLigados: ['gerador-1'],
    cartaoDeAcessoObtido: true,
  });
  const confirmado = aplicar(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.deepEqual(confirmado.geradoresLigados, ['gerador-1']);
  assert.equal(confirmado.cartaoDeAcessoObtido, true);
  assert.equal(confirmado.resultado, null);
});

test('contadores sobrevivem à Limpeza: gerador ligado removido segue contado e NÃO há derrota', () => {
  // gerador-l está ligado mas será removido pela Limpeza (célula (0,5) fora
  // da iluminação). Com o contador sobrevivendo, a caixa vazia deixa os
  // objetivos atingíveis pela contagem: 1 gerador não ligado no tabuleiro
  // não é menor que 3 − 2 ligados. A Confirmação sobre o gerador-2 o liga.
  const estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('gerador-2', 'gerador', 3, 2),
      peca('gerador-3', 'gerador', 2, 2),
      peca('sala-1', 'sala_do_diretor', 3, 1),
      peca('portao-1', 'portao_de_saida', 4, 2),
      peca('gerador-l', 'gerador', 0, 5),
    ],
    pecaDoPeao: 'gerador-2',
    caixa: [],
    geradoresLigados: ['gerador-l'],
  });
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;

  // A Limpeza removeu o gerador ligado...
  const limpeza = resultado.eventos.find(
    (evento) => evento.tipo === 'limpeza_aplicada',
  );
  assert.ok(limpeza, 'esperava o evento limpeza_aplicada');
  if (limpeza?.tipo !== 'limpeza_aplicada') return;
  assert.ok(limpeza.pecasRemovidas.includes('gerador-l'));
  assert.ok(
    !resultado.estado.tabuleiro.posicionadas.some(
      (p) => p.pecaId === 'gerador-l',
    ),
  );
  // ...e o contador sobrevive, sem desfecho.
  assert.deepEqual(resultado.estado.geradoresLigados, [
    'gerador-l',
    'gerador-2',
  ]);
  assert.equal(resultado.estado.resultado, null);
  assert.ok(
    !resultado.eventos.some((evento) => evento.tipo === 'partida_terminada'),
  );
  assert.deepEqual(resultado.estado.tabuleiro.recebidas, []);
});

test('derrota caixa_esgotada: falta gerador não ligado no tabuleiro', () => {
  const estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('reta-1', 'reta', 3, 2),
      peca('gerador-1', 'gerador', 2, 2),
      peca('gerador-2', 'gerador', 3, 1),
      peca('sala-1', 'sala_do_diretor', 4, 2),
      peca('portao-1', 'portao_de_saida', 1, 3),
      peca('inicial-2', 'inicial', 1, 2),
    ],
    pecaDoPeao: 'reta-1',
    peoesRestantes: ['inicial-2', null, null],
    caixa: [],
  });
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  // 2 geradores não ligados < 3 necessários; sala e portão presentes isolam
  // o motivo.
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo?.tipo, 'partida_terminada');
  if (ultimo?.tipo !== 'partida_terminada') return;
  assert.deepEqual(ultimo.desfecho, {
    tipo: 'derrota',
    motivo: 'caixa_esgotada',
  });
  assert.deepEqual(resultado.estado.resultado, {
    tipo: 'derrota',
    motivo: 'caixa_esgotada',
  });
});

test('derrota caixa_esgotada: cartão pendente sem sala_do_diretor no tabuleiro', () => {
  const estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('reta-1', 'reta', 3, 2),
      peca('portao-1', 'portao_de_saida', 2, 2),
    ],
    pecaDoPeao: 'reta-1',
    caixa: [],
    geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
  });
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  // Com os 3 geradores ligados e o Portão presente, o cartão pendente sem
  // Sala do Diretor no tabuleiro é o motivo isolado.
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo?.tipo, 'partida_terminada');
  if (ultimo?.tipo !== 'partida_terminada') return;
  assert.deepEqual(ultimo.desfecho, {
    tipo: 'derrota',
    motivo: 'caixa_esgotada',
  });
});

test('derrota caixa_esgotada: nenhum portao_de_saida no tabuleiro', () => {
  const estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('reta-1', 'reta', 3, 2),
    ],
    pecaDoPeao: 'reta-1',
    caixa: [],
    geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
    cartaoDeAcessoObtido: true,
  });
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  // Com os 3 geradores ligados e o cartão obtido, a ausência de Portão é o
  // motivo isolado.
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo?.tipo, 'partida_terminada');
  if (ultimo?.tipo !== 'partida_terminada') return;
  assert.deepEqual(ultimo.desfecho, {
    tipo: 'derrota',
    motivo: 'caixa_esgotada',
  });
});

test('caixa vazia com objetivos atingíveis pela contagem: sem desfecho e Confirmação sem pendências', () => {
  const estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('reta-1', 'reta', 3, 2),
      peca('gerador-1', 'gerador', 2, 2),
      peca('gerador-2', 'gerador', 3, 1),
      peca('gerador-3', 'gerador', 4, 2),
      peca('sala-1', 'sala_do_diretor', 1, 3),
      peca('portao-1', 'portao_de_saida', 1, 1),
      peca('inicial-2', 'inicial', 1, 2),
    ],
    pecaDoPeao: 'reta-1',
    peoesRestantes: ['inicial-2', null, null],
    caixa: [],
  });
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  // Sem desfecho: 3 geradores não ligados ≥ 3 necessários, sala e portão
  // presentes.
  assert.equal(resultado.estado.resultado, null);
  assert.ok(
    !resultado.eventos.some((evento) => evento.tipo === 'partida_terminada'),
  );
  // Recebimento com caixa vazia: zero pendências, sem eventos de sorteio.
  assert.deepEqual(resultado.estado.tabuleiro.recebidas, []);
  assert.ok(!resultado.eventos.some((evento) => evento.tipo === 'peca_sorteada'));
  assert.ok(
    !resultado.eventos.some((evento) => evento.tipo === 'recebimento_gerado'),
  );
});

test('caixa vazia: a última peça especial pendente na mão evita a derrota contável', () => {
  // 2 geradores ligados (necessário: 1); NENHUM gerador não ligado no
  // tabuleiro; a caixa contém uma única peça — um gerador — que o Recebimento
  // da Confirmação sorteia e deixa pendente na mão do Jogador. Sem contar a
  // pendência, a partida terminaria prematuramente; com ela, o Jogador
  // posiciona a peça no mesmo turno e a partida segue.
  const estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('reta-1', 'reta', 3, 2),
      peca('sala-1', 'sala_do_diretor', 3, 1),
      peca('portao-1', 'portao_de_saida', 4, 2),
    ],
    pecaDoPeao: 'reta-1',
    caixa: [{ pecaId: 'gerador-4', tipo: 'gerador', orientacao: 0 }],
    geradoresLigados: ['gerador-1', 'gerador-2'],
  });
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  // Sem desfecho no Recebimento: o gerador pendente atende a contagem
  // (1 não ligado disponível ≥ 1 necessário).
  assert.equal(resultado.estado.resultado, null);
  assert.ok(
    !resultado.eventos.some((evento) => evento.tipo === 'partida_terminada'),
  );
  // A pendência está na mão do Jogador...
  assert.deepEqual(
    resultado.estado.tabuleiro.recebidas.map((recebida) => recebida.tipo),
    ['gerador'],
  );
  // ...e ele a posiciona no mesmo turno; a partida segue.
  const escolhida = aplicar(
    resultado.estado,
    escolherVaga('recebida-gerador-4', 'norte'),
    'ana',
  );
  const encaixado = aplicarComandoDePartida(
    escolhida,
    posicionarPeca('gerador-4', 2, 2),
    'ana',
  );
  assert.equal(encaixado.sucesso, true);
  if (!encaixado.sucesso) return;
  assert.deepEqual(encaixado.estado.tabuleiro.recebidas, []);
  assert.ok(
    encaixado.estado.tabuleiro.posicionadas.some(
      (peca) => peca.pecaId === 'gerador-4',
    ),
  );
  assert.equal(encaixado.estado.resultado, null);
  assert.ok(
    !encaixado.eventos.some((evento) => evento.tipo === 'partida_terminada'),
  );
});

test('caixa vazia: a Sala do Diretor pendente na mão evita a derrota por cartão', () => {
  // 3 geradores ligados, Portão presente, cartão pendente; a caixa tem uma
  // última sala_do_diretor, sorteada pelo Recebimento e pendente na mão.
  const estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('reta-1', 'reta', 3, 2),
      peca('portao-1', 'portao_de_saida', 4, 2),
    ],
    pecaDoPeao: 'reta-1',
    caixa: [{ pecaId: 'sala-2', tipo: 'sala_do_diretor', orientacao: 0 }],
    geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
  });
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(resultado.estado.resultado, null);
  assert.ok(
    !resultado.eventos.some((evento) => evento.tipo === 'partida_terminada'),
  );
  assert.deepEqual(
    resultado.estado.tabuleiro.recebidas.map((recebida) => recebida.tipo),
    ['sala_do_diretor'],
  );
});

test('caixa vazia: o Portão de Saída pendente na mão evita a derrota por ausência de Portão', () => {
  // 3 geradores ligados, cartão obtido; a caixa tem um último portao_de_saida,
  // sorteado pelo Recebimento e pendente na mão.
  const estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('reta-1', 'reta', 3, 2),
    ],
    pecaDoPeao: 'reta-1',
    caixa: [{ pecaId: 'portao-2', tipo: 'portao_de_saida', orientacao: 0 }],
    geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
    cartaoDeAcessoObtido: true,
  });
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(resultado.estado.resultado, null);
  assert.ok(
    !resultado.eventos.some((evento) => evento.tipo === 'partida_terminada'),
  );
  assert.deepEqual(
    resultado.estado.tabuleiro.recebidas.map((recebida) => recebida.tipo),
    ['portao_de_saida'],
  );
});

test('derrota equipe_amedrontada via avaliarTerminoDaPartida: no 4º jogador termina, com 3 não', () => {
  // Os 4 amedrontados: derrota declarada.
  const terminado = construirEstado({
    posicionadas: [peca('inicial-1', 'inicial', 3, 3)],
    pecaDoPeao: null,
    sanidades: [0, 0, 0, 0],
  });
  const avaliacao = avaliarTerminoDaPartida(terminado);
  assert.deepEqual(avaliacao.evento, {
    tipo: 'partida_terminada',
    desfecho: { tipo: 'derrota', motivo: 'equipe_amedrontada' },
  });
  assert.deepEqual(avaliacao.estado.resultado, {
    tipo: 'derrota',
    motivo: 'equipe_amedrontada',
  });
  // Avaliação repetida sobre estado terminado: nada novo — o evento sai no
  // máximo uma vez.
  const repetida = avaliarTerminoDaPartida(avaliacao.estado);
  assert.equal(repetida.evento, null);
  assert.deepEqual(repetida.estado.resultado, {
    tipo: 'derrota',
    motivo: 'equipe_amedrontada',
  });

  // 3 amedrontados: a partida segue.
  const incompleto = construirEstado({
    posicionadas: [peca('inicial-1', 'inicial', 3, 3)],
    pecaDoPeao: null,
    sanidades: [0, 0, 0, 3],
  });
  const semDesfecho = avaliarTerminoDaPartida(incompleto);
  assert.equal(semDesfecho.evento, null);
  assert.equal(semDesfecho.estado.resultado, null);
  assert.equal(semDesfecho.estado, incompleto);

  // Desempate dos motivos de derrota simultâneos: equipe_amedrontada
  // precede caixa_esgotada (equipe toda amedrontada + caixa vazia sem
  // objetivos atingíveis).
  const ambos = construirEstado({
    posicionadas: [peca('inicial-1', 'inicial', 3, 3)],
    pecaDoPeao: null,
    sanidades: [0, 0, 0, 0],
    caixa: [],
  });
  const desempate = avaliarTerminoDaPartida(ambos);
  assert.ok(desempate.evento, 'esperava desfecho');
  if (desempate.evento?.tipo !== 'partida_terminada') return;
  assert.equal(desempate.evento.desfecho.tipo, 'derrota');
  assert.equal(desempate.evento.desfecho.motivo, 'equipe_amedrontada');
});

test('Partida terminada recusa qualquer comando com PARTIDA_TERMINADA', () => {
  const estado = aplicar(
    estadoDaVitoriaPendente(),
    confirmarPosicao('peao-branco'),
    'ana',
  );
  // Comandos do próprio Jogador Ativo: a recusa é pelo término, não por
  // POSICAO_CONFIRMADA nem ENCERRAMENTO_INVALIDO.
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'ana'),
    'PARTIDA_TERMINADA',
  );
  assert.equal(
    codigoDaRejeicao(estado, confirmarPosicao('peao-branco'), 'ana'),
    'PARTIDA_TERMINADA',
  );
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 3, 3), 'ana'),
    'PARTIDA_TERMINADA',
  );
  // Ator que seria o próximo Jogador: a guarda precede FORA_DA_VEZ.
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'bruno'),
    'PARTIDA_TERMINADA',
  );
  // Ator com texto inválido: validarTexto precede a guarda do término.
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), '   '),
    'DADOS_INVALIDOS',
  );
});

test('avaliação única: confirmação com efeitos encadeados emite partida_terminada uma vez, ao final', () => {
  const estado = construirEstado({
    posicionadas: [
      peca('inicial-1', 'inicial', 3, 3),
      peca('portao-1', 'portao_de_saida', 3, 2),
      peca('reta-x', 'reta', 0, 5),
    ],
    pecaDoPeao: 'portao-1',
    peoesRestantes: ['portao-1', 'portao-1', 'portao-1'],
    geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
    cartaoDeAcessoObtido: true,
  });
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  // Efeitos encadeados no lote: Confirmação + sorteio + Recebimento +
  // Limpeza.
  assert.ok(
    resultado.eventos.some((evento) => evento.tipo === 'posicao_confirmada'),
  );
  assert.ok(resultado.eventos.some((evento) => evento.tipo === 'peca_sorteada'));
  assert.ok(
    resultado.eventos.some((evento) => evento.tipo === 'recebimento_gerado'),
  );
  assert.ok(resultado.eventos.some((evento) => evento.tipo === 'limpeza_aplicada'));
  // Avaliação ÚNICA: exatamente um partida_terminada, como último evento.
  assert.equal(
    resultado.eventos.filter((evento) => evento.tipo === 'partida_terminada')
      .length,
    1,
  );
  assert.equal(
    resultado.eventos[resultado.eventos.length - 1]?.tipo,
    'partida_terminada',
  );
});

test('imutabilidade: comandos e avaliação não mutam o estado recebido', () => {
  const estado = estadoDaVitoriaPendente();
  const snapshot = structuredClone(estado);
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  assert.deepEqual(estado, snapshot);

  const paraAvaliar = construirEstado({
    posicionadas: [peca('inicial-1', 'inicial', 3, 3)],
    pecaDoPeao: null,
    sanidades: [0, 0, 0, 0],
  });
  const snapshotAvaliacao = structuredClone(paraAvaliar);
  const avaliacao = avaliarTerminoDaPartida(paraAvaliar);
  assert.ok(avaliacao.evento, 'esperava desfecho');
  assert.deepEqual(paraAvaliar, snapshotAvaliacao);
});

test('Portão de Saída aceita do 2º ao 4º Peão; peça comum ocupada segue PECA_JA_TEM_PEAO', () => {
  // cruz-1 conecta ao portao-1 (oeste↔leste); reta-1 conecta ao portao-1
  // (sul↔norte). Azul já no Portão (1º), branco e amarelo na cruz-1,
  // vermelho na reta-1.
  let estado = construirEstado({
    posicionadas: [
      peca('cruz-1', 'cruz', 3, 3),
      peca('portao-1', 'portao_de_saida', 3, 2),
      peca('reta-1', 'reta', 2, 2),
    ],
    pecaDoPeao: 'cruz-1',
    peoesRestantes: ['reta-1', 'portao-1', 'cruz-1'],
  });

  // 2º Peão entra no Portão (1 ocupante).
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 3, 2), 'ana');

  // 3º Peão entra no Portão (2 ocupantes).
  const vezDeDiogo = { ...estado, jogadorAtivoId: 'diogo' };
  const amareloSelecionado = aplicar(
    vezDeDiogo,
    selecionarPeao('peao-amarelo'),
    'diogo',
  );
  estado = aplicar(amareloSelecionado, moverPeao('peao-amarelo', 3, 2), 'diogo');

  // Peça comum ocupada (reta-1 com o vermelho): continua PECA_JA_TEM_PEAO.
  const vezDeAna = { ...estado, jogadorAtivoId: 'ana' };
  const brancoSelecionado = aplicar(
    vezDeAna,
    selecionarPeao('peao-branco'),
    'ana',
  );
  assert.equal(
    codigoDaRejeicao(brancoSelecionado, moverPeao('peao-branco', 2, 2), 'ana'),
    'PECA_JA_TEM_PEAO',
  );

  // 4º Peão entra no Portão (3 ocupantes): a reunião completa.
  const vezDeBruno = { ...estado, jogadorAtivoId: 'bruno' };
  const vermelhoSelecionado = aplicar(
    vezDeBruno,
    selecionarPeao('peao-vermelho'),
    'bruno',
  );
  estado = aplicar(
    vermelhoSelecionado,
    moverPeao('peao-vermelho', 3, 2),
    'bruno',
  );
  assert.ok(
    estado.tabuleiro.peoes.every((peao) => peao.pecaId === 'portao-1'),
    'os 4 peões deveriam estar reunidos no Portão de Saída',
  );
  assert.equal(estado.resultado, null);
});

// Roster variável (issue #285): condições de vitória pendentes apenas da
// Confirmação, com os N peões do roster sobre o portao-1.
function estadoDaVitoriaPendenteComN(
  roster: readonly string[],
  extra?: {
    readonly caixa?: readonly PecaDaCaixa[];
    readonly sanidades?: readonly number[];
  },
): EstadoDaPartida {
  return construirEstado(
    {
      posicionadas: [
        peca('inicial-1', 'inicial', 3, 3),
        peca('portao-1', 'portao_de_saida', 3, 2),
      ],
      pecaDoPeao: 'portao-1',
      peoesRestantes: Array.from(
        { length: roster.length - 1 },
        () => 'portao-1' as const,
      ),
      geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
      cartaoDeAcessoObtido: true,
      ...extra,
    },
    roster,
  );
}

function afirmarVitoria(resultado: ReturnType<typeof aplicarComandoDePartida>) {
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo?.tipo, 'partida_terminada');
  if (ultimo?.tipo !== 'partida_terminada') return;
  assert.deepEqual(ultimo.desfecho, { tipo: 'vitoria' });
  assert.deepEqual(resultado.estado.resultado, { tipo: 'vitoria' });
}

test('vitória com N=2: os 2 peões no Portão + 3 geradores + cartão', () => {
  const estado = estadoDaVitoriaPendenteComN(['ana', 'bruno']);
  afirmarVitoria(
    aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana'),
  );
});

test('vitória com N=3: os 3 peões no Portão + 3 geradores + cartão', () => {
  const estado = estadoDaVitoriaPendenteComN(['ana', 'bruno', 'carla']);
  afirmarVitoria(
    aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana'),
  );
});

test('sem vitória com N=2 quando só 1 peão está no Portão', () => {
  const estado = construirEstado(
    {
      posicionadas: [
        peca('inicial-1', 'inicial', 3, 3),
        peca('portao-1', 'portao_de_saida', 3, 2),
      ],
      pecaDoPeao: 'portao-1',
      peoesRestantes: [null],
      geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
      cartaoDeAcessoObtido: true,
    },
    ['ana', 'bruno'],
  );
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(resultado.estado.resultado, null);
  assert.ok(
    !resultado.eventos.some((evento) => evento.tipo === 'partida_terminada'),
  );
});

test('derrota equipe_amedrontada com N=2: sanidade zerada em todo o roster', () => {
  const estado = construirEstado(
    {
      posicionadas: [
        peca('inicial-1', 'inicial', 3, 3),
        peca('reta-1', 'reta', 3, 2),
      ],
      pecaDoPeao: 'reta-1',
      sanidades: [0, 0],
    },
    ['ana', 'bruno'],
  );
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo?.tipo, 'partida_terminada');
  if (ultimo?.tipo !== 'partida_terminada') return;
  assert.deepEqual(ultimo.desfecho, {
    tipo: 'derrota',
    motivo: 'equipe_amedrontada',
  });
});

test('derrota caixa_esgotada com N=3: nenhum portao_de_saida no tabuleiro', () => {
  const estado = construirEstado(
    {
      posicionadas: [
        peca('inicial-1', 'inicial', 3, 3),
        peca('reta-1', 'reta', 3, 2),
      ],
      pecaDoPeao: 'reta-1',
      caixa: [],
      geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
      cartaoDeAcessoObtido: true,
    },
    ['ana', 'bruno', 'carla'],
  );
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo?.tipo, 'partida_terminada');
  if (ultimo?.tipo !== 'partida_terminada') return;
  assert.deepEqual(ultimo.desfecho, {
    tipo: 'derrota',
    motivo: 'caixa_esgotada',
  });
});

test('Portão com N=2 aceita o 2º Peão; peça comum ocupada segue PECA_JA_TEM_PEAO', () => {
  // cruz-1 conecta ao portao-1 (oeste↔leste). Vermelho já no Portão (1º),
  // branco na cruz-1.
  let estado = construirEstado(
    {
      posicionadas: [
        peca('cruz-1', 'cruz', 3, 3),
        peca('portao-1', 'portao_de_saida', 3, 2),
      ],
      pecaDoPeao: 'cruz-1',
      peoesRestantes: ['portao-1'],
    },
    ['ana', 'bruno'],
  );

  // 2º Peão entra no Portão (1 ocupante): o teto N=2 é atingido.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 3, 2), 'ana');
  assert.ok(
    estado.tabuleiro.peoes.every((peao) => peao.pecaId === 'portao-1'),
    'os 2 peões deveriam estar reunidos no Portão de Saída',
  );

  // Peça comum ocupada: vermelho de volta à cruz-1 e branco tenta entrar.
  const vezDeBruno = { ...estado, jogadorAtivoId: 'bruno' };
  const vermelhoSelecionado = aplicar(
    vezDeBruno,
    selecionarPeao('peao-vermelho'),
    'bruno',
  );
  const vermelhoFora = aplicar(
    vermelhoSelecionado,
    moverPeao('peao-vermelho', 3, 3),
    'bruno',
  );
  const vezDeAna = { ...vermelhoFora, jogadorAtivoId: 'ana' };
  const brancoSelecionado = aplicar(
    vezDeAna,
    selecionarPeao('peao-branco'),
    'ana',
  );
  assert.equal(
    codigoDaRejeicao(brancoSelecionado, moverPeao('peao-branco', 3, 3), 'ana'),
    'PECA_JA_TEM_PEAO',
  );
});

test('Portão com N=3 aceita o 2º e o 3º Peão (teto do roster)', () => {
  // cruz-1 conecta ao portao-1 (oeste↔leste); reta-1 conecta ao portao-1
  // (sul↔norte). Azul já no Portão (1º), branco na cruz-1, vermelho na reta-1.
  let estado = construirEstado(
    {
      posicionadas: [
        peca('cruz-1', 'cruz', 3, 3),
        peca('portao-1', 'portao_de_saida', 3, 2),
        peca('reta-1', 'reta', 2, 2),
      ],
      pecaDoPeao: 'cruz-1',
      peoesRestantes: ['reta-1', 'portao-1'],
    },
    ['ana', 'bruno', 'carla'],
  );

  // 2º Peão entra no Portão (1 ocupante).
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 3, 2), 'ana');

  // 3º Peão entra no Portão (2 ocupantes): o teto N=3 é atingido.
  const vezDeBruno = { ...estado, jogadorAtivoId: 'bruno' };
  const vermelhoSelecionado = aplicar(
    vezDeBruno,
    selecionarPeao('peao-vermelho'),
    'bruno',
  );
  estado = aplicar(
    vermelhoSelecionado,
    moverPeao('peao-vermelho', 3, 2),
    'bruno',
  );
  assert.ok(
    estado.tabuleiro.peoes.every((peao) => peao.pecaId === 'portao-1'),
    'os 3 peões deveriam estar reunidos no Portão de Saída',
  );
  assert.equal(estado.resultado, null);
});

test('Portão com N=2 rejeita o 3º Peão sem afetado; com afetado o Resgate autoriza (teto N+1)', () => {
  // cruz-1 conecta ao portao-1 (oeste↔leste). Vermelho no Portão (1º) e um
  // Peão artesanal extra também no Portão (2 ocupantes = teto N=2); branco na
  // cruz-1 tenta entrar como 3º. O extra simula o (N+1)-ésimo sem elevar o
  // roster — o teto da Partida deriva de jogadores.length, não de
  // tabuleiro.peoes.length.
  const montar = (afetado: boolean): EstadoDaPartida => {
    const base = construirEstado(
      {
        posicionadas: [
          peca('cruz-1', 'cruz', 3, 3),
          peca('portao-1', 'portao_de_saida', 3, 2),
        ],
        pecaDoPeao: 'cruz-1',
        peoesRestantes: ['portao-1'],
      },
      ['ana', 'bruno'],
    );
    return {
      ...base,
      jogadores: afetado
        ? base.jogadores.map((jogador) =>
            jogador.jogadorId === 'bruno'
              ? { ...jogador, emBaixaIluminacao: true }
              : jogador,
          )
        : base.jogadores,
      tabuleiro: {
        ...base.tabuleiro,
        peoes: [
          ...base.tabuleiro.peoes,
          { peaoId: 'peao-extra', cor: 'amarelo' as const, pecaId: 'portao-1' },
        ],
      },
    };
  };

  // Sem afetado: teto N=2 com 2 ocupantes — a entrada do 3º é rejeitada.
  const cheio = montar(false);
  const brancoSelecionado = aplicar(cheio, selecionarPeao('peao-branco'), 'ana');
  assert.equal(
    codigoDaRejeicao(brancoSelecionado, moverPeao('peao-branco', 3, 2), 'ana'),
    'PECA_JA_TEM_PEAO',
  );

  // Com afetado (bruno em Baixa no Portão): teto N+1=3 — o 3º entra e resgata.
  const comAfetado = montar(true);
  const entrando = aplicar(comAfetado, selecionarPeao('peao-branco'), 'ana');
  const resultado = aplicarComandoDePartida(
    entrando,
    moverPeao('peao-branco', 3, 2),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(
    resultado.estado.tabuleiro.peoes.filter((peao) => peao.pecaId === 'portao-1')
      .length,
    3,
  );
  assert.ok(
    resultado.eventos.some((evento) => evento.tipo === 'resgate_realizado'),
    'esperava o resgate do afetado no Portão',
  );
});

test('Portão com N=3 rejeita o 4º Peão sem afetado; com afetado o Resgate autoriza (teto N+1)', () => {
  // Mesmo arranjo do N=2 com um Jogador a mais: azul no Portão (2º) e o extra
  // como 3º ocupante (= teto N=3); branco tenta entrar como 4º.
  const montar = (afetado: boolean): EstadoDaPartida => {
    const base = construirEstado(
      {
        posicionadas: [
          peca('cruz-1', 'cruz', 3, 3),
          peca('portao-1', 'portao_de_saida', 3, 2),
        ],
        pecaDoPeao: 'cruz-1',
        peoesRestantes: ['portao-1', 'portao-1'],
      },
      ['ana', 'bruno', 'carla'],
    );
    return {
      ...base,
      jogadores: afetado
        ? base.jogadores.map((jogador) =>
            jogador.jogadorId === 'bruno'
              ? { ...jogador, emBaixaIluminacao: true }
              : jogador,
          )
        : base.jogadores,
      tabuleiro: {
        ...base.tabuleiro,
        peoes: [
          ...base.tabuleiro.peoes,
          { peaoId: 'peao-extra', cor: 'amarelo' as const, pecaId: 'portao-1' },
        ],
      },
    };
  };

  const cheio = montar(false);
  const brancoSelecionado = aplicar(cheio, selecionarPeao('peao-branco'), 'ana');
  assert.equal(
    codigoDaRejeicao(brancoSelecionado, moverPeao('peao-branco', 3, 2), 'ana'),
    'PECA_JA_TEM_PEAO',
  );

  const comAfetado = montar(true);
  const entrando = aplicar(comAfetado, selecionarPeao('peao-branco'), 'ana');
  const resultado = aplicarComandoDePartida(
    entrando,
    moverPeao('peao-branco', 3, 2),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.equal(
    resultado.estado.tabuleiro.peoes.filter((peao) => peao.pecaId === 'portao-1')
      .length,
    4,
  );
  assert.ok(
    resultado.eventos.some((evento) => evento.tipo === 'resgate_realizado'),
    'esperava o resgate do afetado no Portão',
  );
});

test('derrota equipe_amedrontada com N=3: sanidade zerada em todo o roster', () => {
  const estado = construirEstado(
    {
      posicionadas: [
        peca('inicial-1', 'inicial', 3, 3),
        peca('reta-1', 'reta', 3, 2),
      ],
      pecaDoPeao: 'reta-1',
      sanidades: [0, 0, 0],
    },
    ['ana', 'bruno', 'carla'],
  );
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo?.tipo, 'partida_terminada');
  if (ultimo?.tipo !== 'partida_terminada') return;
  assert.deepEqual(ultimo.desfecho, {
    tipo: 'derrota',
    motivo: 'equipe_amedrontada',
  });
});

test('derrota caixa_esgotada com N=2: nenhum portao_de_saida no tabuleiro', () => {
  const estado = construirEstado(
    {
      posicionadas: [
        peca('inicial-1', 'inicial', 3, 3),
        peca('reta-1', 'reta', 3, 2),
      ],
      pecaDoPeao: 'reta-1',
      caixa: [],
      geradoresLigados: ['gerador-1', 'gerador-2', 'gerador-3'],
      cartaoDeAcessoObtido: true,
    },
    ['ana', 'bruno'],
  );
  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const ultimo = resultado.eventos[resultado.eventos.length - 1];
  assert.equal(ultimo?.tipo, 'partida_terminada');
  if (ultimo?.tipo !== 'partida_terminada') return;
  assert.deepEqual(ultimo.desfecho, {
    tipo: 'derrota',
    motivo: 'caixa_esgotada',
  });
});
