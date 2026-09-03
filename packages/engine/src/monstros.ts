// Domínio puro do Alcance e do Ataque dos Monstros (ST-15 / issue #172).
//
// O Tabuleiro calcula o Alcance de cada Monstro a partir das Conexões —
// Vulto: linhas retas ortogonais encadeadas por Conexão a partir da sua peça,
// sem diagonais, distância ilimitada, interrompidas por célula vazia ou borda
// fechada; Espectro: as peças adjacentes conectadas nas quatro direções
// ortogonais. Peças de Monstro retransmitem como qualquer peça (as quatro
// bordas abertas, issue #169). A resolução do Ataque é pura e delta-based:
// compara o conjunto de peões dentro do Alcance atual de cada Monstro com o
// snapshot do gatilho anterior (peoesNoAlcance no EstadoDaPartida) — conjunto
// diferente ⇒ o Monstro ataca, atingindo todos os peões dentro do Alcance
// atual, negado pela Proteção (consumida uma única vez por resolução,
// negando todos os ataques simultâneos contra o mesmo Jogador). A aplicação
// das penalidades (Baixa Iluminação, perda de Sanidade) é da issue #170 e o
// eco no wire é da issue #173: o evento carrega também `estadosAplicados` —
// o estado RESULTANTE de cada Jogador cujo roster mudou com as penalidades
// do gatilho (preenchido pela camada da Partida, que conhece o roster; a
// resolução pura abaixo o emite vazio).
//
// Sem ciclos: a dependência em runtime é única — partida.ts → monstros.ts →
// tabuleiro.ts → peoes.ts. Nenhum contrato wire, Redis ou Express vive aqui:
// domínio puro e imutável.

import {
  bordasAbertas,
  celulaVizinhaNaBorda,
  ehPecaDeMonstro,
  vizinhasConectadas,
  type BordaCardinal,
  type EstadoDoTabuleiro,
  type PecaPosicionada,
  type TipoDePecaDeMonstro,
} from './tabuleiro.ts';

// Peça posicionada com o tipo estreitado para Monstro (type guard abaixo).
type PecaDeMonstroPosicionada = PecaPosicionada & {
  readonly tipo: TipoDePecaDeMonstro;
};

function ehPecaDeMonstroPosicionada(
  peca: PecaPosicionada,
): peca is PecaDeMonstroPosicionada {
  return ehPecaDeMonstro(peca.tipo);
}

// Alcance (issue #172): área efetiva de ataque de um Monstro a partir da
// própria peça. Vulto: um raio por borda aberta, um passo por vez com a
// MESMA semântica de Conexão de vizinhasConectadas — borda aberta na origem,
// célula vizinha dentro da grade com peça posicionada e borda oposta da
// vizinha aberta — encadeado pela mesma direção até célula vazia ou borda
// fechada, distância ilimitada. Espectro: exatamente as vizinhas conectadas
// (um passo). Peça inexistente ou não-Monstro: [] (defensivo). Resultado
// determinístico: por direção (norte, leste, sul, oeste) e distância
// crescente; peças de Monstro retransmitem (vêm de graça de bordasAbertas).
export function calcularAlcance(
  estado: EstadoDoTabuleiro,
  pecaIdDoMonstro: string,
): PecaPosicionada[] {
  const origem = estado.posicionadas.find(
    (peca) => peca.pecaId === pecaIdDoMonstro,
  );
  if (!origem || !ehPecaDeMonstro(origem.tipo)) {
    return [];
  }
  if (origem.tipo === 'espectro') {
    return vizinhasConectadas(estado, pecaIdDoMonstro);
  }

  // Vulto: raios retos — cada borda aberta da peça do Monstro inicia um raio
  // que avança sempre na mesma direção cardeal enquanto a Conexão persiste.
  const alcance: PecaPosicionada[] = [];
  for (const borda of bordasAbertas(origem)) {
    let origemDoPasso = origem;
    for (;;) {
      const proxima = proximaConectadaNaBorda(estado, origemDoPasso, borda);
      if (!proxima) {
        break;
      }
      alcance.push(proxima);
      origemDoPasso = proxima;
    }
  }
  return alcance;
}

