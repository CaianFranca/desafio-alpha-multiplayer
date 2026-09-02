import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aplicarComandoDePartida,
  estadoInicialDaPartida,
  type EstadoDaPartida,
  type PecaPosicionada,
  type Orientacao,
  type TipoDaPeca,
} from '../src/index.ts';

const JOGADORES = ['ana', 'bruno', 'carla', 'diogo'];

const selecionarPeao = (peaoId: string) => ({ tipo: 'selecionar_peao', peaoId } as const);
const moverPeao = (peaoId: string, l: number, c: number) => ({ tipo: 'mover_peao', peaoId, celula: { linha: l, coluna: c } } as const);
const permanecer = (peaoId: string) => ({ tipo: 'permanecer', peaoId } as const);

function aplicar(estado: EstadoDaPartida, cmd: any, ator: string): EstadoDaPartida {
  const r = aplicarComandoDePartida(estado, cmd, ator);
  if (!r.sucesso) throw new Error(`${r.erro.codigo}: ${r.erro.mensagem}`);
  return r.estado;
}
function iniciado(): EstadoDaPartida {
  const r = estadoInicialDaPartida(JOGADORES);
  if (!r.sucesso) throw new Error('init fail');
  return r.estado;
}
function peca(id: string, tipo: TipoDaPeca, o: Orientacao, l: number, c: number): PecaPosicionada {
  return { pecaId: id, tipo, orientacao: o, celula: { linha: l, coluna: c } };
}
function comPeca(s: EstadoDaPartida, id: string, t: TipoDaPeca, o: Orientacao, l: number, c: number): EstadoDaPartida {
  return { ...s, tabuleiro: { ...s.tabuleiro, posicionadas: [...s.tabuleiro.posicionadas, peca(id, t, o, l, c)] } };
}
function comPeaoSobre(s: EstadoDaPartida, peaoId: string, pecaId: string | null): EstadoDaPartida {
  return { ...s, tabuleiro: { ...s.tabuleiro, peoes: s.tabuleiro.peoes.map(p => p.peaoId === peaoId ? { ...p, pecaId } : p) } };
}
function comJogador(s: EstadoDaPartida, jogadorId: string, patch: Partial<{ sanidade: number; amedrontado: boolean; emBaixaIluminacao: boolean }>): EstadoDaPartida {
  return { ...s, jogadores: s.jogadores.map(j => j.jogadorId === jogadorId ? { ...j, ...patch } as any : j) };
}
function forcarAtiva(s: EstadoDaPartida, jogadorId: string): EstadoDaPartida {
  const jog = s.jogadores.find(j => j.jogadorId === jogadorId)!;
  const peao = s.tabuleiro.peoes.find(p => p.peaoId === jog.peaoId)!;
  return {
    ...s,
    jogadorAtivoId: jogadorId,
    pecaDoInicioDoTurnoId: peao.pecaId,
    posicaoConfirmada: false,
    tabuleiro: { ...s.tabuleiro, peaoSelecionadoId: null, recebidas: [] },
  };
}
function comSelecionado(s: EstadoDaPartida, peaoId: string): EstadoDaPartida {
  return { ...s, tabuleiro: { ...s.tabuleiro, peaoSelecionadoId: peaoId, recebidas: [] } };
}

const caixaDummy = [{ pecaId: 'reta-dummy', tipo: 'reta' as const, orientacao: 0 as const }];

// Monta partida minimalista onde ana está em (2,3) sobre cruz, bruno afetado em (3,3) sobre cruz, conectados
function estadoResgateBase(opts: { tipoAfetado: 'baixa' | 'amedrontado' | 'ambos' }): EstadoDaPartida {
  let s = iniciado();
  s = {
    ...s,
    jogadores: s.jogadores.map(j => ({ ...j, primeiroTurnoPendente: false, sanidade: j.jogadorId === 'bruno' ? 3 : 3, amedrontado: false, emBaixaIluminacao: false })),
    tabuleiro: {
      ...s.tabuleiro,
      posicionadas: [
        peca('peca-afetada', 'cruz', 0, 3, 3),
        peca('peca-aliada', 'cruz', 0, 2, 3),
        peca('inicial-2', 'inicial', 0, 0, 0),
        peca('inicial-3', 'inicial', 0, 6, 6),
        peca('inicial-4', 'inicial', 0, 6, 0),
      ],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId: 'peca-aliada' },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'peca-afetada' },
        { peaoId: 'peao-azul', cor: 'azul', pecaId: 'inicial-3' },
        { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: 'inicial-4' },
      ],
      peaoSelecionadoId: null,
      recebidas: [],
      caixa: [...caixaDummy] as any,
      iniciais: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
    },
    jogadorAtivoId: 'ana',
    pecaDoInicioDoTurnoId: 'peca-aliada',
    rodada: 2,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    pecasEmPeriodoDeGraca: [],
  };
  if (opts.tipoAfetado === 'baixa') {
    s = comJogador(s, 'bruno', { emBaixaIluminacao: true, amedrontado: false, sanidade: 3 });
  } else if (opts.tipoAfetado === 'amedrontado') {
    s = comJogador(s, 'bruno', { amedrontado: true, sanidade: 0, emBaixaIluminacao: false });
  } else if (opts.tipoAfetado === 'ambos') {
    s = comJogador(s, 'bruno', { amedrontado: true, sanidade: 0, emBaixaIluminacao: true });
  }
  return s;
}

