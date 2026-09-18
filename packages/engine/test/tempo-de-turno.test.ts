import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BORDA_OPOSTA,
  aplicarComandoDePartida,
  bordasAbertas,
  CARENCIA_AVISO_FINAL_SEGUNDOS,
  estadoInicialDaPartida,
  LIMITE_FALTAS_PARA_DESISTENCIA,
  resolverExpiracaoDoTurno,
  sortearDaCaixa,
  type ComandoDePartida,
  type EstadoDaPartida,
  type EventoDaPartida,
  type Orientacao,
  type PecaPosicionada,
} from '../src/index.ts';

// Tempo de turno (issue #429, spec #405): seam puro do engine — sem timers
// reais nem rede. Cada teste chama resolverExpiracaoDoTurno sobre um estado
// montado (via comandos reais ou mutação direta do seam, no padrão dos testes
// de desistência e término) e confere a resolução por etapa do Apêndice, a
// flag única do aviso final, a queima sem retorno à Caixa e a regra de faltas.

const selecionarPeca = (pecaId: string) =>
  ({ tipo: 'selecionar_peca', pecaId }) as const;

const girarPeca = (pecaId: string) =>
  ({ tipo: 'girar_peca', pecaId, sentido: 'horario' }) as const;

const posicionarPeca = (pecaId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peca', pecaId, celula: { linha, coluna } }) as const;

const escolherVaga = (
  recebidaId: string,
  borda: 'norte' | 'leste' | 'sul' | 'oeste',
) =>
  ({ tipo: 'escolher_vaga_da_peca_recebida', recebidaId, borda }) as const;

const posicionarPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peao', peaoId, celula: { linha, coluna } }) as const;

const selecionarPeao = (peaoId: string) =>
  ({ tipo: 'selecionar_peao', peaoId }) as const;

const encerrarTurno = () => ({ tipo: 'encerrar_turno' }) as const;

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

function resolver(estado: EstadoDaPartida): {
  estado: EstadoDaPartida;
  eventos: readonly EventoDaPartida[];
} {
  const resultado = resolverExpiracaoDoTurno(estado);
  if (!resultado.sucesso) {
    throw new Error(`${resultado.erro.codigo}: ${resultado.erro.mensagem}`);
  }
  return { estado: resultado.estado, eventos: resultado.eventos };
}

function partidaIniciadaCom(roster: readonly string[]): EstadoDaPartida {
  const resultado = estadoInicialDaPartida(roster);
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

// Resolve todas as pendências do Recebimento (mesmo fixture de partida.test.ts:
// primeira borda canônica disponível, giro até conectar, encaixe na célula-alvo).
function resolverRecebidas(
  estado: EstadoDaPartida,
  ator: string,
): EstadoDaPartida {
  while (estado.tabuleiro.recebidas.length > 0) {
    const pendente = estado.tabuleiro.recebidas[0];
    let resolvida: EstadoDaPartida | undefined;
    for (const borda of ['norte', 'leste', 'sul', 'oeste'] as const) {
      const resultado = aplicarComandoDePartida(
        estado,
        escolherVaga(pendente.recebidaId, borda),
        ator,
      );
      if (resultado.sucesso) {
        resolvida = resultado.estado;
        break;
      }
    }
    if (!resolvida) {
      throw new Error(
        `nenhuma vaga disponível para a pendência ${pendente.recebidaId}`,
      );
    }
    estado = resolvida;
    const escolhida = estado.tabuleiro.recebidas.find(
      (item) => item.recebidaId === pendente.recebidaId,
    );
    if (!escolhida || escolhida.celulaAlvo === null || escolhida.vaga === null) {
      throw new Error('Recebida escolhida deveria ter vaga com célula-alvo');
    }
    const alvo = BORDA_OPOSTA[escolhida.vaga];
    let giros = 0;
    while (
      giros < 4 &&
      !bordasAbertas({
        tipo: escolhida.tipo,
        orientacao: ((escolhida.orientacao + 90 * giros) %
          360) as Orientacao,
      }).includes(alvo)
    ) {
      giros++;
    }
    if (giros === 4) {
      throw new Error(
        `nenhuma rotação conecta a pendência ${pendente.recebidaId}`,
      );
    }
    for (let giro = 0; giro < giros; giro++) {
      estado = aplicar(estado, girarPeca(escolhida.pecaId), ator);
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

// Primeiro Turno completo do Jogador Ativo até o ponto pré-encerramento (peça
// + peão + recebidas resolvidas, sem encerrar) ou com encerramento.
function primeiroTurnoAte(
  estado: EstadoDaPartida,
  celula: { linha: number; coluna: number },
  encerrar: boolean,
): EstadoDaPartida {
  const ator = estado.jogadorAtivoId;
  const jogador = jogadorAtivo(estado);
  const pecaId = `inicial-${jogador.ordem}`;
  estado = aplicar(estado, selecionarPeca(pecaId), ator);
  estado = aplicar(estado, posicionarPeca(pecaId, celula.linha, celula.coluna), ator);
  estado = aplicar(estado, selecionarPeao(jogador.peaoId), ator);
  estado = aplicar(
    estado,
    posicionarPeao(jogador.peaoId, celula.linha, celula.coluna),
    ator,
  );
  estado = resolverRecebidas(estado, ator);
  return encerrar ? aplicar(estado, encerrarTurno(), ator) : estado;
}

// Partida N=2 com os dois Primeiros Turnos concluídos: vez da ana em turno
// normal (rodada 2), peão sobre a inicial-1.
function partidaEmTurnoNormal(): EstadoDaPartida {
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = primeiroTurnoAte(estado, { linha: 3, coluna: 3 }, true);
  estado = primeiroTurnoAte(estado, { linha: 0, coluna: 0 }, true);
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.rodada, 2);
  return estado;
}

function comBaixa(
  estado: EstadoDaPartida,
  jogadorId: string,
): EstadoDaPartida {
  return {
    ...estado,
    jogadores: estado.jogadores.map((jogador) =>
      jogador.jogadorId === jogadorId
        ? { ...jogador, emBaixaIluminacao: true }
        : jogador,
    ),
  };
}

function teleportarPeao(
  estado: EstadoDaPartida,
  peaoId: string,
  pecaId: string | null,
): EstadoDaPartida {
  return {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      peoes: estado.tabuleiro.peoes.map((peao) =>
        peao.peaoId === peaoId ? { ...peao, pecaId } : peao,
      ),
    },
  };
}

// Primeira célula vazia da grade 7x7 — ponto de apoio para peças artesanais da
// Travessia sem colidir com o tabuleiro real do fixture.
function celulaLivre(estado: EstadoDaPartida): { linha: number; coluna: number } {
  const ocupadas = new Set(
    estado.tabuleiro.posicionadas.map(
      (peca) => `${peca.celula.linha},${peca.celula.coluna}`,
    ),
  );
  for (let linha = 0; linha < 7; linha++) {
    for (let coluna = 0; coluna < 7; coluna++) {
      if (!ocupadas.has(`${linha},${coluna}`)) {
        return { linha, coluna };
      }
    }
  }
  throw new Error('grade sem célula livre para o fixture');
}

// Última célula vazia da grade 7x7 (varredura reversa) — ponto de apoio para
// peças-fantasma da Limpeza, longe da Iluminação do fixture.
function celulaLivreDistante(estado: EstadoDaPartida): { linha: number; coluna: number } {
  const ocupadas = new Set(
    estado.tabuleiro.posicionadas.map(
      (peca) => `${peca.celula.linha},${peca.celula.coluna}`,
    ),
  );
  for (let linha = 6; linha >= 0; linha--) {
    for (let coluna = 6; coluna >= 0; coluna--) {
      if (!ocupadas.has(`${linha},${coluna}`)) {
        return { linha, coluna };
      }
    }
  }
  throw new Error('grade sem célula livre para o fixture');
}

const peca = (
  pecaId: string,
  tipo: PecaPosicionada['tipo'],
  linha: number,
  coluna: number,
): PecaPosicionada => ({
  pecaId,
  tipo,
  orientacao: 0,
  celula: { linha, coluna },
});

function tipos(eventos: readonly EventoDaPartida[]): string[] {
  return eventos.map((evento) => evento.tipo);
}

function faltaDe(
  eventos: readonly EventoDaPartida[],
  jogadorId: string,
): { tipo: string; jogadorId: string; totalDeFaltas: number } {
  const falta = eventos.find((evento) => evento.tipo === 'falta_registrada');
  assert.ok(falta && falta.tipo === 'falta_registrada', 'esperava falta_registrada');
  assert.equal(falta.jogadorId, jogadorId);
  return falta;
}

// Constantes nomeadas e ajustáveis da regra pura.
test('constantes do tempo de turno: 4 faltas convertem em Desistência; carência do aviso final é 30s', () => {
  assert.equal(LIMITE_FALTAS_PARA_DESISTENCIA, 4);
  assert.equal(CARENCIA_AVISO_FINAL_SEGUNDOS, 30);
});

// Apêndice item 1 — Primeiro Turno com a etapa da Peça Inicial não concluída:
// aviso final na 1ª vez, sem falta e sem avanço; a inicial nunca é queimada.
test('item 1: inicial não posicionada gera aviso final sem falta e sem avanço', () => {
  const estado = partidaIniciadaCom(['ana', 'bruno']);
  const { estado: apos, eventos } = resolver(estado);

  assert.deepEqual(tipos(eventos), ['aviso_final_do_primeiro_turno']);
  assert.equal(eventos[0].tipo === 'aviso_final_do_primeiro_turno' ? eventos[0].jogadorId : undefined, 'ana');
  assert.equal(apos.jogadorAtivoId, 'ana');
  assert.equal(apos.rodada, 1);
  assert.deepEqual(apos.faltasPorJogador, {});
  assert.deepEqual(apos.avisoFinalConsumidoPorJogador, { ana: true });
  // A inicial segue fora do Tabuleiro — nunca queimada.
  assert.ok(apos.tabuleiro.iniciais.some((item) => item.pecaId === 'inicial-1'));
  assert.ok(!apos.tabuleiro.posicionadas.some((item) => item.pecaId === 'inicial-1'));
});

// Apêndice item 2 — peão não colocado no Primeiro Turno: aviso final na 1ª vez.
test('item 2: peão não colocado gera aviso final sem falta', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  const { estado: apos, eventos } = resolver(estado);

  assert.deepEqual(tipos(eventos), ['aviso_final_do_primeiro_turno']);
  assert.deepEqual(apos.faltasPorJogador, {});
  assert.deepEqual(apos.avisoFinalConsumidoPorJogador, { ana: true });
  assert.equal(apos.jogadorAtivoId, 'ana');
});

// Aviso final consumido + etapa ainda incompleta: Desistência com causa
// 'tempo' — mesmo efeito e eventos da Desistência.
test('aviso consumido e etapa incompleta: desistência com causa tempo e passagem imediata', () => {
  const base = partidaIniciadaCom(['ana', 'bruno']);
  const comAviso: EstadoDaPartida = {
    ...base,
    avisoFinalConsumidoPorJogador: { ana: true },
  };
  const { estado: apos, eventos } = resolver(comAviso);

  assert.equal(apos.jogadores.length, 1);
  assert.equal(apos.jogadorAtivoId, 'bruno');
  const desistencia = eventos.find(
    (evento) => evento.tipo === 'desistencia_registrada',
  );
  assert.ok(desistencia && desistencia.tipo === 'desistencia_registrada');
  assert.equal(desistencia.jogadorId, 'ana');
  assert.equal(desistencia.causa, 'tempo');
  // Passagem imediata do Ativo desistente + derrota do quórum reavaliada.
  assert.ok(tipos(eventos).includes('turno_encerrado'));
  assert.ok(tipos(eventos).includes('turno_iniciado'));
  assert.deepEqual(apos.resultado, { tipo: 'derrota', motivo: 'desistencia' });
  const ultimo = eventos[eventos.length - 1];
  assert.equal(ultimo.tipo, 'partida_terminada');
});

// Flag única: jogou dentro do acréscimo → segue sem falta, com a flag consumida.
test('aviso jogado dentro do acréscimo: turno conclui sem falta e a flag fica consumida', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  const aviso = resolver(estado);
  assert.deepEqual(tipos(aviso.eventos), ['aviso_final_do_primeiro_turno']);
  estado = primeiroTurnoAte(aviso.estado, { linha: 3, coluna: 3 }, true);

  assert.equal(estado.jogadorAtivoId, 'bruno');
  assert.deepEqual(estado.faltasPorJogador, {});
  assert.deepEqual(estado.avisoFinalConsumidoPorJogador, { ana: true });
  const ana = estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.primeiroTurnoPendente, false);
});

