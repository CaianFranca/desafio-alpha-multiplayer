// Domínio puro do Tabuleiro (ST-09 / issue #82, ST-10 / issue #89 e ST-12 /
// issue #144).
//
// Seam único das regras de tabuleiro: grade fixa 7x7 (ADR-0004), Caixa
// (ST-12) com as 4 Peças Iniciais fora dela, Seleção única e janela de
// Manipulação (ST-09), e os tipos do ciclo de Peões com o dispatch
// aplicarComandoDeTabuleiro (ST-10) — que produz eventos de domínio e
// rejeições com códigos fechados, no mesmo padrão do domínio do lobby
// (lobby.ts). Os handlers de Peões, conexões, Recebimento e ciclo, e a
// camada base compartilhada (resultado, validação, grade, rotação, bordas),
// vivem em peoes.ts — a dependência em runtime é única: tabuleiro.ts →
// peoes.ts. Nenhum contrato wire, Redis ou Express vive aqui: este módulo é
// domínio puro e imutável.

import {
  exigirCelulaNoAlcance,
  escolherTipoDaPecaRecebida,
  estaDentroDaGrade,
  encontrarPosicionada,
  encontrarPosicionadaPorCelula,
  encontrarRecebidaPorPeca,
  girarRecebida,
  moverPeao,
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
  LADO_DA_GRADE,
  bordasAbertas,
  gerarRecebidas,
  validarTexto,
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

// Tipos que compõem a Caixa: caminho + especiais. A Peça Inicial nunca entra
// na Caixa.
export type TipoDePecaDaCaixa = TipoDePecaDeCaminho | TipoDePecaEspecial;

// Todos os tipos de Peça do Tabuleiro: a Inicial (fora da Caixa) mais os
// tipos da Caixa.
export type TipoDaPeca = 'inicial' | TipoDePecaDeCaminho | TipoDePecaEspecial;
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

// As 4 Peças Iniciais de partida, fora da Caixa; cada Jogador encaixa a
// própria diretamente no Primeiro Turno (ST-11).
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

// Slot do Recebimento (ST-10): criado ao selecionar um Peão posicionado, um
// para cada borda aberta com célula vizinha vazia. Não contém Peça até a
// escolha do tipo (escolher_tipo_da_peca_recebida), que atribui pecaId e tipo
// a partir da Caixa.
export interface PecaRecebida {
  readonly recebidaId: string;
  readonly bordaGeradora: BordaCardinal;
  readonly celulaAlvo: Celula;
  readonly pecaId: string | null;
  readonly tipo: TipoDePecaDeCaminho | null;
  readonly orientacao: Orientacao;
}

// `pecaSelecionadaId` aponta para uma Peça Inicial fora da Caixa (Seleção
// única) ou, no ciclo do Peão, para a Peça atribuída à Recebida escolhida
// mais recentemente. `pecaEmManipulacaoId` aponta para a última peça
// posicionada enquanto sua janela de Manipulação está aberta; Finalização
// (nova seleção, novo posicionamento ou clique na própria peça posicionada)
// fecha a janela.
export interface EstadoDoTabuleiro {
  // Caixa da partida (ST-12): composição fixa de 71 peças de caminho e
  // especiais, embaralhada uma única vez na criação do estado; sorteio
  // unitário sem reposição (sortearDaCaixa e escolher_tipo_da_peca_recebida).
  readonly caixa: readonly PecaDaCaixa[];
  // As 4 Peças Iniciais, fora da Caixa, encaixadas diretamente.
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

export interface PosicionarPeaoComando {
  readonly tipo: 'posicionar_peao';
  readonly peaoId: string;
  readonly celula: Celula;
}

export interface EscolherTipoDaPecaRecebidaComando {
  readonly tipo: 'escolher_tipo_da_peca_recebida';
  readonly recebidaId: string;
  // O discriminador da união ocupa o nome "tipo"; o tipo da Peça de caminho
  // escolhido na Caixa vem em "tipoDaPeca".
  readonly tipoDaPeca: TipoDePecaDeCaminho;
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
  | PosicionarPeaoComando
  | EscolherTipoDaPecaRecebidaComando
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

// Pendências geradas pelo Recebimento: um slot por borda aberta com célula
// vizinha vazia, com a célula-alvo já fixada.
export interface PendenciaDeRecebimento {
  readonly recebidaId: string;
  readonly bordaGeradora: BordaCardinal;
  readonly celulaAlvo: Celula;
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

export interface TipoDaPecaRecebidaEscolhidoEvento {
  readonly tipo: 'tipo_da_peca_recebida_escolhido';
  readonly recebidaId: string;
  readonly pecaId: string;
  readonly tipoDaPeca: TipoDePecaDeCaminho;
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

export type EventoDoTabuleiro =
  | PecaSelecionadaEvento
  | PecaDeselecionadaEvento
  | PecaGiradaEvento
  | PecaPosicionadaEvento
  | PecaSorteadaEvento
  | ManipulacaoFinalizadaEvento
  | PeaoSelecionadoEvento
  | RecebimentoGeradoEvento
  | PeaoPosicionadoEvento
  | TipoDaPecaRecebidaEscolhidoEvento
  | PeaoMovidoEvento
  | PeaoPermaneceuEvento;

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

// Cores canônicas (placeholder) dos 4 Peões; ids determinísticos por cor.
const CORES_DOS_PEOES: readonly CorDoPeao[] = [
  'branco',
  'vermelho',
  'azul',
  'amarelo',
];

// Composição fixa da Caixa (ST-12 / issue #144): 54 peças de caminho e 17
// especiais, 71 no total. As 4 Peças Iniciais ficam fora da Caixa.
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
];

// Ids determinísticos por tipo: reta-1..10, t-1..32, cruz-1..12,
// gerador-1..6, sala-do-diretor-1..3, sala-medica-1..4, portao-de-saida-1..4.
const ID_DO_TIPO: Record<TipoDePecaDaCaixa, string> = {
  reta: 'reta',
  T: 't',
  cruz: 'cruz',
  gerador: 'gerador',
  sala_do_diretor: 'sala-do-diretor',
  sala_medica: 'sala-medica',
  portao_de_saida: 'portao-de-saida',
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

// Embaralhamento único (Fisher-Yates) guiado pela seed: a mesma seed produz
// exatamente a mesma ordem da Caixa.
function embaralharCaixa(
  caixa: readonly PecaDaCaixa[],
  seed: number,
): PecaDaCaixa[] {
  const prng = criarPrng(seed);
  const embaralhada = [...caixa];
  for (let indice = embaralhada.length - 1; indice > 0; indice--) {
    const alvo = Math.floor(prng() * (indice + 1));
    [embaralhada[indice], embaralhada[alvo]] = [
      embaralhada[alvo],
      embaralhada[indice],
    ];
  }
  return embaralhada;
}

export interface EntradaDoEstadoDoTabuleiro {
  // Seed opcional do embaralhamento da Caixa; sem seed, a Caixa permanece na
  // ordem de composição (determinismo preservado para testes). O game-server
  // passa a seed real na integração da Partida (issue #139).
  readonly seed?: number;
}

// Partida recém-preparada: Caixa com a composição fixa de 71 peças
// (embaralhada quando a seed é fornecida) e as 4 Peças Iniciais fora dela.
export function estadoInicialDoTabuleiro(
  entrada?: EntradaDoEstadoDoTabuleiro,
): EstadoDoTabuleiro {
  const caixa = montarCaixa();
  return {
    caixa:
      entrada?.seed === undefined
        ? caixa
        : embaralharCaixa(caixa, entrada.seed),
    iniciais: [1, 2, 3, 4].map((ordem) => ({
      pecaId: `inicial-${ordem}`,
      tipo: 'inicial' as const,
      orientacao: 0 as const,
    })),
    posicionadas: [],
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: null,
    // Os 4 Peões começam sobre a Mesa, sem Peça.
    peoes: CORES_DOS_PEOES.map((cor) => ({
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

// Vizinhança ortogonal (ADR-0004): apenas células que compartilham uma borda;
// diagonais não são vizinhas. As quatro direções são avaliadas em ordem fixa
// (norte, leste, sul, oeste) e as que caem fora da grade são descartadas.
export function vizinhos(celula: Celula): Celula[] {
  const candidatas: Celula[] = [
    { linha: celula.linha - 1, coluna: celula.coluna },
    { linha: celula.linha, coluna: celula.coluna + 1 },
    { linha: celula.linha + 1, coluna: celula.coluna },
    { linha: celula.linha, coluna: celula.coluna - 1 },
  ];
  return candidatas.filter((vizinha) =>
    estaDentroDaGrade(vizinha.linha) && estaDentroDaGrade(vizinha.coluna),
  );
}

// Iluminação (ST-13 / ADR-0005): união ortogonal das células dos Peões —
// célula do Peão + 4 vizinhas por vizinhos() — compartilhada, com vazias
// inclusas. Pura, independente de conexões/bordasAbertas, determinística
// (ordenada linha asc, coluna asc) e defensiva contra pecaId órfão.
export function calcularIluminacao(tabuleiro: EstadoDoTabuleiro): readonly Celula[] {
  const mapa = new Map<string, Celula>();
  for (const peao of tabuleiro.peoes) {
    if (peao.pecaId === null) continue;
    const peca = tabuleiro.posicionadas.find((item) => item.pecaId === peao.pecaId);
    if (!peca) continue;
    const celulas: Celula[] = [peca.celula, ...vizinhos(peca.celula)];
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
    case 'posicionar_peao':
      return posicionarPeao(estado, comando);
    case 'escolher_tipo_da_peca_recebida':
      return escolherTipoDaPecaRecebida(estado, comando);
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

  // Peças Recebidas têm fluxo próprio: célula-alvo fixa da borda geradora.
  const recebida = encontrarRecebidaPorPeca(estado, comando.pecaId);
  if (recebida) {
    return posicionarRecebida(estado, recebida, comando);
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

  if (encontrarPosicionadaPorCelula(estado, comando.celula)) {
    return rejeitar(
      'CELULA_JA_OCUPADA',
      'A Célula já está ocupada por outra Peça.',
    );
  }

  const posicionada: PecaPosicionada = {
    pecaId: pecaNasIniciais.pecaId,
    tipo: pecaNasIniciais.tipo,
    orientacao: pecaNasIniciais.orientacao,
    celula: comando.celula,
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