test('resgate exige Conexão: sem Conexão a movimentação é recusada', () => {
  let s = iniciado();
  s = {
    ...s,
    jogadores: s.jogadores.map(j => ({ ...j, primeiroTurnoPendente: false })),
    tabuleiro: {
      ...s.tabuleiro,
      posicionadas: [
        peca('peca-aliada', 'reta', 0, 2, 3),
        peca('peca-afetada', 'reta', 90, 3, 3),
      ],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId: 'peca-aliada' },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'peca-afetada' },
        { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
        { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
      ],
      peaoSelecionadoId: 'peao-branco',
      recebidas: [],
      caixa: [...caixaDummy] as any,
      iniciais: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
    },
    jogadorAtivoId: 'ana',
    pecaDoInicioDoTurnoId: 'peca-aliada',
    posicaoConfirmada: false,
    pecasEmPeriodoDeGraca: [],
  };
  s = comJogador(s, 'bruno', { emBaixaIluminacao: true, sanidade: 3 });
  const res = aplicarComandoDePartida(s, moverPeao('peao-branco', 3, 3), 'ana');
  assert.equal(res.sucesso, false);
  if (!res.sucesso) assert.equal(res.erro.codigo, 'MOVIMENTO_NAO_CONECTADO');
});

test('único resgate remove todos os estados do afetado na peça', () => {
  let s = estadoResgateBase({ tipoAfetado: 'ambos' });
  s = comSelecionado(s, 'peao-branco');
  const r = aplicarComandoDePartida(s, moverPeao('peao-branco', 3, 3), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  const bruno = r.estado.jogadores.find(j => j.jogadorId === 'bruno')!;
  assert.equal(bruno.emBaixaIluminacao, false);
  assert.equal(bruno.amedrontado, false);
  assert.equal(bruno.sanidade, 1);
  const ev = r.eventos.find(e => e.tipo === 'resgate_realizado') as any;
  assert.ok(ev, 'deve emitir resgate_realizado');
  assert.equal(ev.pecaId, 'peca-afetada');
  assert.equal(ev.resgatadoJogadorId, 'bruno');
  assert.equal(ev.resgatadorPeaoId, 'peao-branco');
  assert.equal(r.estado.pecasEmPeriodoDeGraca.includes('peca-afetada'), true);
});

test('resgate do amedrontado restaura sanidade a 1; baixa mantém sanidade', () => {
  let s1 = estadoResgateBase({ tipoAfetado: 'amedrontado' });
  s1 = comSelecionado(s1, 'peao-branco');
  const r1 = aplicarComandoDePartida(s1, moverPeao('peao-branco', 3, 3), 'ana');
  assert.equal(r1.sucesso, true);
  if (!r1.sucesso) return;
  assert.equal(r1.estado.jogadores.find(j => j.jogadorId === 'bruno')!.sanidade, 1);
  assert.equal(r1.estado.jogadores.find(j => j.jogadorId === 'bruno')!.amedrontado, false);

  let s2 = estadoResgateBase({ tipoAfetado: 'baixa' });
  s2 = comJogador(s2, 'bruno', { sanidade: 2 });
  s2 = comSelecionado(s2, 'peao-branco');
  const r2 = aplicarComandoDePartida(s2, moverPeao('peao-branco', 3, 3), 'ana');
  assert.equal(r2.sucesso, true);
  if (!r2.sucesso) return;
  assert.equal(r2.estado.jogadores.find(j => j.jogadorId === 'bruno')!.sanidade, 2);
  assert.equal(r2.estado.jogadores.find(j => j.jogadorId === 'bruno')!.emBaixaIluminacao, false);
});

test('exceção de ocupação: peça comum 1→2 com afetado, e rejeita após cura', () => {
  let s = estadoResgateBase({ tipoAfetado: 'baixa' });
  s = comSelecionado(s, 'peao-branco');
  const r = aplicarComandoDePartida(s, moverPeao('peao-branco', 3, 3), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  assert.equal(r.estado.tabuleiro.peoes.filter(p => p.pecaId === 'peca-afetada').length, 2);
  let s2 = forcarAtiva(r.estado, 'carla');
  s2 = {
    ...s2,
    tabuleiro: {
      ...s2.tabuleiro,
      posicionadas: [...s2.tabuleiro.posicionadas, peca('peca-carla', 'cruz', 0, 3, 4)],
      peoes: s2.tabuleiro.peoes.map(p => p.peaoId === 'peao-azul' ? { ...p, pecaId: 'peca-carla' } : p),
      caixa: [...caixaDummy] as any,
    },
  };
  s2 = comSelecionado(s2, 'peao-azul');
  const r2 = aplicarComandoDePartida(s2, moverPeao('peao-azul', 3, 3), 'carla');
  assert.equal(r2.sucesso, false);
  if (!r2.sucesso) assert.equal(r2.erro.codigo, 'PECA_JA_TEM_PEAO');

  let s3 = estadoResgateBase({ tipoAfetado: 'baixa' });
  s3 = {
    ...s3,
    tabuleiro: {
      ...s3.tabuleiro,
      posicionadas: [...s3.tabuleiro.posicionadas, peca('peca-carla', 'cruz', 0, 3, 4)],
      peoes: s3.tabuleiro.peoes.map(p => p.peaoId === 'peao-azul' ? { ...p, pecaId: 'peca-carla' } : p),
      caixa: [...caixaDummy] as any,
    },
  };
  s3 = forcarAtiva(s3, 'carla');
  s3 = comSelecionado(s3, 'peao-azul');
  const r3 = aplicarComandoDePartida(s3, moverPeao('peao-azul', 3, 3), 'carla');
  assert.equal(r3.sucesso, true);
});

test('exceção ocupação portão permite 4º peão com afetado', () => {
  let s = iniciado();
  s = {
    ...s,
    jogadores: s.jogadores.map(j => ({ ...j, primeiroTurnoPendente: false, sanidade: 3, amedrontado: false, emBaixaIluminacao: j.jogadorId === 'diogo' })),
    tabuleiro: {
      ...s.tabuleiro,
      posicionadas: [
        peca('portao', 'portao_de_saida', 0, 3, 3),
        peca('peca-aliada', 'cruz', 0, 2, 3),
        peca('peca-extra', 'cruz', 0, 3, 4),
      ],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId: 'peca-aliada' },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'portao' },
        { peaoId: 'peao-azul', cor: 'azul', pecaId: 'portao' },
        { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: 'portao' },
      ],
      peaoSelecionadoId: null,
      recebidas: [],
      caixa: [...caixaDummy] as any,
      iniciais: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
    },
    jogadorAtivoId: 'ana',
    pecaDoInicioDoTurnoId: 'peca-aliada',
    posicaoConfirmada: false,
    pecasEmPeriodoDeGraca: [],
  };
  s = comJogador(s, 'diogo', { emBaixaIluminacao: true });
  s = comSelecionado(s, 'peao-branco');
  const r = aplicarComandoDePartida(s, moverPeao('peao-branco', 3, 3), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  assert.equal(r.estado.tabuleiro.peoes.filter(p => p.pecaId === 'portao').length, 4);
  // após resgate diogo curado, diogo não mais afetado, mas graça ativa
  assert.equal(r.estado.pecasEmPeriodoDeGraca.includes('portao'), true);
});

