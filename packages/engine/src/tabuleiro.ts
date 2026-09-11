// Domínio puro do Tabuleiro (ST-09 / issue #82, ST-10 / issue #89 e ST-12 /
// issue #144).
//
// Seam único das regras de tabuleiro: grade fixa 7x7 (ADR-0004), Caixa
// (ST-12) com as N Peças Iniciais fora dela, Seleção única e janela de
// Manipulação (ST-09), e os tipos do ciclo de Peões com o dispatch
// aplicarComandoDeTabuleiro (ST-10) — que produz eventos de domínio e
// rejeições com códigos fechados, no mesmo padrão do domínio do lobby
// (lobby.ts). Os handlers de Peões, conexões, Recebimento e ciclo, e a
// camada base compartilhada (resultado, validação, grade, rotação, bordas),
// vivem em peoes.ts — a dependência em runtime é única: tabuleiro.ts →
// peoes.ts. Nenhum contrato wire, Redis ou Express vive aqui: este módulo é
// domínio puro e imutável.

import {
  BORDA_OPOSTA,
  LADO_DA_GRADE,
  conectaNaVaga,
  ehPecaDeMonstro,
  ehPecaEspecial,
  exigirCelulaNoAlcance,
  escolherVagaDaPecaRecebida,
  desselecionarPeao,
  encontrarPosicionada,
  encontrarPosicionadaPorCelula,
  encontrarRecebidaPorPeca,
  girarRecebida,
  moverPeao,
  normalizarCelula,
  permanecer,
  posicionarPeao,
  posicionarRecebida,
  rejeitar,
  rotacionar,
  selecionarPeao,
  sucesso,
  validarTexto,
} from './peoes.ts';

export {
  BORDA_OPOSTA,
  LADO_DA_GRADE,
  bordasAbertas,
  celulaVizinhaNaBorda,
  conectaNaVaga,
  ehPecaDeMonstro,
  ehPecaEspecial,
  estaDentroDaGrade,
  gerarRecebidas,
  normalizarCelula,
  normalizarCoordenada,
  tetoDoPortao,
  validarTexto,
  vagasDisponiveis,
  vizinhasConectadas,
} from './peoes.ts';

export type TipoDePecaDeCaminho = 'reta' | 'T' | 'cruz';

// Peças especiais da Caixa (ST-12): entram apenas por sorteio; conquistas e
// efeitos no Tabuleiro pertencem a issues futuras (#142).
export type TipoDePecaEspecial =
  | 'gerador'
  | 'sala_do_diretor'
  | 'sala_medica'
  | 'portao_de_saida';

// Peças de Monstro (ST-15 / issue #169): entram na Caixa como peça comum,
// sorteadas e posicionadas pelo fluxo do Recebimento, com bordas abertas e
// sem janela de Manipulação. Não aceitam Peão e são removidas pela limpeza
// sem retorno à Caixa.
export type TipoDePecaDeMonstro = 'vulto' | 'espectro';

// Tipos que compõem a Caixa: caminho + especiais + monstros. A Peça Inicial
// nunca entra na Caixa.
export type TipoDePecaDaCaixa =
  | TipoDePecaDeCaminho
  | TipoDePecaEspecial
  | TipoDePecaDeMonstro;

// Todos os tipos de Peça do Tabuleiro: a Inicial (fora da Caixa) mais os
// tipos da Caixa (incluindo monstros).
export type TipoDaPeca =
  | 'inicial'
  | TipoDePecaDeCaminho
  | TipoDePecaEspecial
  | TipoDePecaDeMonstro;
export type Orientacao = 0 | 90 | 180 | 270;
export type SentidoDeRotacao = 'horario' | 'anti_horario';
export type BordaCardinal = 'norte' | 'leste' | 'sul' | 'oeste';

export interface Celula {
  readonly linha: number;
  readonly coluna: number;
}

export interface PecaDaCaixa {
  readonly pecaId: string;
  readonly tipo: TipoDePecaDaCaixa;
  readonly orientacao: Orientacao;
}

// As Peças Iniciais de partida, fora da Caixa; cada Jogador encaixa a
// própria diretamente no Primeiro Turno (ST-11). São N (2–4, issue #285).
export interface PecaInicial {
  readonly pecaId: string;
  readonly tipo: 'inicial';
  readonly orientacao: Orientacao;
}

export interface PecaPosicionada {
  readonly pecaId: string;
  readonly tipo: TipoDaPeca;
  readonly orientacao: Orientacao;
  readonly celula: Celula;
}

export type CorDoPeao = 'branco' | 'vermelho' | 'azul' | 'amarelo';

// O Peão é um elemento simples: cor e posição — sobre a Mesa (pecaId null) ou
// sobre exatamente uma Peça posicionada (uma Peça aceita no máximo um Peão).
export interface Peao {
  readonly peaoId: string;
  readonly cor: CorDoPeao;
  readonly pecaId: string | null;
}

// Slot do Recebimento (ST-12 / issue #138): cada slot carrega a Peça já
// sorteada da Caixa (pecaId, tipo e orientação de composição) e a vaga só é
// fixada depois, pelo comando escolher_vaga_da_peca_recebida — a borda da Peça
// geradora com célula vizinha vazia escolhida pelo Jogador vira a célula-alvo.
export interface PecaRecebida {
  readonly recebidaId: string;
  // A Peça sorteada já pertence ao slot desde o Recebimento (não há escolha
  // de tipo no domínio desde a #138).
  readonly pecaId: string;
  readonly tipo: TipoDePecaDaCaixa;
  // Orientação de composição da Caixa (0°); o giro deliberado fica em
  // girar_peca, pelo mesmo padrão das Iniciais.
  readonly orientacao: Orientacao;
  // Vaga escolhida: borda aberta da Peça sob o Peão com célula vizinha vazia;
  // null até a escolha.
  readonly vaga: BordaCardinal | null;
  // Célula derivada da vaga; null até a escolha.
  readonly celulaAlvo: Celula | null;
}