// Um passo do raio do Vulto: a borda indicada da origem deve estar aberta e a
// peça vizinha naquela célula deve estar conectada (borda oposta aberta) — a
// mesma semântica de vizinhasConectadas, filtrada pela direção do raio.
// Célula vazia, fora da grade ou borda fechada encerra o raio (null).
function proximaConectadaNaBorda(
  estado: EstadoDoTabuleiro,
  origem: PecaPosicionada,
  borda: BordaCardinal,
): PecaPosicionada | null {
  if (!bordasAbertas(origem).includes(borda)) {
    return null;
  }
  const celulaAlvo = celulaVizinhaNaBorda(origem.celula, borda);
  if (!celulaAlvo) {
    return null;
  }
  return (
    vizinhasConectadas(estado, origem.pecaId).find(
      (peca) =>
        peca.celula.linha === celulaAlvo.linha &&
        peca.celula.coluna === celulaAlvo.coluna,
    ) ?? null
  );
}

// Jogador projetado para a resolução do Ataque (a camada da Partida mapeia o
// roster com o acesso defensivo dos campos novos).
export interface JogadorAlvoDoAtaque {
  readonly jogadorId: string;
  readonly peaoId: string;
  readonly protegido: boolean;
}

// Um Monstro que disparou no gatilho, com os peões dentro do Alcance ATUAL —
// inclusive os de Jogadores protegidos (o ataque contra eles é negado, não
// deixa de existir).
export interface AtacanteDoAlcance {
  readonly pecaId: string;
  readonly tipo: TipoDePecaDeMonstro;
  readonly peoesNoAlcance: readonly string[];
}

// Estado resultante das penalidades (issue #173) para um Jogador atingido
// cujo roster mudou no gatilho: Baixa Iluminação (Vulto), sanidade drenada
// com piso 0 e Amedrontado (Espectro). Jogador imune (já Amedrontado) e
// Jogador protegido NÃO entram — seu estado não mudou.
export interface EstadoResultanteDoAtaque {
  readonly jogadorId: string;
  readonly emBaixaIluminacao: boolean;
  readonly sanidade: number;
  readonly amedrontado: boolean;
}

// Ataque (issue #172): emitido nos gatilhos definitivos da Partida quando ao
// menos um Monstro dispara — mesmo que ninguém seja atingido (saída do
// alcance com zero restantes). atacantes: apenas os Monstros com delta; os
// peoesAtingidos são os finais (pós-Proteção); protegidos: os Jogadores cuja
// Proteção foi consumida nesta resolução. estadosAplicados (issue #173):
// estado resultante das penalidades por Jogador mudado — vazio aqui (a
// aplicação das penalidades é da camada da Partida, issue #170, que anexa
// os estados resultantes ao emitir o evento no lote).
export interface AtaqueResolvidoEvento {
  readonly tipo: 'ataque_resolvido';
  readonly atacantes: readonly AtacanteDoAlcance[];
  readonly peoesAtingidos: readonly string[];
  readonly protegidos: readonly string[];
  readonly estadosAplicados: readonly EstadoResultanteDoAtaque[];
}

export interface ResolucaoDeAtaques {
  // Evento do gatilho; null quando nenhum Monstro disparou (nenhum delta).
  readonly evento: AtaqueResolvidoEvento | null;
  // Snapshot novo: para cada Monstro posicionado, os peões dentro do Alcance
  // atual — base do delta do próximo gatilho. Monstros removidos (pela
  // Limpeza) não entram: a entrada é podada.
  readonly peoesNoAlcance: Readonly<Record<string, readonly string[]>>;
  // jogadorIds que consumiram a Proteção (ordem do roster).
  readonly protegidosConsumidos: readonly string[];
}

