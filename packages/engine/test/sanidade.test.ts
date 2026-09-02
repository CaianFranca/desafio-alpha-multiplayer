import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aplicarComandoDePartida,
  avaliarTerminoDaPartida,
  calcularIluminacao,
  estadoInicialDaPartida,
  type BordaCardinal,
  type ComandoDePartida,
  type EstadoDaPartida,
  type Orientacao,
  type TipoDaPeca,
  type PecaPosicionada,
} from '../src/index.ts';

const JOGADORES = ['ana', 'bruno', 'carla', 'diogo'];

const selecionar = (pecaId: string) => ({ tipo: 'selecionar_peca', pecaId } as const);
const posicionar = (pecaId: string, l: number, c: number) => ({ tipo: 'posicionar_peca', pecaId, celula: { linha: l, coluna: c } } as const);
const selecionarPeao = (peaoId: string) => ({ tipo: 'selecionar_peao', peaoId } as const);
const posicionarPeao = (peaoId: string, l: number, c: number) => ({ tipo: 'posicionar_peao', peaoId, celula: { linha: l, coluna: c } } as const);
const moverPeao = (peaoId: string, l: number, c: number) => ({ tipo: 'mover_peao', peaoId, celula: { linha: l, coluna: c } } as const);
const confirmar = (peaoId: string) => ({ tipo: 'confirmar_posicao_do_peao', peaoId } as const);
const encerrar = () => ({ tipo: 'encerrar_turno' } as const);
const permanecer = (peaoId: string) => ({ tipo: 'permanecer', peaoId } as const);