// Apêndice item 3 — Primeiro Turno com peça + peão OK e recebida pendente:
// queima + encerra + 1 falta, sem retorno à Caixa.
test('item 3: recebida pendente no primeiro turno queima, encerra e soma 1 falta', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.ok(estado.tabuleiro.recebidas.length > 0);
  const pendentes = estado.tabuleiro.recebidas.map((item) => item.pecaId);
  const caixaAntes = estado.tabuleiro.caixa.length;

  const { estado: apos, eventos } = resolver(estado);

  const falta = faltaDe(eventos, 'ana');
  assert.equal(falta.totalDeFaltas, 1);
  const queima = eventos.find((evento) => evento.tipo === 'pecas_queimadas');
  assert.ok(queima && queima.tipo === 'pecas_queimadas');
  assert.deepEqual([...queima.pecaIds].sort(), [...pendentes].sort());
  assert.deepEqual(apos.tabuleiro.recebidas, []);
  // Sem retorno à Caixa: o tamanho não cresce e as queimadas não estão nela.
  assert.equal(apos.tabuleiro.caixa.length, caixaAntes);
  const idsNaCaixa = new Set(apos.tabuleiro.caixa.map((item) => item.pecaId));
  for (const queimada of pendentes) {
    assert.ok(!idsNaCaixa.has(queimada));
    assert.ok(!apos.tabuleiro.posicionadas.some((item) => item.pecaId === queimada));
  }
  assert.deepEqual(apos.faltasPorJogador, { ana: 1 });
  assert.equal(apos.jogadorAtivoId, 'bruno');
  const ana = apos.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.primeiroTurnoPendente, false);
  assert.ok(tipos(eventos).includes('turno_encerrado'));
  assert.ok(tipos(eventos).includes('turno_iniciado'));
});