// Resolução do Ataque (issue #172): pura e determinística. Para cada Monstro
// posicionado, compara o conjunto de peões dentro do Alcance ATUAL com o
// snapshot anterior (ausência ≡ conjunto vazio) — conjunto diferente ⇒ o
// Monstro ataca, atingindo todos os peões dentro do Alcance atual; quem saiu
// não é atingido. A Proteção de um Jogador no alcance dos atacantes nega
// TODOS os ataques simultâneos contra ele e é consumida UMA única vez; a
// Proteção de Jogador fora do alcance dos atacantes não é consumida.
export function resolverAtaques(
  tabuleiro: EstadoDoTabuleiro,
  peoesNoAlcanceAnterior: Readonly<Record<string, readonly string[]>>,
  jogadores: readonly JogadorAlvoDoAtaque[],
): ResolucaoDeAtaques {
  const monstros = tabuleiro.posicionadas.filter(ehPecaDeMonstroPosicionada);
  const atuaisPorMonstro = new Map<string, readonly string[]>();
  const peoesNoAlcance: Record<string, readonly string[]> = {};
  for (const monstro of monstros) {
    const celulasDoAlcance = new Set(
      calcularAlcance(tabuleiro, monstro.pecaId).map((peca) => peca.pecaId),
    );
    // Peões na ordem canônica do roster do Tabuleiro, sem duplicatas (um
    // Peão ocupa no máximo uma Peça).
    const atuais = tabuleiro.peoes
      .filter((peao) => peao.pecaId !== null && celulasDoAlcance.has(peao.pecaId))
      .map((peao) => peao.peaoId);
    atuaisPorMonstro.set(monstro.pecaId, atuais);
    peoesNoAlcance[monstro.pecaId] = atuais;
  }

  // Delta: Monstro com conjunto atual diferente do snapshot anterior ataca —
  // mesmo que o conjunto atual fique vazio (saída dispara "mesmo que
  // ninguém"). Ordem de posicionadas, determinística.
  const atacantes: AtacanteDoAlcance[] = [];
  for (const monstro of monstros) {
    const atuais = atuaisPorMonstro.get(monstro.pecaId) ?? [];
    const anteriores = peoesNoAlcanceAnterior[monstro.pecaId] ?? [];
    if (!mesmoConjunto(anteriores, atuais)) {
      atacantes.push({
        pecaId: monstro.pecaId,
        tipo: monstro.tipo,
        peoesNoAlcance: atuais,
      });
    }
  }
  if (atacantes.length === 0) {
    return { evento: null, peoesNoAlcance, protegidosConsumidos: [] };
  }

  // Alvos: união dos peões no Alcance dos atacantes. A Proteção consome UMA
  // única vez e nega todos os ataques simultâneos contra o mesmo Jogador —
  // Jogador sem peão no alcance dos atacantes não consome.
  const alvos = new Set(
    atacantes.flatMap((atacante) => atacante.peoesNoAlcance),
  );
  const protegidosConsumidos: string[] = [];
  const peoesProtegidos = new Set<string>();
  for (const jogador of jogadores) {
    if (jogador.protegido && alvos.has(jogador.peaoId)) {
      protegidosConsumidos.push(jogador.jogadorId);
      peoesProtegidos.add(jogador.peaoId);
    }
  }
  const peoesAtingidos = tabuleiro.peoes
    .filter(
      (peao) => alvos.has(peao.peaoId) && !peoesProtegidos.has(peao.peaoId),
    )
    .map((peao) => peao.peaoId);

  return {
    evento: {
      tipo: 'ataque_resolvido',
      atacantes,
      peoesAtingidos,
      protegidos: protegidosConsumidos,
      // Preenchido pela camada da Partida (issue #173): a resolução pura não
      // conhece sanidade/estados do roster — apenas quem foi atingido.
      estadosAplicados: [],
    },
    peoesNoAlcance,
    protegidosConsumidos,
  };
}

// Comparação de conjuntos (ordem irrelevante, sem duplicatas na prática).
function mesmoConjunto(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const conjunto = new Set(a);
  return b.every((item) => conjunto.has(item));
}