// `pecaSelecionadaId` aponta para uma Peça Inicial fora da Caixa (Seleção
// única) ou, no ciclo do Peão, para a Peça atribuída à Recebida escolhida
// mais recentemente. `pecaEmManipulacaoId` aponta para a última peça
// posicionada enquanto sua janela de Manipulação está aberta; Finalização
// (nova seleção, novo posicionamento ou clique na própria peça posicionada)
// fecha a janela.
export interface EstadoDoTabuleiro {
  // Caixa da partida (ST-12): composição fixa de 83 peças de caminho,
  // especiais e monstros (ST-15 / issue #169), embaralhada uma única vez na
  // criação do estado; consumo da primeira peça, sem reposição, pelo sorteio
  // unitário (sortearDaCaixa) e pelo Recebimento (gerarRecebidas, issue #138).
  readonly caixa: readonly PecaDaCaixa[];
  // As N Peças Iniciais (2–4, issue #285), fora da Caixa, encaixadas diretamente.
  readonly iniciais: readonly PecaInicial[];
  readonly posicionadas: readonly PecaPosicionada[];
  readonly pecaSelecionadaId: string | null;
  readonly pecaEmManipulacaoId: string | null;
  // ST-10: Peões, o Peão em sequência e as pendências do Recebimento.
  readonly peoes: readonly Peao[];
  readonly peaoSelecionadoId: string | null;
  readonly recebidas: readonly PecaRecebida[];
}

export interface SelecionarPecaComando {
  readonly tipo: 'selecionar_peca';
  readonly pecaId: string;
}

export interface GirarPecaComando {
  readonly tipo: 'girar_peca';
  readonly pecaId: string;
  readonly sentido: SentidoDeRotacao;
}

export interface PosicionarPecaComando {
  readonly tipo: 'posicionar_peca';
  readonly pecaId: string;
  readonly celula: Celula;
}

export interface FinalizarManipulacaoComando {
  readonly tipo: 'finalizar_manipulacao';
}

export interface SelecionarPeaoComando {
  readonly tipo: 'selecionar_peao';
  readonly peaoId: string;
}

// Desseleção autoritativa (issue #249): limpa a seleção vigente do ciclo.
// Idempotente COM confirmação (já desselecionado ou outro peão em sequência
// mantém o estado e sempre emite peao_desselecionado quando o comando é
// válido, para que o autor receba o ack); rejeitada sob Recebidas pendentes
// para nunca órfanar pendência.
export interface DesselecionarPeaoComando {
  readonly tipo: 'desselecionar_peao';
  readonly peaoId: string;
}

export interface PosicionarPeaoComando {
  readonly tipo: 'posicionar_peao';
  readonly peaoId: string;
  readonly celula: Celula;
}

// Recebimento (issue #138): escolhe a vaga (borda aberta da Peça sob o Peão
// com célula vizinha vazia) de uma pendência do Recebimento — uma escolha POR
// peça sorteada.
export interface EscolherVagaDaPecaRecebidaComando {
  readonly tipo: 'escolher_vaga_da_peca_recebida';
  readonly recebidaId: string;
  readonly borda: BordaCardinal;
}

export interface MoverPeaoComando {
  readonly tipo: 'mover_peao';
  readonly peaoId: string;
  readonly celula: Celula;
}

export interface PermanecerComando {
  readonly tipo: 'permanecer';
  readonly peaoId: string;
}

export type ComandoDeTabuleiro =
  | SelecionarPecaComando
  | GirarPecaComando
  | PosicionarPecaComando
  | FinalizarManipulacaoComando
  | SelecionarPeaoComando
  | DesselecionarPeaoComando
  | PosicionarPeaoComando
  | EscolherVagaDaPecaRecebidaComando
  | MoverPeaoComando
  | PermanecerComando;

export interface PecaSelecionadaEvento {
  readonly tipo: 'peca_selecionada';
  readonly pecaId: string;
}

export interface PecaDeselecionadaEvento {
  readonly tipo: 'peca_deselecionada';
  readonly pecaId: string;
}

export interface PecaGiradaEvento {
  readonly tipo: 'peca_girada';
  readonly pecaId: string;
  readonly orientacaoAnterior: Orientacao;
  readonly orientacao: Orientacao;
  readonly sentido: SentidoDeRotacao;
}

export interface PecaPosicionadaEvento {
  readonly tipo: 'peca_posicionada';
  readonly pecaId: string;
  readonly celula: Celula;
  readonly orientacao: Orientacao;
}

// ST-12: a Caixa fornece exatamente uma Peça por sorteio, sem reposição; a
// Peça sorteada sai da Caixa e a primitiva não a posiciona — o consumo da
// Peça sorteada pertence à camada da Partida (issue #139).
export interface PecaSorteadaEvento {
  readonly tipo: 'peca_sorteada';
  readonly pecaId: string;
  readonly tipoDaPeca: TipoDePecaDaCaixa;
  readonly orientacao: Orientacao;
}

export interface ManipulacaoFinalizadaEvento {
  readonly tipo: 'manipulacao_finalizada';
  readonly pecaId: string;
}

export interface PeaoSelecionadoEvento {
  readonly tipo: 'peao_selecionado';
  readonly peaoId: string;
}

// Espelho da desseleção autoritativa (issue #249): emitido apenas quando a
// seleção vigente é efetivamente limpa.
export interface PeaoDesselecionadoEvento {
  readonly tipo: 'peao_desselecionado';
  readonly peaoId: string;
}