test('período de graça bloqueia Permanência até saída de um peão, sem remoção forçada', () => {
  let s = estadoResgateBase({ tipoAfetado: 'baixa' });
  s = comSelecionado(s, 'peao-branco');
  const r = aplicarComandoDePartida(s, moverPeao('peao-branco', 3, 3), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  let s2 = forcarAtiva(r.estado, 'ana');
  s2 = comSelecionado(s2, 'peao-branco');
  const permBloq = aplicarComandoDePartida(s2, permanecer('peao-branco'), 'ana');
  assert.equal(permBloq.sucesso, false);
  if (!permBloq.sucesso) assert.equal(permBloq.erro.codigo, 'ENCERRAMENTO_INVALIDO');

  let s3 = forcarAtiva(r.estado, 'bruno');
  s3 = comSelecionado(s3, 'peao-vermelho');
  const permBloq2 = aplicarComandoDePartida(s3, permanecer('peao-vermelho'), 'bruno');
  assert.equal(permBloq2.sucesso, false);

  let s4 = forcarAtiva(r.estado, 'ana');
  s4 = comPeca(s4, 'peca-saida', 'cruz', 0, 4, 3);
  s4 = { ...s4, tabuleiro: { ...s4.tabuleiro, caixa: [...caixaDummy] as any } };
  s4 = comSelecionado(s4, 'peao-branco');
  const movFora = aplicarComandoDePartida(s4, moverPeao('peao-branco', 4, 3), 'ana');
  assert.equal(movFora.sucesso, true);
  if (!movFora.sucesso) return;
  assert.equal(movFora.estado.pecasEmPeriodoDeGraca.includes('peca-afetada'), false);
  let s5 = forcarAtiva(movFora.estado, 'bruno');
  s5 = { ...s5, pecaDoInicioDoTurnoId: 'peca-afetada' };
  s5 = comSelecionado(s5, 'peao-vermelho');
  const permOk = aplicarComandoDePartida(s5, permanecer('peao-vermelho'), 'bruno');
  assert.equal(permOk.sucesso, true);
  assert.equal(movFora.estado.tabuleiro.peoes.filter(p => p.pecaId === 'peca-afetada').length, 1);
});

test('resgate não ocorre em posicionarPeao do Primeiro Turno', () => {
  let s = iniciado();
  s = {
    ...s,
    tabuleiro: {
      ...s.tabuleiro,
      posicionadas: [peca('peca-afetada', 'cruz', 0, 3, 3)],
      peoes: s.tabuleiro.peoes.map(p => p.peaoId === 'peao-vermelho' ? { ...p, pecaId: 'peca-afetada' } : p),
      caixa: [...caixaDummy] as any,
    },
  };
  s = comJogador(s, 'bruno', { emBaixaIluminacao: true });
  s = aplicar(s, { tipo: 'selecionar_peca', pecaId: 'inicial-1' }, 'ana');
  s = aplicar(s, { tipo: 'posicionar_peca', pecaId: 'inicial-1', celula: { linha: 0, coluna: 0 } }, 'ana');
  const sPos = { ...s, tabuleiro: { ...s.tabuleiro, peaoSelecionadoId: 'peao-branco' } };
  const res = aplicarComandoDePartida(sPos, { tipo: 'posicionar_peao', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } }, 'ana');
  if (res.sucesso) {
    assert.equal(res.estado.jogadores.find(j => j.jogadorId === 'bruno')!.emBaixaIluminacao, true);
  } else {
    assert.ok(['PECA_JA_TEM_PEAO', 'PECA_INICIAL_EXIGIDA'].includes(res.erro.codigo));
    assert.equal(s.jogadores.find(j => j.jogadorId === 'bruno')!.emBaixaIluminacao, true);
  }
});