// Apêndice item 4 — Primeiro Turno tudo feito, sem encerrar: encerra + 1 falta.
test('item 4: primeiro turno completo sem encerrar encerra forçado com 1 falta', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = primeiroTurnoAte(estado, { linha: 3, coluna: 3 }, false);
  assert.equal(estado.tabuleiro.recebidas.length, 0);

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  assert.ok(!tipos(eventos).includes('pecas_queimadas'));
  assert.ok(tipos(eventos).includes('turno_encerrado'));
  assert.ok(tipos(eventos).includes('turno_iniciado'));
  assert.equal(apos.jogadorAtivoId, 'bruno');
  assert.deepEqual(apos.faltasPorJogador, { ana: 1 });
});

// Apêndice item 5 — turno normal com o peão parado: permanência forçada + 1 falta.
test('item 5: peão parado em turno normal sofre permanência forçada com 1 falta', () => {
  const estado = partidaEmTurnoNormal();
  assert.equal(estado.pecaDoInicioDoTurnoId, 'inicial-1');

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(eventos[0].tipo, 'falta_registrada');
  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  assert.ok(tipos(eventos).includes('peao_permaneceu'));
  assert.ok(tipos(eventos).includes('turno_encerrado'));
  const iniciado = eventos.find((evento) => evento.tipo === 'turno_iniciado');
  assert.ok(iniciado && iniciado.tipo === 'turno_iniciado');
  assert.equal(iniciado.jogadorId, 'bruno');
  assert.equal(apos.jogadorAtivoId, 'bruno');
  assert.deepEqual(apos.faltasPorJogador, { ana: 1 });
});