// Pendências geradas pelo Recebimento (issue #138): uma por peça sorteada,
// com a vaga (e a célula-alvo derivada dela) ainda nulas até a escolha.
export interface PendenciaDeRecebimento {
  readonly recebidaId: string;
  readonly pecaId: string;
  readonly tipoDaPeca: TipoDePecaDaCaixa;
  readonly orientacao: Orientacao;
  readonly vaga: BordaCardinal | null;
  readonly celulaAlvo: Celula | null;
}

export interface RecebimentoGeradoEvento {
  readonly tipo: 'recebimento_gerado';
  readonly recebidas: readonly PendenciaDeRecebimento[];
}

export interface PeaoPosicionadoEvento {
  readonly tipo: 'peao_posicionado';
  readonly peaoId: string;
  readonly pecaId: string;
  readonly celula: Celula;
}

// Recebimento (issue #138): a escolha da vaga fixa a borda e a célula-alvo da
// pendência e seleciona a Peça sorteada correspondente.
export interface VagaDaPecaRecebidaEscolhidaEvento {
  readonly tipo: 'vaga_da_peca_recebida_escolhida';
  readonly recebidaId: string;
  readonly borda: BordaCardinal;
  readonly celulaAlvo: Celula;
}

export interface PeaoMovidoEvento {
  readonly tipo: 'peao_movido';
  readonly peaoId: string;
  readonly pecaIdDe: string;
  readonly pecaIdPara: string;
  readonly celula: Celula;
}

export interface PeaoPermaneceuEvento {
  readonly tipo: 'peao_permaneceu';
  readonly peaoId: string;
  readonly pecaId: string;
}

// Limpeza (ST-13 / issue #147): nos pontos definitivos da Iluminação, as Peças
// cujas células ficaram fora dela são removidas permanentemente do estado —
// sem retorno à Caixa. Emitido apenas quando houver Peças removidas.
export interface LimpezaAplicadaEvento {
  readonly tipo: 'limpeza_aplicada';
  readonly pecasRemovidas: readonly string[];
}

export type EventoDoTabuleiro =
  | PecaSelecionadaEvento
  | PecaDeselecionadaEvento
  | PecaGiradaEvento
  | PecaPosicionadaEvento
  | PecaSorteadaEvento
  | ManipulacaoFinalizadaEvento
  | PeaoSelecionadoEvento
  | PeaoDesselecionadoEvento
  | RecebimentoGeradoEvento
  | PeaoPosicionadoEvento
  | VagaDaPecaRecebidaEscolhidaEvento
  | PeaoMovidoEvento
  | PeaoPermaneceuEvento
  | LimpezaAplicadaEvento;

export type CodigoDeErroDeTabuleiro =
  | 'DADOS_INVALIDOS'
  | 'PECA_NAO_ENCONTRADA'
  | 'PECA_NAO_SELECIONADA'
  | 'CAIXA_ESGOTADA'
  | 'CELULA_NAO_ENCONTRADA'
  | 'CELULA_JA_OCUPADA'
  | 'PECA_JA_POSICIONADA'
  | 'MANIPULACAO_ENCERRADA'
  | 'PEAO_NAO_ENCONTRADO'
  | 'PEAO_JA_POSICIONADO'
  | 'PEAO_NAO_SELECIONADO'
  | 'PECA_INICIAL_EXIGIDA'
  | 'CELULA_SEM_PECA'
  | 'PECA_JA_TEM_PEAO'
  | 'PENDENCIA_NAO_RESOLVIDA'
  | 'MOVIMENTO_NAO_CONECTADO'
  | 'PECA_NAO_RECEBIDA'
  | 'PECA_FORA_DO_ALVO'
  | 'RECEBIDA_NAO_ENCONTRADA';

export interface ErroDeDominioDoTabuleiro {
  readonly tipo: 'erro_de_dominio';
  readonly codigo: CodigoDeErroDeTabuleiro;
  readonly mensagem: string;
}

export interface OperacaoBemSucedidaDoTabuleiro {
  readonly sucesso: true;
  readonly estado: EstadoDoTabuleiro;
  readonly eventos: readonly EventoDoTabuleiro[];
}

export interface OperacaoRejeitadaDoTabuleiro {
  readonly sucesso: false;
  readonly erro: ErroDeDominioDoTabuleiro;
}

export type ResultadoDoTabuleiro =
  | OperacaoBemSucedidaDoTabuleiro
  | OperacaoRejeitadaDoTabuleiro;

// Cores canônicas (placeholder) dos Peões — N = 2–4 fatiadas pela ordem
// (issue #285); ids determinísticos por cor.
const CORES_DOS_PEOES: readonly CorDoPeao[] = [
  'branco',
  'vermelho',
  'azul',
  'amarelo',
];

// Composição fixa da Caixa (ST-12 / issue #144, ampliada pela ST-15 / issue
// #169): 54 peças de caminho, 17 especiais e 12 monstros, 89 no total. As N
// Peças Iniciais ficam fora da Caixa.
export const COMPOSICAO_DA_CAIXA: readonly {
  readonly tipo: TipoDePecaDaCaixa;
  readonly quantidade: number;
}[] = [
    { tipo: 'reta', quantidade: 10 },
    { tipo: 'T', quantidade: 32 },
    { tipo: 'cruz', quantidade: 12 },
    { tipo: 'gerador', quantidade: 6 },
    { tipo: 'sala_do_diretor', quantidade: 3 },
    { tipo: 'sala_medica', quantidade: 4 },
    { tipo: 'portao_de_saida', quantidade: 4 },
    { tipo: 'vulto', quantidade: 9 },
    { tipo: 'espectro', quantidade: 9 },
  ];