function aplicar(estado: EstadoDaPartida, cmd: ComandoDePartida, ator: string): EstadoDaPartida {
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
function comPeaoSobre(s: EstadoDaPartida, peaoId: string, pecaId: string): EstadoDaPartida {
  return { ...s, tabuleiro: { ...s.tabuleiro, peoes: s.tabuleiro.peoes.map(p => p.peaoId === peaoId ? { ...p, pecaId } : p) } };
}
function comJogador(s: EstadoDaPartida, jogadorId: string, patch: Partial<{ sanidade: number; amedrontado: boolean; emBaixaIluminacao: boolean; protegido: boolean }>): EstadoDaPartida {
  return { ...s, jogadores: s.jogadores.map(j => j.jogadorId === jogadorId ? { ...j, ...patch } as any : j) };
}
function resolverRecebidas(s: EstadoDaPartida, ator: string): EstadoDaPartida {
  while (s.tabuleiro.recebidas.length > 0) {
    const pend = s.tabuleiro.recebidas[0];
    let nxt: EstadoDaPartida | undefined;
    for (const b of ['norte', 'leste', 'sul', 'oeste'] as const) {
      const r = aplicarComandoDePartida(s, { tipo: 'escolher_vaga_da_peca_recebida', recebidaId: pend.recebidaId, borda: b }, ator);
      if (r.sucesso) { nxt = r.estado; break; }
    }
    if (!nxt) throw new Error(`sem vaga ${pend.recebidaId}`);
    s = nxt;
    const esc = s.tabuleiro.recebidas.find(x => x.recebidaId === pend.recebidaId)!;
    s = aplicar(s, posicionar(esc.pecaId, esc.celulaAlvo!.linha, esc.celulaAlvo!.coluna), ator);
  }
  return s;
}
function concluirPrimeiro(s: EstadoDaPartida, cel: { linha: number; coluna: number }): EstadoDaPartida {
  const ator = s.jogadorAtivoId;
  const jog = s.jogadores.find(j => j.jogadorId === ator)!;
  const pid = `inicial-${jog.ordem}`;
  s = aplicar(s, selecionar(pid), ator);
  s = aplicar(s, posicionar(pid, cel.linha, cel.coluna), ator);
  s = aplicar(s, selecionarPeao(jog.peaoId), ator);
  s = aplicar(s, posicionarPeao(jog.peaoId, cel.linha, cel.coluna), ator);
  s = resolverRecebidas(s, ator);
  return aplicar(s, encerrar(), ator);
}
function rodada2(): EstadoDaPartida {
  let s = iniciado();
  s = concluirPrimeiro(s, { linha: 3, coluna: 3 });
  s = concluirPrimeiro(s, { linha: 0, coluna: 0 });
  s = concluirPrimeiro(s, { linha: 6, coluna: 6 });
  s = concluirPrimeiro(s, { linha: 6, coluna: 0 });
  return s;
}
// Força ana a ser ativa, evitando ciclo pelos outros (injeção direta permitida nos testes de domínio)
function forcarAnaAtiva(s: EstadoDaPartida): EstadoDaPartida {
  const peaoAna = s.tabuleiro.peoes.find(p => p.peaoId === 'peao-branco')!;
  return { ...s, jogadorAtivoId: 'ana', pecaDoInicioDoTurnoId: peaoAna.pecaId, posicaoConfirmada: false };
}

function peoesEmBaixa(jogadores: readonly { peaoId: string; emBaixaIluminacao?: boolean }[]): readonly string[] {
  return jogadores.filter(j => (j.emBaixaIluminacao ?? false)).map(j => j.peaoId);
}

test('cada jogador inicia com 3 de sanidade; piso zero e imune quando amedrontado', () => {
  const e = iniciado();
  for (const j of e.jogadores) {
    assert.equal(j.sanidade, 3);
    assert.equal(j.emBaixaIluminacao, false);
    assert.equal(j.amedrontado, false);
  }
  // Dreno controlado: ana com sanidade 1 dentro do alcance do espectro
  let s = rodada2();
  s = comPeca(s, 'espectro-x', 'espectro', 0, 1, 3);
  s = comJogador(s, 'ana', { sanidade: 1, amedrontado: false });
  s = forcarAnaAtiva(s);
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  s = aplicar(s, moverPeao('peao-branco', 2, 3), 'ana');
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  let r = aplicarComandoDePartida(s, confirmar('peao-branco'), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  assert.equal(r.estado.jogadores.find(j => j.jogadorId === 'ana')!.sanidade, 0);
  assert.equal(r.estado.jogadores.find(j => j.jogadorId === 'ana')!.amedrontado, true);
  // Novo ataque contra amedrontado não reduz abaixo de zero
  let s2 = r.estado;
  s2 = resolverRecebidas(s2, 'ana');
  // Força ana ativa novamente para re-atacar sem passar por auto-pulo
  s2 = forcarAnaAtiva(s2);
  // Tira ana do alcance e volta: 2,3 -> 3,3 -> 2,3
  s2 = aplicar(s2, selecionarPeao('peao-branco'), 'ana');
  s2 = aplicar(s2, moverPeao('peao-branco', 3, 3), 'ana');
  s2 = aplicar(s2, selecionarPeao('peao-branco'), 'ana');
  let rr = aplicarComandoDePartida(s2, confirmar('peao-branco'), 'ana');
  assert.equal(rr.sucesso, true);
  if (!rr.sucesso) return;
  // Saída não drena
  assert.equal(rr.estado.jogadores.find(j => j.jogadorId === 'ana')!.sanidade, 0);
  s2 = resolverRecebidas(rr.estado, 'ana');
  s2 = forcarAnaAtiva(s2);
  s2 = aplicar(s2, selecionarPeao('peao-branco'), 'ana');
  s2 = aplicar(s2, moverPeao('peao-branco', 2, 3), 'ana');
  s2 = aplicar(s2, selecionarPeao('peao-branco'), 'ana');
  rr = aplicarComandoDePartida(s2, confirmar('peao-branco'), 'ana');
  assert.equal(rr.sucesso, true);
  if (!rr.sucesso) return;
  assert.equal(rr.estado.jogadores.find(j => j.jogadorId === 'ana')!.sanidade, 0);
  assert.equal(rr.estado.jogadores.find(j => j.jogadorId === 'ana')!.amedrontado, true);
});

test('vulto impõe Baixa Iluminação: iluminação própria célula e limpeza reflete sem duplicata', () => {
  let s = rodada2();
  // peca-isca em 0,3 iluminada só por ana antes do confirmar: ana sobre vulto-x em 1,3 ilumina 0,3 ao norte
  s = comPeca(s, 'peca-isca', 'reta', 0, 0, 3);
  s = comPeca(s, 'vulto-x', 'vulto', 0, 1, 3);
  s = comPeaoSobre(s, 'peao-branco', 'vulto-x');
  s = forcarAnaAtiva(s);
  // verifica iluminada só por ana antes do confirmar
  const ilumAntes = calcularIluminacao(s.tabuleiro, peoesEmBaixa(s.jogadores));
  assert.ok(ilumAntes.some(c => c.linha === 0 && c.coluna === 3), 'peca-isca deve estar iluminada antes');
  const tabSemAna = { ...s.tabuleiro, peoes: s.tabuleiro.peoes.filter(p => p.peaoId !== 'peao-branco') } as any;
  const ilumOutros = calcularIluminacao(tabSemAna, peoesEmBaixa(s.jogadores));
  assert.equal(ilumOutros.some(c => c.linha === 0 && c.coluna === 3), false, 'peca-isca iluminada só por ana antes');
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  s = aplicar(s, moverPeao('peao-branco', 2, 3), 'ana');
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  const r = aplicarComandoDePartida(s, confirmar('peao-branco'), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  const ana = r.estado.jogadores.find(j => j.jogadorId === 'ana')!;
  assert.equal(ana.emBaixaIluminacao, true);
  const ilum = r.estado.celulasIluminadas;
  assert.ok(ilum.some(c => c.linha === 2 && c.coluna === 3));
  assert.equal(ilum.some(c => c.linha === 1 && c.coluna === 3), false);
  // segunda limpeza (reaplicarIluminacaoSeBaixaNova) deve ter removido peca-isca, que ficou fora da nova iluminação restrita
  const limpezaEventos = r.eventos.filter(e => e.tipo === 'limpeza_aplicada') as any[];
  const contemIsca = limpezaEventos.some(e => (e.pecasRemovidas as readonly string[]).includes('peca-isca'));
  assert.ok(contemIsca, 'limpeza_aplicada deve conter peca-isca');
  assert.equal(r.estado.tabuleiro.posicionadas.some(p => p.pecaId === 'peca-isca'), false, 'peca-isca removida');
  const celEvents = r.eventos.filter(e => e.tipo === 'celulas_iluminadas');
  assert.equal(celEvents.length, 1);
});

test('em Baixa Recebimento é 1; sem vaga ou caixa esgotada 0', () => {
  // Sem vaga
  let s = iniciado();
  s = aplicar(s, selecionar('inicial-1'), 'ana');
  s = aplicar(s, posicionar('inicial-1', 3, 3), 'ana');
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  s = comJogador(s, 'ana', { emBaixaIluminacao: true });
  s = comPeca(s, 'bloq-n', 'reta', 0, 2, 3);
  s = comPeca(s, 'bloq-l', 'reta', 90, 3, 4);
  const r0 = aplicarComandoDePartida(s, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(r0.sucesso, true);
  if (!r0.sucesso) return;
  assert.equal(r0.estado.tabuleiro.recebidas.length, 0);

  // Uma vaga -> 1
  let s2 = iniciado();
  s2 = aplicar(s2, selecionar('inicial-1'), 'ana');
  s2 = aplicar(s2, posicionar('inicial-1', 3, 3), 'ana');
  s2 = aplicar(s2, selecionarPeao('peao-branco'), 'ana');
  s2 = comJogador(s2, 'ana', { emBaixaIluminacao: true });
  const r1 = aplicarComandoDePartida(s2, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(r1.sucesso, true);
  if (!r1.sucesso) return;
  assert.equal(r1.estado.tabuleiro.recebidas.length, 1);

  // Caixa esgotada com objetivos presentes para não terminar a partida
  let s3 = iniciado();
  s3 = {
    ...s3,
    tabuleiro: {
      ...s3.tabuleiro,
      caixa: [],
      posicionadas: [
        peca('gerador-1', 'gerador', 0, 2, 3),
        peca('gerador-2', 'gerador', 0, 3, 2),
        peca('gerador-3', 'gerador', 0, 4, 3),
        peca('sala-1', 'sala_do_diretor', 0, 3, 4),
        peca('portao-1', 'portao_de_saida', 0, 0, 1),
        peca('inicial-2', 'inicial', 0, 0, 0),
      ],
      peoes: s3.tabuleiro.peoes.map(p => p.cor === 'vermelho' ? { ...p, pecaId: 'inicial-2' } : p),
    },
  };
  s3 = aplicar(s3, selecionar('inicial-1'), 'ana');
  s3 = aplicar(s3, posicionar('inicial-1', 3, 3), 'ana');
  s3 = aplicar(s3, selecionarPeao('peao-branco'), 'ana');
  s3 = comJogador(s3, 'ana', { emBaixaIluminacao: true });
  const r2 = aplicarComandoDePartida(s3, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(r2.sucesso, true);
  if (!r2.sucesso) return;
  assert.equal(r2.estado.tabuleiro.recebidas.length, 0);
});

test('em Baixa Movimentação e Permanência permanecem normais', () => {
  let s = rodada2();
  // Garante destino iluminado por outro peão: peça em 3,4 mantida por peão-azul (prepara antes do ataque, sem recriar)
  s = comPeca(s, 'dest-34', 'reta', 90, 3, 4);
  s = comPeaoSobre(s, 'peao-azul', 'dest-34');
  s = comPeca(s, 'vulto-x', 'vulto', 0, 1, 3);
  s = forcarAnaAtiva(s);
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  s = aplicar(s, moverPeao('peao-branco', 2, 3), 'ana');
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  let r = aplicarComandoDePartida(s, confirmar('peao-branco'), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  s = resolverRecebidas(r.estado, 'ana');
  s = aplicar(s, encerrar(), 'ana');
  s = forcarAnaAtiva(s);
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  const mv = aplicarComandoDePartida(s, moverPeao('peao-branco', 3, 3), 'ana');
  assert.equal(mv.sucesso, true);

  // Permanecer direto quando na peça do início
  let s2 = rodada2();
  s2 = { ...s2, jogadores: s2.jogadores.map(j => j.jogadorId === 'ana' ? { ...j, emBaixaIluminacao: true } : j) };
  s2 = forcarAnaAtiva(s2);
  s2 = aplicar(s2, selecionarPeao('peao-branco'), 'ana');
  const perm = aplicarComandoDePartida(s2, permanecer('peao-branco'), 'ana');
  assert.equal(perm.sucesso, true);
});

test('espectro drena, amedrontado auto-pula mantendo iluminação', () => {
  let s = rodada2();
  s = comPeca(s, 'espectro-x', 'espectro', 0, 1, 3);
  s = comJogador(s, 'ana', { sanidade: 1, amedrontado: false });
  s = forcarAnaAtiva(s);
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  s = aplicar(s, moverPeao('peao-branco', 2, 3), 'ana');
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  const r = aplicarComandoDePartida(s, confirmar('peao-branco'), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  const ana = r.estado.jogadores.find(j => j.jogadorId === 'ana')!;
  assert.equal(ana.sanidade, 0);
  assert.equal(ana.amedrontado, true);
  assert.equal(ana.emBaixaIluminacao, false);
  const baixa = peoesEmBaixa(r.estado.jogadores);
  assert.equal(baixa.length, 0);
  const ilum = calcularIluminacao(r.estado.tabuleiro, baixa);
  assert.ok(ilum.some(c => c.linha === 1 && c.coluna === 3));
  let s2 = resolverRecebidas(r.estado, 'ana');
  const enc = aplicarComandoDePartida(s2, encerrar(), 'ana');
  assert.equal(enc.sucesso, true);
  if (!enc.sucesso) return;
  assert.notEqual(enc.estado.jogadorAtivoId, 'ana');
  assert.equal(enc.estado.jogadorAtivoId, 'bruno');
});

test('amedrontado pula 2 seguidos: ana e bruno amedrontados -> carla com 1 turno_iniciado', () => {
  let s = rodada2();
  // ana e bruno amedrontados (sanidade 0)
  s = comJogador(s, 'ana', { sanidade: 0, amedrontado: true });
  s = comJogador(s, 'bruno', { sanidade: 0, amedrontado: true });
  // força carla a ser o próximo não-amedrontado após ana encerrar
  // prepara ana como ativa com posição já confirmada e sem pendências para permitir encerrar
  const peaoAna = s.tabuleiro.peoes.find(p => p.peaoId === 'peao-branco')!;
  s = { ...s, jogadorAtivoId: 'ana', pecaDoInicioDoTurnoId: peaoAna.pecaId, posicaoConfirmada: true, tabuleiro: { ...s.tabuleiro, recebidas: [] } };
  const r = aplicarComandoDePartida(s, encerrar(), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  assert.equal(r.estado.jogadorAtivoId, 'carla');
  const iniciados = r.eventos.filter(e => e.tipo === 'turno_iniciado');
  assert.equal(iniciados.length, 1);
  assert.equal((iniciados[0] as any).jogadorId, 'carla');
  // garante que pulados não emitiram turno_iniciado
  assert.equal(iniciados.some(e => (e as any).jogadorId === 'ana'), false);
  assert.equal(iniciados.some(e => (e as any).jogadorId === 'bruno'), false);
});

test('todos amedrontados -> avaliarTerminoDaPartida equipe_amedrontada sem turno_iniciado', () => {
  let s = rodada2();
  for (const j of JOGADORES) s = comJogador(s, j, { sanidade: 0, amedrontado: true });
  // estado com todos amedrontados deve ser derrota equipe_amedrontada
  const aval = avaliarTerminoDaPartida(s);
  assert.notEqual(aval.evento, null);
  assert.equal(aval.evento!.desfecho.tipo, 'derrota');
  assert.equal((aval.evento!.desfecho as any).motivo, 'equipe_amedrontada');
  // avancarVez com todos amedrontados não deve emitir turno_iniciado
  const peaoAna = s.tabuleiro.peoes.find(p => p.peaoId === 'peao-branco')!;
  const sEnc: EstadoDaPartida = { ...s, jogadorAtivoId: 'ana', pecaDoInicioDoTurnoId: peaoAna.pecaId, posicaoConfirmada: true, tabuleiro: { ...s.tabuleiro, recebidas: [] } };
  const r = aplicarComandoDePartida(sEnc, encerrar(), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  const iniciados = r.eventos.filter(e => e.tipo === 'turno_iniciado');
  assert.equal(iniciados.length, 0, 'nenhum turno_iniciado quando todos amedrontados');
  // funil deve transformar em partida_terminada equipe_amedrontada
  const term = r.eventos.filter(e => e.tipo === 'partida_terminada');
  assert.equal(term.length, 1);
  assert.equal((term[0] as any).desfecho.motivo, 'equipe_amedrontada');
});

test('ataque simultâneo de vulto+espectro com proteção consome uma vez', () => {
  let s = rodada2();
  // Posiciona vulto e espectro de modo que ambos atinjam ana em 2,3
  s = comPeca(s, 'vulto-x', 'vulto', 0, 1, 3);
  s = comPeca(s, 'espectro-y', 'espectro', 0, 3, 3);
  s = comJogador(s, 'ana', { protegido: true });
  s = forcarAnaAtiva(s);
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  s = aplicar(s, moverPeao('peao-branco', 2, 3), 'ana');
  s = aplicar(s, selecionarPeao('peao-branco'), 'ana');
  const r = aplicarComandoDePartida(s, confirmar('peao-branco'), 'ana');
  assert.equal(r.sucesso, true);
  if (!r.sucesso) return;
  // Protegida deve negar ambos, não entrar em baixa nem perder sanidade
  const ana = r.estado.jogadores.find(j => j.jogadorId === 'ana')!;
  assert.equal(ana.emBaixaIluminacao, false);
  assert.equal(ana.sanidade, 3);
  assert.equal(ana.protegido, false); // consumida
});