// Apêndice item 6 — peão movido sem confirmar: volta à origem + permanece + 1 falta.
test('item 6: peão movido sem confirmar volta à origem e permanece com 1 falta', () => {
  let estado = partidaEmTurnoNormal();
  const origem = estado.pecaDoInicioDoTurnoId;
  assert.ok(origem !== null);
  estado = teleportarPeao(estado, 'peao-branco', 'inicial-2');

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  assert.ok(tipos(eventos).includes('peao_permaneceu'));
  const peao = apos.tabuleiro.peoes.find((item) => item.peaoId === 'peao-branco');
  assert.equal(peao?.pecaId, origem);
  assert.equal(apos.jogadorAtivoId, 'bruno');
  assert.deepEqual(apos.faltasPorJogador, { ana: 1 });
});

// Apêndice item 7 — recebida pendente em turno normal: queima + encerra + 1 falta.
test('item 7: recebida pendente em turno normal queima e encerra com 1 falta', () => {
  let estado = partidaEmTurnoNormal();
  const pendente = {
    recebidaId: 'rec-expiry-1',
    pecaId: 'queima-1',
    tipo: 'reta' as const,
    orientacao: 0 as Orientacao,
    vaga: null,
    celulaAlvo: null,
  };
  estado = {
    ...estado,
    posicaoConfirmada: true,
    tabuleiro: { ...estado.tabuleiro, recebidas: [pendente] },
  };
  const caixaAntes = estado.tabuleiro.caixa.length;

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  const queima = eventos.find((evento) => evento.tipo === 'pecas_queimadas');
  assert.ok(queima && queima.tipo === 'pecas_queimadas');
  assert.deepEqual(queima.pecaIds, ['queima-1']);
  assert.deepEqual(apos.tabuleiro.recebidas, []);
  assert.equal(apos.tabuleiro.caixa.length, caixaAntes);
  assert.ok(tipos(eventos).includes('turno_encerrado'));
  assert.ok(tipos(eventos).includes('turno_iniciado'));
  assert.equal(apos.jogadorAtivoId, 'bruno');
});

// Queima sem retorno à Caixa: o único Portão de Saída pendente é queimado no
// expiry e o Esgotamento conta a Caixa vazia sem ele — derrota por
// caixa_esgotada no funil e sorteio seguinte com CAIXA_ESGOTADA.
test('queima sem retorno: Esgotamento com queimadas prova CAIXA_ESGOTADA', () => {
  let estado = partidaEmTurnoNormal();
  estado = {
    ...estado,
    posicaoConfirmada: true,
    tabuleiro: {
      ...estado.tabuleiro,
      caixa: [],
      recebidas: [
        {
          recebidaId: 'rec-esg-1',
          pecaId: 'queima-esg-1',
          tipo: 'portao_de_saida',
          orientacao: 0,
          vaga: null,
          celulaAlvo: null,
        },
      ],
    },
  };

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  const queima = eventos.find((evento) => evento.tipo === 'pecas_queimadas');
  assert.ok(queima && queima.tipo === 'pecas_queimadas');
  assert.deepEqual(queima.pecaIds, ['queima-esg-1']);
  // Sem retorno à Caixa: continua vazia, sem recebidas e sem a queimada.
  assert.equal(apos.tabuleiro.caixa.length, 0);
  assert.ok(
    !apos.tabuleiro.caixa.some((item) => item.pecaId === 'queima-esg-1'),
  );
  assert.deepEqual(apos.tabuleiro.recebidas, []);
  assert.ok(
    !apos.tabuleiro.posicionadas.some((item) => item.pecaId === 'queima-esg-1'),
  );
  // Sorteio seguinte esgota: a Caixa vazia rejeita com CAIXA_ESGOTADA.
  const sorteio = sortearDaCaixa(apos.tabuleiro);
  assert.equal(sorteio.sucesso, false);
  if (!sorteio.sucesso) {
    assert.equal(sorteio.erro.codigo, 'CAIXA_ESGOTADA');
  }
  // Esgotamento contável: sem o Portão queimado em mãos, os objetivos faltam
  // com a Caixa vazia — derrota por caixa_esgotada no funil.
  assert.deepEqual(apos.resultado, { tipo: 'derrota', motivo: 'caixa_esgotada' });
  const ultimo = eventos[eventos.length - 1];
  assert.equal(ultimo.tipo, 'partida_terminada');
});