// Ids determinísticos por tipo: reta-1..10, t-1..32, cruz-1..12,
// gerador-1..6, sala-do-diretor-1..3, sala-medica-1..4, portao-de-saida-1..4,
// vulto-1..6, espectro-1..6.
const ID_DO_TIPO: Record<TipoDePecaDaCaixa, string> = {
  reta: 'reta',
  T: 't',
  cruz: 'cruz',
  gerador: 'gerador',
  sala_do_diretor: 'sala-do-diretor',
  sala_medica: 'sala-medica',
  portao_de_saida: 'portao-de-saida',
  vulto: 'vulto',
  espectro: 'espectro',
};

// Caixa na ordem de composição (sem embaralhar): determinismo preservado para
// estados sem seed e para a serialização em JSON puro.
function montarCaixa(): PecaDaCaixa[] {
  const caixa: PecaDaCaixa[] = [];
  for (const entrada of COMPOSICAO_DA_CAIXA) {
    for (let indice = 1; indice <= entrada.quantidade; indice++) {
      caixa.push({
        pecaId: `${ID_DO_TIPO[entrada.tipo]}-${indice}`,
        tipo: entrada.tipo,
        orientacao: 0,
      });
    }
  }
  return caixa;
}

// PRNG determinístico (mulberry32): 32 bits, sem dependências externas.
function criarPrng(seed: number): () => number {
  let estado = seed >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ehPecaDeCaminho(tipo: TipoDePecaDaCaixa): boolean {
  return !ehPecaEspecial(tipo) && !ehPecaDeMonstro(tipo);
}

// Regras 2 e 4 são a mesma forma "janela por tipo" (diferem em raio e
// categoria): o tipo aparece na janela das últimas `raio` posições da fila?
function tipoNaJanela(
  fila: PecaDaCaixa[],
  tipo: TipoDePecaDaCaixa,
  raio: number,
): boolean {
  const inicio = Math.max(0, fila.length - raio);
  for (let i = inicio; i < fila.length; i++) {
    if (fila[i].tipo === tipo) return true;
  }
  return false;
}

// Algoritmo clássico reutilizado internamente com o PRNG do sistema
function fisherYates<T>(array: T[], prng: () => number): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Embaralha a Parte 1 (22 cartas) garantindo que as primeiras 10 cartas
 * sejam exclusivamente caminho ou portao_de_saida.
 */
function montarParteUm(
  pecasDaParte: PecaDaCaixa[],
  prng: () => number,
): PecaDaCaixa[] {
  let permitidasPrimeiras = pecasDaParte.filter(
    (p) => ehPecaDeCaminho(p.tipo) || p.tipo === 'portao_de_saida',
  );
  const proibidasPrimeiras = pecasDaParte.filter(
    (p) => !ehPecaDeCaminho(p.tipo) && p.tipo !== 'portao_de_saida',
  );

  permitidasPrimeiras = fisherYates(permitidasPrimeiras, prng);

  // Seleciona as 10 primeiras
  const primeirasDez = permitidasPrimeiras.slice(0, 10);
  const sobraPermitidas = permitidasPrimeiras.slice(10);

  // As 12 restantes da Parte 1 misturam tudo o que sobrou
  const restantes = fisherYates([...sobraPermitidas, ...proibidasPrimeiras], prng);

  return [...primeirasDez, ...restantes];
}

function embaralharCaixa(
  caixa: readonly PecaDaCaixa[],
  seed: number,
): PecaDaCaixa[] {
  const prng = criarPrng(seed);

  // Agrupa peças por tipo a partir da Caixa montada
  const poolPorTipo = new Map<TipoDePecaDaCaixa, PecaDaCaixa[]>();
  for (const peca of caixa) {
    const lista = poolPorTipo.get(peca.tipo) ?? [];
    lista.push(peca);
    poolPorTipo.set(peca.tipo, lista);
  }

  // Embaralha cada grupo internamente
  for (const [tipo, lista] of poolPorTipo.entries()) {
    poolPorTipo.set(tipo, fisherYates(lista, prng));
  }

  const retirar = (tipo: TipoDePecaDaCaixa, qtd: number): PecaDaCaixa[] => {
    const lista = poolPorTipo.get(tipo);
    if (!lista || lista.length < qtd) {
      throw new Error(`Estoque insuficiente para o tipo ${tipo}`);
    }
    return lista.splice(0, qtd);
  };

  // 1. Distribui os monstros e especiais obrigatórios por parte
  const parte1Especiais = [
    ...retirar('gerador', 1),
    ...retirar('sala_medica', 1),
    ...retirar('portao_de_saida', 1),
    ...retirar('vulto', 2),
    ...retirar('espectro', 2),
  ]; // 7 peças

  const parte2Especiais = [
    ...retirar('gerador', 2),
    ...retirar('sala_medica', 1),
    ...retirar('portao_de_saida', 1),
    ...retirar('vulto', 3),
    ...retirar('espectro', 3),
  ]; // 10 peças

  const parte3Especiais = [
    ...retirar('gerador', 1),
    ...retirar('sala_medica', 1),
    ...retirar('portao_de_saida', 1),
    ...retirar('vulto', 2),
    ...retirar('espectro', 2),
  ]; // 7 peças

  const parte4Especiais = [
    ...retirar('gerador', 2),
    ...retirar('sala_medica', 1),
    ...retirar('portao_de_saida', 1),
    ...retirar('vulto', 2),
    ...retirar('espectro', 2),
  ]; // 8 peças

  // 2. Preenche a Parte 1 com 15 caminhos (total 22 peças, garantindo >= 10 permitidas para o início)
  const caminhosRestantes = [
    ...(poolPorTipo.get('reta') ?? []),
    ...(poolPorTipo.get('T') ?? []),
    ...(poolPorTipo.get('cruz') ?? []),
  ];
  const caminhosEmbaralhados = fisherYates(caminhosRestantes, prng);

  const caminhosParte1 = caminhosEmbaralhados.splice(0, 15);
  const pecasParte1 = [...parte1Especiais, ...caminhosParte1]; // Total: 22

  // 3. O restante dos caminhos (39) + as 3 salas do diretor preenchem partes 2, 3 e 4
  const salasDoDiretor = poolPorTipo.get('sala_do_diretor') ?? [];
  const flexiveisRestantes = fisherYates(
    [...caminhosEmbaralhados, ...salasDoDiretor],
    prng,
  );

  // Parte 2 completa 22 (precisa de 12)
  const flexParte2 = flexiveisRestantes.splice(0, 12);
  // Parte 3 completa 22 (precisa de 15)
  const flexParte3 = flexiveisRestantes.splice(0, 15);
  // Parte 4 completa 23 (precisa de 15)
  const flexParte4 = flexiveisRestantes.splice(0, 15);

  // 4. Monta e embaralha individualmente cada bloco
  const parte1Final = montarParteUm(pecasParte1, prng);
  const parte2Final = fisherYates([...parte2Especiais, ...flexParte2], prng);
  const parte3Final = fisherYates([...parte3Especiais, ...flexParte3], prng);
  const parte4Final = fisherYates([...parte4Especiais, ...flexParte4], prng);

  return [...parte1Final, ...parte2Final, ...parte3Final, ...parte4Final];
}

export interface EntradaDoEstadoDoTabuleiro {
  // Seed opcional do embaralhamento da Caixa; sem seed, a Caixa permanece na
  // ordem de composição (determinismo preservado para testes). O game-server
  // passa a seed real na integração da Partida (issue #139).
  readonly seed?: number;
  // Tamanho do roster (issue #285): quantas Peças Iniciais e Peões criar
  // (inicial-1..N, N cores pela ordem). Ausente ≡ 4 (retrocompatível com os
  // estados e testes que assumem o roster cheio); a Partida sempre informa N.
  readonly numeroDeJogadores?: number;
}

// Partida recém-preparada: Caixa com a composição fixa de 83 peças
// (embaralhada quando a seed é fornecida) e as N Peças Iniciais fora dela
// (N = numeroDeJogadores, 4 por padrão).
//
// Não é entry-point público para N: o roster inválido é rejeitado com
// DADOS_INVALIDOS em estadoInicialDaPartida (partida.ts), que valida antes
// de delegar para cá. A chamada direta com numeroDeJogadores fora de 2–4
// lança Error (em vez de retornar Resultado rejeitado) para preservar a
// assinatura pública consumida pelo backend
// (backend/game-server/src/partidas/tabuleiro.ts chama
// estadoInicialDoTabuleiro() sem argumentos) — Opção B da issue #285.
// @throws Error quando numeroDeJogadores é informado fora de 2–4.
export function estadoInicialDoTabuleiro(
  entrada?: EntradaDoEstadoDoTabuleiro,
): EstadoDoTabuleiro {
  const caixa = montarCaixa();
  const numeroDeJogadores = entrada?.numeroDeJogadores ?? CORES_DOS_PEOES.length;
  if (
    !Number.isInteger(numeroDeJogadores) ||
    numeroDeJogadores < 2 ||
    numeroDeJogadores > CORES_DOS_PEOES.length
  ) {
    throw new Error(
      'O Tabuleiro exige de dois a quatro jogadores.',
    );
  }
  const cores = CORES_DOS_PEOES.slice(0, numeroDeJogadores);
  return {
    caixa:
      entrada?.seed === undefined
        ? caixa
        : embaralharCaixa(caixa, entrada.seed),
    iniciais: Array.from({ length: numeroDeJogadores }, (_, indice) => ({
      pecaId: `inicial-${indice + 1}`,
      tipo: 'inicial' as const,
      orientacao: 0 as const,
    })),
    posicionadas: [],
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: null,
    // Os N Peões começam sobre a Mesa, sem Peça.
    peoes: cores.map((cor) => ({
      peaoId: `peao-${cor}`,
      cor,
      pecaId: null,
    })),
    peaoSelecionadoId: null,
    recebidas: [],
  };
}

// Primitiva de sorteio (ST-12): retira a primeira Peça da Caixa, sem
// reposição, e emite peca_sorteada — sem posicionar a Peça. Caixa esgotada
// rejeita com CAIXA_ESGOTADA e preserva o estado.
export function sortearDaCaixa(estado: EstadoDoTabuleiro): ResultadoDoTabuleiro {
  const [peca, ...resto] = estado.caixa;
  if (!peca) {
    return rejeitar('CAIXA_ESGOTADA', 'A Caixa não possui mais Peças.');
  }
  return sucesso(
    { ...estado, caixa: resto },
    [
      {
        tipo: 'peca_sorteada',
        pecaId: peca.pecaId,
        tipoDaPeca: peca.tipo,
        orientacao: peca.orientacao,
      },
    ],
  );
}

// Vizinhança ortogonal toroidal (ADR-0004, continuidade da issue #260):
// apenas células que compartilham uma borda; diagonais não são vizinhas. As
// quatro direções são avaliadas em ordem fixa (norte, leste, sul, oeste) e
// sempre existem — na borda, a vizinha é o lado oposto (wrap % 7).
export function vizinhos(celula: Celula): Celula[] {
  const centro = normalizarCelula(celula);
  const candidatas: Celula[] = [
    { linha: centro.linha - 1, coluna: centro.coluna },
    { linha: centro.linha, coluna: centro.coluna + 1 },
    { linha: centro.linha + 1, coluna: centro.coluna },
    { linha: centro.linha, coluna: centro.coluna - 1 },
  ];
  return candidatas.map((vizinha) => normalizarCelula(vizinha));
}

// Iluminação (ST-13 / ADR-0005, refinada pela ST-15 / issue #170): união
// ortogonal das células dos Peões — célula do Peão + 4 vizinhas por
// vizinhos() — compartilhada, com vazias inclusas. Jogador em Baixa
// Iluminação (issue #170) ilumina apenas a própria célula. Pura,
// independente de conexões/bordasAbertas, determinística (ordenada linha asc,
// coluna asc) e defensiva contra pecaId órfão. O segundo parâmetro lista os
// peaoIds em Baixa; ausente ≡ nenhum.
export function calcularIluminacao(
  tabuleiro: EstadoDoTabuleiro,
  peaoIdsEmBaixa: readonly string[] = [],
): readonly Celula[] {
  const emBaixa = new Set(peaoIdsEmBaixa);
  const mapa = new Map<string, Celula>();
  for (const peao of tabuleiro.peoes) {
    if (peao.pecaId === null) continue;
    const peca = tabuleiro.posicionadas.find((item) => item.pecaId === peao.pecaId);
    if (!peca) continue;
    const celulas: Celula[] = emBaixa.has(peao.peaoId)
      ? [peca.celula]
      : [peca.celula, ...vizinhos(peca.celula)];
    for (const celula of celulas) {
      const chave = `${celula.linha},${celula.coluna}`;
      if (!mapa.has(chave)) {
        mapa.set(chave, { linha: celula.linha, coluna: celula.coluna });
      }
    }
  }
  return [...mapa.values()].sort((a, b) =>
    a.linha !== b.linha ? a.linha - b.linha : a.coluna - b.coluna,
  );
}

// Limpeza (ST-13 / issue #147): remove permanentemente do estado as Peças
// posicionadas cujas células ficaram fora da Iluminação — sem retorno à Caixa.
// Pura e determinística (percorre tabuleiro.posicionadas na ordem existente).
// Defensiva: preserva explicitamente qualquer Peça sob um Peão, mesmo que a
// Iluminação já a garanta por critério de aceitação.
export function aplicarLimpeza(
  tabuleiro: EstadoDoTabuleiro,
  celulasIluminadas: readonly Celula[],
): {
  posicionadas: readonly PecaPosicionada[];
  removidas: readonly string[];
} {
  const iluminadas = new Set(
    celulasIluminadas.map((celula) => `${celula.linha},${celula.coluna}`),
  );
  // Conjunto defensivo dos pecaIds sob os Peões: nunca removidos, mesmo que a
  // Iluminação já os cubra.
  const sobPeao = new Set(
    tabuleiro.peoes
      .map((peao) => peao.pecaId)
      .filter((pecaId): pecaId is string => pecaId !== null),
  );

  const posicionadas: PecaPosicionada[] = [];
  const removidas: string[] = [];
  for (const peca of tabuleiro.posicionadas) {
    const chave = `${peca.celula.linha},${peca.celula.coluna}`;
    if (iluminadas.has(chave) || sobPeao.has(peca.pecaId)) {
      posicionadas.push(peca);
    } else {
      removidas.push(peca.pecaId);
    }
  }
  return { posicionadas, removidas };
}

export function aplicarComandoDeTabuleiro(
  estado: EstadoDoTabuleiro,
  comando: ComandoDeTabuleiro,
): ResultadoDoTabuleiro {
  switch (comando.tipo) {
    case 'selecionar_peca':
      return selecionarPeca(estado, comando);
    case 'girar_peca':
      return girarPeca(estado, comando);
    case 'posicionar_peca':
      return posicionarPeca(estado, comando);
    case 'finalizar_manipulacao':
      return finalizarManipulacao(estado);
    case 'selecionar_peao':
      return selecionarPeao(estado, comando);
    case 'desselecionar_peao':
      return desselecionarPeao(estado, comando);
    case 'posicionar_peao':
      return posicionarPeao(estado, comando);
    case 'escolher_vaga_da_peca_recebida':
      return escolherVagaDaPecaRecebida(estado, comando);
    case 'mover_peao':
      return moverPeao(estado, comando);
    case 'permanecer':
      return permanecer(estado, comando);
    default: {
      // Exaustividade: um novo ComandoDeTabuleiro sem case próprio falha a
      // compilação aqui; em runtime, entrada externa pode bypassar tipos.
      const _comandoExaustivo: never = comando;
      return rejeitar('DADOS_INVALIDOS', 'O comando de domínio é inválido.');
    }
  }
}

function selecionarPeca(
  estado: EstadoDoTabuleiro,
  comando: SelecionarPecaComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.pecaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  // Clique na própria peça posicionada encerra a Manipulação (Finalização).
  if (estado.pecaEmManipulacaoId === comando.pecaId) {
    return fecharManipulacao(estado);
  }

  const peca = encontrarNasIniciais(estado, comando.pecaId);
  if (peca) {
    if (
      estado.pecaSelecionadaId !== null &&
      estado.pecaSelecionadaId === comando.pecaId
    ) {
      // Clicar na própria selecionada desfaz a seleção.
      return sucesso(
        { ...estado, pecaSelecionadaId: null },
        [{ tipo: 'peca_deselecionada', pecaId: comando.pecaId }],
      );
    }

    // Nova seleção também encerra qualquer Manipulação em aberto.
    const eventos: EventoDoTabuleiro[] = [];
    if (estado.pecaEmManipulacaoId !== null) {
      eventos.push({
        tipo: 'manipulacao_finalizada',
        pecaId: estado.pecaEmManipulacaoId,
      });
    }
    eventos.push({ tipo: 'peca_selecionada', pecaId: comando.pecaId });
    return sucesso({ ...estado, pecaSelecionadaId: comando.pecaId, pecaEmManipulacaoId: null }, eventos);
  }

  if (encontrarPosicionada(estado, comando.pecaId)) {
    return rejeitar(
      'PECA_JA_POSICIONADA',
      'A Peça já foi posicionada no Tabuleiro.',
    );
  }

  return rejeitar('PECA_NAO_ENCONTRADA', 'A Peça não foi encontrada.');
}

function girarPeca(
  estado: EstadoDoTabuleiro,
  comando: GirarPecaComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.pecaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  if (
    comando.sentido !== 'horario' &&
    comando.sentido !== 'anti_horario'
  ) {
    return rejeitar(
      'DADOS_INVALIDOS',
      'O sentido deve ser "horario" ou "anti_horario".',
    );
  }

  // Janela de Manipulação aberta: apenas a própria peça posicionada pode ser
  // girada, até a Finalização.
  if (estado.pecaEmManipulacaoId !== null) {
    if (estado.pecaEmManipulacaoId === comando.pecaId) {
      return girarPosicionada(estado, comando);
    }
    if (encontrarNasIniciais(estado, comando.pecaId)) {
      return rejeitar(
        'PECA_NAO_SELECIONADA',
        'Há uma Manipulação em andamento; finalize-a antes de selecionar outra Peça.',
      );
    }
  }

  // Peça Recebida segue o mesmo padrão das Iniciais: só a selecionada gira.
  const recebida = encontrarRecebidaPorPeca(estado, comando.pecaId);
  if (recebida) {
    if (estado.pecaSelecionadaId !== comando.pecaId) {
      return rejeitar(
        'PECA_NAO_SELECIONADA',
        'A Peça Recebida indicada não é a selecionada.',
      );
    }
    return girarRecebida(estado, recebida, comando);
  }

  if (estado.pecaSelecionadaId === comando.pecaId) {
    // Seleção ativa de Peça Inicial: gira nos dois sentidos.
    return girarDaMesa(estado, comando);
  }

  if (encontrarPosicionada(estado, comando.pecaId)) {
    return rejeitar(
      'MANIPULACAO_ENCERRADA',
      'A Manipulação da Peça já foi finalizada; ela não pode mais ser girada.',
    );
  }

  if (encontrarNasIniciais(estado, comando.pecaId)) {
    return rejeitar(
      'PECA_NAO_SELECIONADA',
      'A Peça indicada não é a selecionada.',
    );
  }

  // Peça ainda dentro da Caixa: não é manipulável — sai apenas por sorteio.
  return rejeitar('PECA_NAO_ENCONTRADA', 'A Peça não foi encontrada.');
}

function posicionarPeca(
  estado: EstadoDoTabuleiro,
  comando: PosicionarPecaComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.pecaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const celulaInvalida = exigirCelulaNoAlcance(comando.celula);
  if (celulaInvalida) {
    return celulaInvalida;
  }

  // Grade toroidal (issue #260): a célula do comando normaliza antes de
  // qualquer comparação ou lookup — coordenadas fora de 0–6 alcançam o lado
  // oposto, inclusive a célula-alvo fixa da Recebida.
  const celula = normalizarCelula(comando.celula);
  const comandoNormalizado: PosicionarPecaComando = { ...comando, celula };

  // Peças Recebidas têm fluxo próprio: célula-alvo fixa da borda geradora.
  const recebida = encontrarRecebidaPorPeca(estado, comando.pecaId);
  if (recebida) {
    return posicionarRecebida(estado, recebida, comandoNormalizado);
  }

  // ST-12: a Caixa é opaca — apenas as Peças Iniciais (fora dela) e as
  // Recebidas são posicionáveis; peça de caminho entra só pelo Recebimento.
  const pecaNasIniciais = encontrarNasIniciais(estado, comando.pecaId);
  if (!pecaNasIniciais) {
    if (encontrarNaCaixa(estado, comando.pecaId)) {
      return rejeitar(
        'PECA_NAO_RECEBIDA',
        'Peças de caminho só podem entrar pelo Recebimento.',
      );
    }
    if (encontrarPosicionada(estado, comando.pecaId)) {
      return rejeitar(
        'PECA_JA_POSICIONADA',
        'A Peça já foi posicionada no Tabuleiro.',
      );
    }
    return rejeitar('PECA_NAO_ENCONTRADA', 'A Peça não foi encontrada.');
  }

  if (estado.pecaSelecionadaId !== comando.pecaId) {
    return rejeitar(
      'PECA_NAO_SELECIONADA',
      'A Peça indicada não é a selecionada.',
    );
  }

  if (encontrarPosicionadaPorCelula(estado, celula)) {
    return rejeitar(
      'CELULA_JA_OCUPADA',
      'A Célula já está ocupada por outra Peça.',
    );
  }

  const posicionada: PecaPosicionada = {
    pecaId: pecaNasIniciais.pecaId,
    tipo: pecaNasIniciais.tipo,
    orientacao: pecaNasIniciais.orientacao,
    celula,
  };
  const novoEstado: EstadoDoTabuleiro = {
    ...estado,
    iniciais: estado.iniciais.filter((item) => item.pecaId !== comando.pecaId),
    posicionadas: [...estado.posicionadas, posicionada],
    pecaSelecionadaId: null,
    // O Encaixe abre a janela de Manipulação da peça posicionada (e substitui
    // a de qualquer peça anterior, sempre fechada antes pela nova Seleção ou
    // pelo próprio encaixe).
    pecaEmManipulacaoId: posicionada.pecaId,
  };

  return sucesso(novoEstado, [
    {
      tipo: 'peca_posicionada',
      pecaId: posicionada.pecaId,
      celula: posicionada.celula,
      orientacao: posicionada.orientacao,
    },
  ]);
}

function finalizarManipulacao(estado: EstadoDoTabuleiro): ResultadoDoTabuleiro {
  if (estado.pecaEmManipulacaoId === null) {
    return rejeitar(
      'MANIPULACAO_ENCERRADA',
      'Não há Manipulação em andamento.',
    );
  }
  return fecharManipulacao(estado);
}

function fecharManipulacao(estado: EstadoDoTabuleiro): ResultadoDoTabuleiro {
  const pecaId = estado.pecaEmManipulacaoId;
  if (pecaId === null) {
    return rejeitar(
      'MANIPULACAO_ENCERRADA',
      'Não há Manipulação em andamento.',
    );
  }
  return sucesso(
    { ...estado, pecaEmManipulacaoId: null },
    [{ tipo: 'manipulacao_finalizada', pecaId }],
  );
}

function girarDaMesa(
  estado: EstadoDoTabuleiro,
  comando: GirarPecaComando,
): ResultadoDoTabuleiro {
  const pecaSelecionadaId = estado.pecaSelecionadaId;
  if (pecaSelecionadaId === null) {
    return rejeitar(
      'PECA_NAO_SELECIONADA',
      'Nenhuma Peça está selecionada.',
    );
  }
  const peca = encontrarNasIniciais(estado, pecaSelecionadaId);
  if (!peca) {
    return rejeitar('PECA_NAO_ENCONTRADA', 'A Peça não foi encontrada.');
  }

  const orientacaoNova = rotacionar(peca.orientacao, comando.sentido);
  const novoEstado: EstadoDoTabuleiro = {
    ...estado,
    iniciais: estado.iniciais.map((item) =>
      item.pecaId === peca.pecaId ? { ...item, orientacao: orientacaoNova } : item,
    ),
  };
  return sucesso(novoEstado, [
    {
      tipo: 'peca_girada',
      pecaId: peca.pecaId,
      orientacaoAnterior: peca.orientacao,
      orientacao: orientacaoNova,
      sentido: comando.sentido,
    },
  ]);
}

function girarPosicionada(
  estado: EstadoDoTabuleiro,
  comando: GirarPecaComando,
): ResultadoDoTabuleiro {
  const peca = encontrarPosicionada(estado, comando.pecaId);
  if (!peca) {
    return rejeitar('PECA_NAO_ENCONTRADA', 'A Peça não foi encontrada.');
  }

  const orientacaoNova = rotacionar(peca.orientacao, comando.sentido);

  // Encaixe conectado (issue #311): a rotação da janela de Manipulação não
  // pode fechar a borda da peça voltada à Peça sob o Peão selecionado — a
  // relação geradora do encaixe precisa permanecer conectada. A regra vale só
  // enquanto o Peão está sobre a geradora (células vizinhas); quando o Peão
  // sai dela nos turnos seguintes, não há relação a proteger e a rotação é
  // livre de novo — o Peão já não referencia a peça.
  const peao = estado.peoes.find(
    (item) => item.peaoId === estado.peaoSelecionadoId,
  );
  const geradora = peao?.pecaId
    ? encontrarPosicionada(estado, peao.pecaId)
    : undefined;
  const bordaDaGeradora = geradora
    ? bordaDaGeradoraVoltadaAPeca(geradora, peca)
    : undefined;
  if (
    geradora !== undefined &&
    geradora.pecaId !== peca.pecaId &&
    bordaDaGeradora !== undefined &&
    !conectaNaVaga(peca.tipo, orientacaoNova, bordaDaGeradora)
  ) {
    return rejeitar(
      'MOVIMENTO_NAO_CONECTADO',
      'A rotação fecharia a borda voltada à Peça sob o Peão selecionado; o encaixe deve permanecer conectado a ela.',
    );
  }

  const novoEstado: EstadoDoTabuleiro = {
    ...estado,
    posicionadas: estado.posicionadas.map((item) =>
      item.pecaId === peca.pecaId ? { ...item, orientacao: orientacaoNova } : item,
    ),
  };
  return sucesso(novoEstado, [
    {
      tipo: 'peca_girada',
      pecaId: peca.pecaId,
      orientacaoAnterior: peca.orientacao,
      orientacao: orientacaoNova,
      sentido: comando.sentido,
    },
  ]);
}

// Borda da geradora voltada à peça vizinha (distância Manhattan 1, com wrap
// toroidal da issue #260): a direção em que a peça está a partir da
// geradora. Retorna undefined quando não são vizinhas — sem vizinhança não
// há relação geradora a proteger.
function bordaDaGeradoraVoltadaAPeca(
  geradora: PecaPosicionada,
  peca: PecaPosicionada,
): BordaCardinal | undefined {
  const deltaLinha = deltaToroidal(geradora.celula.linha, peca.celula.linha);
  const deltaColuna = deltaToroidal(geradora.celula.coluna, peca.celula.coluna);
  if (Math.abs(deltaLinha) + Math.abs(deltaColuna) !== 1) {
    return undefined;
  }
  if (deltaLinha === -1) {
    return 'norte';
  }
  if (deltaColuna === 1) {
    return 'leste';
  }
  if (deltaLinha === 1) {
    return 'sul';
  }
  return 'oeste';
}

// Delta toroidal entre duas coordenadas (issue #260): o passo mais curto no
// anel módulo 7 — 6 ≡ -1, então peças nas bordas opostas são vizinhas.
function deltaToroidal(de: number, para: number): number {
  const bruto =
    (((para - de) % LADO_DA_GRADE) + LADO_DA_GRADE) % LADO_DA_GRADE;
  return bruto === LADO_DA_GRADE - 1 ? -1 : bruto;
}

function encontrarNasIniciais(
  estado: EstadoDoTabuleiro,
  pecaId: string,
): PecaInicial | undefined {
  return estado.iniciais.find((peca) => peca.pecaId === pecaId);
}

function encontrarNaCaixa(
  estado: EstadoDoTabuleiro,
  pecaId: string,
): PecaDaCaixa | undefined {
  return estado.caixa.find((peca) => peca.pecaId === pecaId);
}
