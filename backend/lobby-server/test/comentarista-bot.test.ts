// Testes unitários do comentarista de bot (issue #390) — módulo puro: a
// avaliação de gatilhos sobre o espelho antes/depois do fold, a tabela de
// textos pré-feitos (teto de 300 por construção) e a fila FIFO com cooldown
// mínimo entre comentários do mesmo bot (injetável p/ testes). Sem I/O.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  avaliarGatilhoDeComentario,
  ComentaristaDeBot,
  sortearTexto,
  TEXTOS_POR_GATILHO,
  type GatilhoDeComentarioDeBot,
} from '../src/bots/comentarista-de-bot.ts';
import { adaptarSnapshotParaEspelho } from '../src/bots/jogador-bot.ts';
import type { EstadoDaPartida } from '@flicker/engine';
import type { EstadoDaPartidaSnapshot } from '@flicker/shared';

function snapshotFresco(): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [],
      iniciais: [
        { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0 },
        { pecaId: 'inicial-2', tipo: 'inicial', orientacao: 0 },
      ],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
      ],
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 83,
    },
    jogadores: [
      {
        jogadorId: 'ana',
        apelido: 'ana',
        cor: 'branco',
        ordem: 1,
        peaoId: 'peao-branco',
        primeiroTurnoPendente: true,
        sanidade: 3,
        emBaixaIluminacao: false,
        amedrontado: false,
        protegido: false,
      },
      {
        jogadorId: 'bruno',
        apelido: 'bruno',
        cor: 'vermelho',
        ordem: 2,
        peaoId: 'peao-vermelho',
        primeiroTurnoPendente: true,
        sanidade: 3,
        emBaixaIluminacao: false,
        amedrontado: false,
        protegido: false,
      },
    ],
    jogadorAtivoId: 'ana',
    rodada: 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
  };
}

function estadoFresco(): EstadoDaPartida {
  return adaptarSnapshotParaEspelho(snapshotFresco());
}

const GATILHOS: readonly GatilhoDeComentarioDeBot[] = [
  'gerador_ligado',
  'chave_obtida',
  'ataque_sofrido',
  'baixa_iluminacao',
  'resgate',
  'vitoria',
  'derrota',
];

// --- Tabela de textos --------------------------------------------------------

test('todos os gatilhos têm 3 a 5 textos e nenhum passa dos 300 caracteres', () => {
  for (const gatilho of GATILHOS) {
    const textos = TEXTOS_POR_GATILHO[gatilho];
    assert.ok(
      textos.length >= 3 && textos.length <= 5,
      `gatilho ${gatilho} deve ter 3-5 textos`,
    );
    for (const texto of textos) {
      assert.ok(texto.length > 0 && texto.length <= 300, `texto do gatilho ${gatilho} excede o teto`);
    }
  }
});

test('sorteio não repete o texto imediatamente anterior do mesmo gatilho', () => {
  const textos = TEXTOS_POR_GATILHO.resgate;
  const ultimoUsado = textos[0]!;
  for (const aleatorio of [0, 0.24, 0.5, 0.99]) {
    const sorteado = sortearTexto('resgate', ultimoUsado, () => aleatorio);
    assert.notEqual(sorteado, ultimoUsado);
    assert.ok(textos.includes(sorteado));
  }
});

// --- Avaliação de gatilhos (pura) --------------------------------------------