// Apêndice item 8 — tudo feito sem encerrar: encerra forçado + 1 falta.
test('item 8: posição confirmada sem pendências encerra forçado com 1 falta', () => {
  let estado = partidaEmTurnoNormal();
  estado = { ...estado, posicaoConfirmada: true };

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  assert.ok(!tipos(eventos).includes('pecas_queimadas'));
  assert.ok(!tipos(eventos).includes('peao_permaneceu'));
  assert.ok(tipos(eventos).includes('turno_encerrado'));
  assert.ok(tipos(eventos).includes('turno_iniciado'));
  assert.equal(apos.jogadorAtivoId, 'bruno');
});

// Apêndice item 15 — toggle selecionar/finalizar sem solução própria: manipulação
// aberta finaliza como está e só-seleção é descartada na Passagem.
test('item 15: manipulação aberta finaliza como está e seleções são descartadas', () => {
  let estado = partidaEmTurnoNormal();
  estado = {
    ...estado,
    posicaoConfirmada: true,
    tabuleiro: {
      ...estado.tabuleiro,
      pecaSelecionadaId: 'inicial-1',
      pecaEmManipulacaoId: 'inicial-1',
      peaoSelecionadoId: 'peao-branco',
    },
  };

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  assert.ok(tipos(eventos).includes('manipulacao_finalizada'));
  assert.ok(tipos(eventos).includes('turno_iniciado'));
  assert.equal(apos.tabuleiro.pecaSelecionadaId, null);
  assert.equal(apos.tabuleiro.pecaEmManipulacaoId, null);
  assert.equal(apos.tabuleiro.peaoSelecionadoId, null);
});

// Apêndice item 9 — Baixa Iluminação sem nada feito: permanência forçada + 1 falta.
test('item 9: baixa iluminação sem nada feito sofre permanência forçada', () => {
  const estado = comBaixa(partidaEmTurnoNormal(), 'ana');

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  assert.ok(tipos(eventos).includes('peao_permaneceu'));
  assert.equal(apos.jogadorAtivoId, 'bruno');
});

// Apêndice item 10 — Baixa moveu por caminho iluminado sem confirmar: volta +
// permanece + 1 falta.
test('item 10: baixa com peão movido volta à origem e permanece', () => {
  let estado = comBaixa(partidaEmTurnoNormal(), 'ana');
  const origem = estado.pecaDoInicioDoTurnoId;
  estado = teleportarPeao(estado, 'peao-branco', 'inicial-2');

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  assert.ok(tipos(eventos).includes('peao_permaneceu'));
  const peao = apos.tabuleiro.peoes.find((item) => item.peaoId === 'peao-branco');
  assert.equal(peao?.pecaId, origem);
  assert.equal(apos.jogadorAtivoId, 'bruno');
});

// Apêndice item 11 — travessia aberta com a aposta pendente: queima + volta +
// permanência + 1 falta.
test('item 11a: travessia com recebida pendente queima e fecha por permanência', () => {
  let estado = comBaixa(partidaEmTurnoNormal(), 'ana');
  const alvo = celulaLivre(estado);
  estado = {
    ...estado,
    atravessouNoTurno: true,
    pecaDaTravessiaId: null,
    tabuleiro: {
      ...estado.tabuleiro,
      recebidas: [
        {
          recebidaId: 'rec-travessia-1',
          pecaId: 'aposta-1',
          tipo: 'reta',
          orientacao: 0,
          vaga: 'norte',
          celulaAlvo: alvo,
        },
      ],
    },
  };

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  const queima = eventos.find((evento) => evento.tipo === 'pecas_queimadas');
  assert.ok(queima && queima.tipo === 'pecas_queimadas');
  assert.deepEqual(queima.pecaIds, ['aposta-1']);
  assert.deepEqual(apos.tabuleiro.recebidas, []);
  assert.equal(apos.atravessouNoTurno, false);
  assert.equal(apos.pecaDaTravessiaId, null);
  assert.ok(tipos(eventos).includes('peao_permaneceu'));
  assert.equal(apos.jogadorAtivoId, 'bruno');
});

// Apêndice item 11 — aposta posicionada com o peão sobre ela: confirmação
// (mover compulsório cumprido) + encerramento + 1 falta; a aposta permanece.
test('item 11b: travessia posicionada com o peão sobre ela confirma e encerra', () => {
  let estado = comBaixa(partidaEmTurnoNormal(), 'ana');
  const livre = celulaLivre(estado);
  estado = {
    ...estado,
    atravessouNoTurno: true,
    pecaDaTravessiaId: 'trav-1',
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [...estado.tabuleiro.posicionadas, peca('trav-1', 'reta', livre.linha, livre.coluna)],
    },
  };
  estado = teleportarPeao(estado, 'peao-branco', 'trav-1');

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  assert.ok(tipos(eventos).includes('posicao_confirmada'));
  assert.ok(tipos(eventos).includes('turno_encerrado'));
  assert.ok(tipos(eventos).includes('turno_iniciado'));
  assert.ok(apos.tabuleiro.posicionadas.some((item) => item.pecaId === 'trav-1'));
  const peao = apos.tabuleiro.peoes.find((item) => item.peaoId === 'peao-branco');
  assert.equal(peao?.pecaId, 'trav-1');
  assert.equal(apos.jogadorAtivoId, 'bruno');
});