test('múltiplos afetados na mesma peça são resgatados juntos (portão)', () => {
  let s = iniciado();
  s = {
    ...s,
    jogadores: s.jogadores.map(j => {
      if (j.jogadorId === 'bruno' || j.jogadorId === 'carla') return { ...j, primeiroTurnoPendente: false, emBaixaIluminacao: true, sanidade: 3 };
      return { ...j, primeiroTurnoPendente: false };
    }),
    tabuleiro: {
      ...s.tabuleiro,
      posicionadas: [
        peca('portao', 'portao_de_saida', 0, 3, 3),
        peca('peca-aliada', 'cruz', 0, 2, 3),
        peca('inicial-4', 'inicial', 0, 6, 0),
      ],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId: 'peca-aliada' },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'portao' },
        { peaoId: 'peao-azul', cor: 'azul', pecaId: 'portao' },
        { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: 'inicial-4' },
      ],
      peaoSelecionadoId: null,
      recebidas: [],
      caixa: [...caixaDummy] as any,
      iniciais: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
    },
    jogadorAtivoId: 'ana',
    pecaDoInicioDoTurnoId: 'peca-aliada',
    posicaoConfirmada: false,
    pecasEmPeriodoDeGraca: [],
  };
  s = comSelecionado(s, 'peao-branco');
  const r = aplicarComandoDePartida(s, moverPeao('peao-branco', 3, 3), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  assert.equal(r.estado.jogadores.find(j => j.jogadorId === 'bruno')!.emBaixaIluminacao, false);
  assert.equal(r.estado.jogadores.find(j => j.jogadorId === 'carla')!.emBaixaIluminacao, false);
  assert.equal(r.eventos.filter(e => e.tipo === 'resgate_realizado').length, 2);
});