test('cada gatilho disparado sobre o espelho antes/depois do fold', () => {
  const antes = estadoFresco();

  // Gerador ligado (por qualquer Jogador, aliados incluídos).
  const depoisGerador = { ...antes, geradoresLigados: ['gerador-1'] };
  assert.equal(
    avaliarGatilhoDeComentario(antes, depoisGerador, { type: 'POSICAO_CONFIRMADA' }, 'ana'),
    'gerador_ligado',
  );

  // Chave (cartão) obtida — monotônico no espelho.
  const depoisChave = { ...antes, cartaoDeAcessoObtido: true };
  assert.equal(
    avaliarGatilhoDeComentario(antes, depoisChave, { type: 'POSICAO_CONFIRMADA' }, 'ana'),
    'chave_obtida',
  );

  // Ataque sofrido: o Peão do bot entra em peoesAtingidos.
  const ataque = { type: 'ATAQUE_RESOLVIDO', peoesAtingidos: ['peao-branco'], protegidos: [], estadosAplicados: [] };
  assert.equal(
    avaliarGatilhoDeComentario(antes, antes, ataque, 'ana'),
    'ataque_sofrido',
  );

  // Baixa Iluminação: estado resultante do bot em emBaixaIluminacao.
  const ataqueBaixa = {
    type: 'ATAQUE_RESOLVIDO',
    peoesAtingidos: ['peao-branco'],
    protegidos: [],
    estadosAplicados: [
      { jogadorId: 'ana', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
    ],
  };
  assert.equal(
    avaliarGatilhoDeComentario(antes, antes, ataqueBaixa, 'ana'),
    'baixa_iluminacao',
  );

  // Resgate: qualquer RESGATE_REALIZADO dispara (aliados incluídos).
  const resgate = { type: 'RESGATE_REALIZADO', pecaId: 'p1', resgatadoJogadorId: 'bruno', resgatadorJogadorId: 'ana', resgatadorPeaoId: 'peao-branco' };
  assert.equal(avaliarGatilhoDeComentario(antes, antes, resgate, 'ana'), 'resgate');

  // Vitória e derrota pelo PARTIDA_TERMINADA.
  assert.equal(
    avaliarGatilhoDeComentario(antes, antes, { type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }, 'ana'),
    'vitoria',
  );
  assert.equal(
    avaliarGatilhoDeComentario(antes, antes, { type: 'PARTIDA_TERMINADA', resultado: 'derrota', motivo: 'equipe_amedrontada' }, 'ana'),
    'derrota',
  );
});

test('evento irrelevante não dispara gatilho', () => {
  const antes = estadoFresco();
  const eventosIrrelevantes = [
    { type: 'TURNO_INICIADO', jogadorId: 'ana', rodada: 1 },
    { type: 'PECA_GIRADA', pecaId: 'p1', orientacao: 90 },
    { type: 'MENSAGEM_DE_CHAT_DA_PARTIDA', jogadorId: 'bruno', apelido: 'bruno', conteudo: 'olá', enviadoEm: 'x' },
    null,
    'string solta',
  ];
  for (const evento of eventosIrrelevantes) {
    assert.equal(avaliarGatilhoDeComentario(antes, antes, evento, 'ana'), null);
  }

  // POSICAO_CONFIRMADA sem mudança de objetivos também é irrelevante.
  assert.equal(
    avaliarGatilhoDeComentario(antes, antes, { type: 'POSICAO_CONFIRMADA' }, 'ana'),
    null,
  );

  // Ataque em que o bot NÃO é atingido nem entra em Baixa: sem comentário.
  const ataqueAlheio = {
    type: 'ATAQUE_RESOLVIDO',
    peoesAtingidos: ['peao-vermelho'],
    protegidos: [],
    estadosAplicados: [
      { jogadorId: 'bruno', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
    ],
  };
  assert.equal(avaliarGatilhoDeComentario(antes, antes, ataqueAlheio, 'ana'), null);
});

// --- Fila FIFO com cooldown ----------------------------------------------------

const esperar = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('cooldown mínimo suprime o segundo comentário dentro da janela', async () => {
  const enviados: string[] = [];
  const comentarista = new ComentaristaDeBot({
    enviar: (conteudo) => enviados.push(conteudo),
    cooldownMinimoMs: 30,
  });
  try {
    comentarista.observarGatilho('resgate');
    comentarista.observarGatilho('resgate');
    await esperar(5);
    // Só o primeiro saiu; o segundo está na fila aguardando o cooldown.
    assert.equal(enviados.length, 1);
    assert.equal(comentarista.tamanhoDaFila, 1);
    await esperar(60);
    // O cooldown venceu: o segundo sai — sem suprimir a mensagem, sem
    // adiantar a próxima (mesma ordem da fila).
    assert.equal(enviados.length, 2);
  } finally {
    comentarista.encerrar();
  }
});

test('rajada de gatilhos sai em sequência FIFO (uma mensagem por cooldown)', async () => {
  const enviados: string[] = [];
  const comentarista = new ComentaristaDeBot({
    enviar: (conteudo) => enviados.push(conteudo),
    cooldownMinimoMs: 15,
  });
  try {
    comentarista.observarGatilho('gerador_ligado');
    comentarista.observarGatilho('chave_obtida');
    comentarista.observarGatilho('resgate');
    await esperar(120);
    // O sorteio de texto é aleatório (sem repetição imediata garantida por
    // `sortearTexto`); o que a fila garante é a ORDEM FIFO entre gatilhos.
    const [primeiro, segundo, terceiro] = enviados;
    assert.ok(TEXTOS_POR_GATILHO.gerador_ligado.includes(primeiro!), '1º da fila: gerador');
    assert.ok(TEXTOS_POR_GATILHO.chave_obtida.includes(segundo!), '2º da fila: chave');
    assert.ok(TEXTOS_POR_GATILHO.resgate.includes(terceiro!), '3º da fila: resgate');
  } finally {
    comentarista.encerrar();
  }
});

test('encerrar (close do bot) limpa a fila e não envia mais nada', async () => {
  const enviados: string[] = [];
  const comentarista = new ComentaristaDeBot({
    enviar: (conteudo) => enviados.push(conteudo),
    cooldownMinimoMs: 15,
  });
  comentarista.observarGatilho('resgate');
  await esperar(5);
  assert.equal(enviados.length, 1);
  comentarista.observarGatilho('resgate');
  comentarista.encerrar();
  await esperar(60);
  assert.equal(enviados.length, 1);
});