// Apêndice item 11 — aposta Monstro (não aceita peão): queima + volta +
// permanência + 1 falta.
test('item 11c: travessia com aposta monstro queima e fecha por permanência', () => {
  let estado = comBaixa(partidaEmTurnoNormal(), 'ana');
  const origem = estado.pecaDoInicioDoTurnoId;
  const livre = celulaLivre(estado);
  estado = {
    ...estado,
    atravessouNoTurno: true,
    pecaDaTravessiaId: 'monstro-1',
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [
        ...estado.tabuleiro.posicionadas,
        peca('monstro-1', 'vulto', livre.linha, livre.coluna),
      ],
    },
  };

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  const queima = eventos.find((evento) => evento.tipo === 'pecas_queimadas');
  assert.ok(queima && queima.tipo === 'pecas_queimadas');
  assert.deepEqual(queima.pecaIds, ['monstro-1']);
  assert.ok(!apos.tabuleiro.posicionadas.some((item) => item.pecaId === 'monstro-1'));
  assert.ok(tipos(eventos).includes('peao_permaneceu'));
  const peao = apos.tabuleiro.peoes.find((item) => item.peaoId === 'peao-branco');
  assert.equal(peao?.pecaId, origem);
  assert.equal(apos.jogadorAtivoId, 'bruno');
});

// Apêndice item 11 — aposta queimada no mesmo funil da Desistência: a queima
// recalcula a Iluminação e aplica a Limpeza antes da Permanência.
test('item 11d: travessia com aposta queimada recalcula Iluminação e aplica Limpeza', () => {
  let estado = comBaixa(partidaEmTurnoNormal(), 'ana');
  const origem = estado.pecaDoInicioDoTurnoId;
  assert.ok(origem !== null);
  const aposta = celulaLivre(estado);
  estado = {
    ...estado,
    atravessouNoTurno: true,
    pecaDaTravessiaId: 'trav-ilum',
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [
        ...estado.tabuleiro.posicionadas,
        peca('trav-ilum', 'reta', aposta.linha, aposta.coluna),
      ],
    },
  };
  const sombra = celulaLivreDistante(estado);
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [
        ...estado.tabuleiro.posicionadas,
        peca('sombra-ilum', 'reta', sombra.linha, sombra.coluna),
      ],
    },
  };
  // Peão movido por fixture direto: a Iluminação vigente fica defasada e o
  // recálculo da queima a republica antes da Permanência.
  estado = teleportarPeao(estado, 'peao-branco', 'inicial-2');

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  assert.ok(
    !apos.tabuleiro.posicionadas.some((item) => item.pecaId === 'trav-ilum'),
  );
  assert.ok(tipos(eventos).includes('celulas_iluminadas'));
  const limpeza = eventos.find((evento) => evento.tipo === 'limpeza_aplicada');
  assert.ok(limpeza && limpeza.tipo === 'limpeza_aplicada');
  assert.ok(limpeza.pecasRemovidas.includes('sombra-ilum'));
  assert.ok(tipos(eventos).includes('peao_permaneceu'));
  const peao = apos.tabuleiro.peoes.find((item) => item.peaoId === 'peao-branco');
  assert.equal(peao?.pecaId, origem);
  assert.equal(apos.jogadorAtivoId, 'bruno');
});
test('item 12: baixa com posição confirmada encerra forçado com 1 falta', () => {
  let estado = comBaixa(partidaEmTurnoNormal(), 'ana');
  estado = { ...estado, posicaoConfirmada: true };

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 1);
  assert.ok(tipos(eventos).includes('turno_encerrado'));
  assert.equal(apos.jogadorAtivoId, 'bruno');
});

// Faltas: expiries abaixo do limite acumulam sem Desistência.
test('faltas acumulam por expiry sem Desistência abaixo do limite', () => {
  let estado = partidaEmTurnoNormal();
  estado = {
    ...estado,
    faltasPorJogador: { ana: 2 },
  };

  const { estado: apos, eventos } = resolver(estado);

  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 3);
  assert.equal(apos.jogadores.length, 2);
  assert.equal(apos.jogadorAtivoId, 'bruno');
  assert.deepEqual(apos.faltasPorJogador, { ana: 3 });
  assert.equal(apos.resultado, null);
});

// Faltas: na 4ª, conversão em Desistência automática com causa 'tempo' —
// Passagem imediata, Iluminação recalculada, Limpeza e vitória reavaliadas.
test('4ª falta converte em desistência com causa tempo, passagem e término', () => {
  let estado = partidaEmTurnoNormal();
  estado = {
    ...estado,
    faltasPorJogador: { ana: 3 },
  };

  const { estado: apos, eventos } = resolver(estado);
  const ordem = tipos(eventos);

  assert.equal(ordem[0], 'falta_registrada');
  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 4);
  const desistencia = eventos.find(
    (evento) => evento.tipo === 'desistencia_registrada',
  );
  assert.ok(desistencia && desistencia.tipo === 'desistencia_registrada');
  assert.equal(desistencia.jogadorId, 'ana');
  assert.equal(desistencia.causa, 'tempo');
  // Mesmo efeito da Desistência: peão excluído, vez fora da ordem e Passagem
  // imediata do Ativo com recálculo de Iluminação e Limpeza no ato.
  assert.ok(!apos.jogadores.some((jogador) => jogador.jogadorId === 'ana'));
  assert.ok(!apos.tabuleiro.peoes.some((peao) => peao.peaoId === 'peao-branco'));
  assert.ok(ordem.includes('turno_encerrado'));
  assert.ok(ordem.includes('turno_iniciado'));
  assert.equal(apos.jogadorAtivoId, 'bruno');
  assert.deepEqual(apos.faltasPorJogador, { ana: 4 });
  // Vitória reavaliada: N=2→1 termina em derrota por desistência.
  assert.deepEqual(apos.resultado, { tipo: 'derrota', motivo: 'desistencia' });
  assert.equal(ordem[ordem.length - 1], 'partida_terminada');
});

// 4ª falta com recebidas pendentes: queima antes da Desistência — o lote abre
// com [falta_registrada, pecas_queimadas, desistencia_registrada(tempo)].
test('4ª falta com recebidas queima antes da desistência com causa tempo', () => {
  let estado = partidaEmTurnoNormal();
  estado = {
    ...estado,
    faltasPorJogador: { ana: 3 },
    tabuleiro: {
      ...estado.tabuleiro,
      recebidas: [
        {
          recebidaId: 'rec-falta-4',
          pecaId: 'queima-falta-4',
          tipo: 'reta',
          orientacao: 0,
          vaga: null,
          celulaAlvo: null,
        },
      ],
    },
  };
  const caixaAntes = estado.tabuleiro.caixa.length;

  const { estado: apos, eventos } = resolver(estado);
  const ordem = tipos(eventos);

  assert.equal(ordem[0], 'falta_registrada');
  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 4);
  const queima = eventos.find((evento) => evento.tipo === 'pecas_queimadas');
  assert.ok(queima && queima.tipo === 'pecas_queimadas');
  assert.deepEqual(queima.pecaIds, ['queima-falta-4']);
  assert.deepEqual(ordem.slice(0, 3), [
    'falta_registrada',
    'pecas_queimadas',
    'desistencia_registrada',
  ]);
  const desistencia = eventos.find(
    (evento) => evento.tipo === 'desistencia_registrada',
  );
  assert.ok(desistencia && desistencia.tipo === 'desistencia_registrada');
  assert.equal(desistencia.jogadorId, 'ana');
  assert.equal(desistencia.causa, 'tempo');
  assert.deepEqual(apos.tabuleiro.recebidas, []);
  assert.equal(apos.tabuleiro.caixa.length, caixaAntes);
  assert.ok(!apos.jogadores.some((jogador) => jogador.jogadorId === 'ana'));
  assert.equal(apos.jogadorAtivoId, 'bruno');
  assert.deepEqual(apos.faltasPorJogador, { ana: 4 });
  assert.deepEqual(apos.resultado, { tipo: 'derrota', motivo: 'desistencia' });
  assert.equal(ordem[ordem.length - 1], 'partida_terminada');
});

// Amedrontado segue pulado sem turno: sem falta, sem relógio.
test('amedrontado é pulado sem falta e sem turno', () => {
  let estado = partidaEmTurnoNormal();
  estado = {
    ...estado,
    jogadores: estado.jogadores.map((jogador) =>
      jogador.jogadorId === 'ana'
        ? { ...jogador, sanidade: 0, amedrontado: true }
        : jogador,
    ),
  };

  const { estado: apos, eventos } = resolver(estado);

  assert.ok(!tipos(eventos).includes('falta_registrada'));
  assert.ok(!tipos(eventos).includes('turno_encerrado'));
  assert.deepEqual(apos.faltasPorJogador, {});
  assert.equal(apos.jogadorAtivoId, 'bruno');
});

// Expiry bloqueado pelo período de graça (issue #171): a falta persiste com o
// turno mantido — sucesso parcial só com falta_registrada, sem
// turno_encerrado; 4 expirys seguidos convertem em Desistência com causa
// 'tempo'. Distingue-se pela ausência de turno_encerrado (mesmo precedente do
// aviso final: sucesso sem avanço de turno).
test('graça bloqueando permanência: falta com turno mantido; 4 expirys viram desistência', () => {
  let estado = partidaEmTurnoNormal();
  const origem = estado.pecaDoInicioDoTurnoId;
  assert.ok(origem !== null);
  estado = { ...estado, pecasEmPeriodoDeGraca: [origem] };

  const primeiro = resolverExpiracaoDoTurno(estado);
  assert.equal(primeiro.sucesso, true);
  if (!primeiro.sucesso) {
    throw new Error('expiry bloqueado deveria persistir a falta');
  }
  assert.deepEqual(tipos(primeiro.eventos), ['falta_registrada']);
  assert.equal(faltaDe(primeiro.eventos, 'ana').totalDeFaltas, 1);
  assert.equal(primeiro.estado.jogadorAtivoId, 'ana');
  assert.equal(primeiro.estado.rodada, estado.rodada);
  assert.deepEqual(primeiro.estado.faltasPorJogador, { ana: 1 });
  assert.equal(primeiro.estado.resultado, null);

  let atual = primeiro.estado;
  for (const total of [2, 3]) {
    const seguinte = resolverExpiracaoDoTurno(atual);
    assert.equal(seguinte.sucesso, true);
    if (!seguinte.sucesso) {
      throw new Error('expiry bloqueado deveria persistir a falta');
    }
    assert.deepEqual(tipos(seguinte.eventos), ['falta_registrada']);
    assert.equal(faltaDe(seguinte.eventos, 'ana').totalDeFaltas, total);
    assert.equal(seguinte.estado.jogadorAtivoId, 'ana');
    assert.deepEqual(seguinte.estado.faltasPorJogador, { ana: total });
    atual = seguinte.estado;
  }

  const quarto = resolverExpiracaoDoTurno(atual);
  assert.equal(quarto.sucesso, true);
  if (!quarto.sucesso) {
    throw new Error('4º expiry bloqueado deveria desistir');
  }
  const ordem = tipos(quarto.eventos);
  assert.equal(ordem[0], 'falta_registrada');
  assert.equal(faltaDe(quarto.eventos, 'ana').totalDeFaltas, 4);
  const desistencia = quarto.eventos.find(
    (evento) => evento.tipo === 'desistencia_registrada',
  );
  assert.ok(desistencia && desistencia.tipo === 'desistencia_registrada');
  assert.equal(desistencia.jogadorId, 'ana');
  assert.equal(desistencia.causa, 'tempo');
  assert.ok(!quarto.estado.jogadores.some((jogador) => jogador.jogadorId === 'ana'));
  assert.equal(quarto.estado.jogadorAtivoId, 'bruno');
  assert.deepEqual(quarto.estado.faltasPorJogador, { ana: 4 });
  assert.deepEqual(quarto.estado.resultado, { tipo: 'derrota', motivo: 'desistencia' });
  assert.equal(ordem[ordem.length - 1], 'partida_terminada');
});

// 4ª falta com travessia aberta e aposta posicionada: queima a aposta antes
// da Desistência — lote [falta_registrada, pecas_queimadas(aposta),
// desistencia_registrada(tempo)] e a aposta fora de posicionadas.
test('4ª falta com travessia aberta queima a aposta posicionada antes da desistência', () => {
  let estado = comBaixa(partidaEmTurnoNormal(), 'ana');
  const livre = celulaLivre(estado);
  estado = {
    ...estado,
    faltasPorJogador: { ana: 3 },
    atravessouNoTurno: true,
    pecaDaTravessiaId: 'trav-4falta',
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [
        ...estado.tabuleiro.posicionadas,
        peca('trav-4falta', 'reta', livre.linha, livre.coluna),
      ],
    },
  };

  const { estado: apos, eventos } = resolver(estado);
  const ordem = tipos(eventos);

  assert.equal(ordem[0], 'falta_registrada');
  assert.equal(faltaDe(eventos, 'ana').totalDeFaltas, 4);
  const queima = eventos.find((evento) => evento.tipo === 'pecas_queimadas');
  assert.ok(queima && queima.tipo === 'pecas_queimadas');
  assert.ok(queima.pecaIds.includes('trav-4falta'));
  const desistencia = eventos.find(
    (evento) => evento.tipo === 'desistencia_registrada',
  );
  assert.ok(desistencia && desistencia.tipo === 'desistencia_registrada');
  assert.equal(desistencia.jogadorId, 'ana');
  assert.equal(desistencia.causa, 'tempo');
  // A queima da aposta precede a Desistência no lote.
  assert.ok(
    ordem.indexOf('falta_registrada') < ordem.indexOf('pecas_queimadas'),
  );
  assert.ok(
    ordem.indexOf('pecas_queimadas') < ordem.indexOf('desistencia_registrada'),
  );
  assert.ok(!apos.tabuleiro.posicionadas.some((item) => item.pecaId === 'trav-4falta'));
  assert.ok(!apos.jogadores.some((jogador) => jogador.jogadorId === 'ana'));
  assert.equal(apos.jogadorAtivoId, 'bruno');
  assert.deepEqual(apos.faltasPorJogador, { ana: 4 });
  assert.deepEqual(apos.resultado, { tipo: 'derrota', motivo: 'desistencia' });
  assert.equal(ordem[ordem.length - 1], 'partida_terminada');
});

// Partida terminada recusa a resolução com o código próprio.
test('partida terminada recusa a expiração com PARTIDA_TERMINADA', () => {
  const estado = partidaEmTurnoNormal();
  const terminado: EstadoDaPartida = {
    ...estado,
    resultado: { tipo: 'derrota', motivo: 'desistencia' },
  };
  const resultado = resolverExpiracaoDoTurno(terminado);
  assert.equal(resultado.sucesso, false);
  if (!resultado.sucesso) {
    assert.equal(resultado.erro.codigo, 'PARTIDA_TERMINADA');
  }
});
