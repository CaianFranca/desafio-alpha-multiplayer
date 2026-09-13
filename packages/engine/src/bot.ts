// Bot Random Walk — controlador de turno puramente aleatório.
//
// Módulo puro (sem I/O) do turno do bot: mapeia a identidade do bot
// (botId → peão/cor), consulta a FSM da Partida para enumerar SOMENTE as
// ações da subfase vigente — sem pular etapas — e sorteia uniformemente via
// Math.random(), sem heurística nem árvore de decisão.
//
// Integridade transacional: toda ação usa exclusivamente o jogadorId do bot
// como ator — é estritamente proibido despachar em nome de outros playerIds
// (a guarda é estrutural: o ator nunca viaja dentro do comando, só no
// dispatch). O loop puro executarTurnoDoBot aplica cada sorteio via
// aplicarComandoDePartida e termina em encerrar_turno executado, resultado
// ou perda da vez; o failsafe (MAX_ACOES_POR_TURNO_DO_BOT) força o
// encerrar_turno e, se a engine o rejeitar, desiste do turno sem contorno.
//
// Precedência das subfases em acoesValidasDaSubfase:
//   (a) partida terminada ou vez de outro jogador → sem ações;
//   (b) Recebimento pendente → escolher a vaga / encaixar a Recebida, em fluxo
//       serial (enquanto uma Recebida aguarda o encaixe, não se escolhe a vaga
//       de outra — o encaixe da pendente vem primeiro, preservando
//       pecaSelecionadaId == pecaId para o giro; em Baixa Iluminação, apenas
//       vagas em células escuras — #341);
//   (c) Primeiro Turno → selecionar/posicionar a Inicial, selecionar o Peão,
//       posicionar o Peão e, sem pendências, encerrar;
//   (d) turno normal sem Confirmação → selecionar o Peão e, sobre a Peça do
//       início, mover (uma vez), atravessar o Escuro (em Baixa, uma vez por
//       turno — ADR-0014 / issue #377, Opção B) ou permanecer; fora dela, só
//       confirmar a posição — o bot nunca encadeia 2 movers no mesmo turno;
//       após atravessar, o mover é compulsório (sem nova travessia nem
//       permanência — a engine rejeitaria);
//   (e) posição confirmada (e sem pendências) → encerrar o turno.
//
// Randomização da orientação: todo posicionar_peca sorteado passa por
// expandirPosicionamentoDoBot, que sorteia um rótulo de giro (manter, 1x
// horário, 1x anti-horário, 2x horário, 2x anti-horário) dentre os que geram
// conexão com a peça geradora — e emite os girar_peca correspondentes antes
// do encaixe. A Inicial (sem geradora) sorteia entre os 5 rótulos sem filtro.
// Peças simétricas (cruz, especiais e monstros — 4 bordas abertas) dispensam
// o giro: qualquer orientação conecta e o giro seria no-op visual.
//
// A confirmação em (d) — confirmar_posicao_do_peao quando o Peão saiu da Peça
// do início do turno — é exigência estrutural da engine (o Encerramento do
// Turno normal a requer e a Permanência só vale sobre a Peça de início); sem
// ela o loop jamais alcançaria o encerrar_turno nos turnos normais.
//
// Fora do escopo deliberado: finalizar_manipulacao (janela de Manipulação
// pós-encaixe — o bot não manipula após posicionar) e desselecionar_peao
// (sem efeito útil no turno). O girar_peca pré-encaixe FAZ parte do plano,
// via expandirPosicionamentoDoBot, e o atravessar_o_escuro FAZ parte do plano
// em Baixa (Opção B da ADR-0014 — ramo (d) abaixo). A pendência da Travessia
// (Baixa, com célula travada) segue enumerada em (b).

import {
  bordasAbertas,
  calcularIluminacao,
  celulaVizinhaNaBorda,
  ehPecaDeMonstro,
  ehPecaEspecial,
  tetoDoPortao,
  vagasDisponiveis,
  vizinhasConectadas,
  type BordaCardinal,
  type Celula,
  type CorDoPeao,
  type Orientacao,
  type PecaPosicionada,
  type SentidoDeRotacao,
  type TipoDaPeca,
} from './tabuleiro.ts';
import { conectaNaVaga } from './peoes.ts';
import {
  aplicarComandoDePartida,
  type ComandoDePartida,
  type EstadoDaPartida,
} from './partida.ts';

// Failsafe contra loop infinito: teto de ações sorteadas por turno. Ao
// atingi-lo, o loop tenta UMA vez o encerrar_turno forçado e, se a engine o
// rejeitar (ex.: PENDENCIA_NAO_RESOLVIDA), desiste do turno sem contorno.
// Teto em 20 para acomodar o pior caso de um turno de movimento único:
// selecionar + mover + confirmar + até 4 recebidas × (escolher + encaixar)
// + encerrar, com folga.
export const MAX_ACOES_POR_TURNO_DO_BOT = 20;

export interface IdentidadeDoBot {
  readonly jogadorId: string;
  readonly cor: CorDoPeao;
  readonly peaoId: string;
  readonly ordem: number;
  readonly primeiroTurnoPendente: boolean;
}

// Mapeia o botId ao Peão/cor da partida. Lança quando o jogador não pertence
// ao roster — falhar alto aqui impede agir por identidade estranha.
export function mapearBot(
  estado: EstadoDaPartida,
  jogadorId: string,
): IdentidadeDoBot {
  const jogador = estado.jogadores.find(
    (item) => item.jogadorId === jogadorId,
  );
  if (!jogador) {
    throw new Error(
      `O jogador ${jogadorId} não pertence a esta partida.`,
    );
  }
  return {
    jogadorId: jogador.jogadorId,
    cor: jogador.cor,
    peaoId: jogador.peaoId,
    ordem: jogador.ordem,
    primeiroTurnoPendente: jogador.primeiroTurnoPendente,
  };
}

// Sorteio uniforme sobre as ações válidas, via Math.random() —
// Math.floor(Math.random() * acoes.length). Lança sobre lista vazia: sortear
// sem opção válida é erro de chamada, nunca silêncio.
export function sortearAcao<T>(acoes: readonly T[]): T {
  if (acoes.length === 0) {
    throw new Error('Não há ações válidas para sortear.');
  }
  const indice = Math.floor(Math.random() * acoes.length);
  const sorteada = acoes[indice];
  if (sorteada === undefined) {
    throw new Error('O sorteio caiu fora da lista de ações válidas.');
  }
  return sorteada;
}

// --- Randomização da orientação do bot --------------------------------------
//
// O bot encaixa cada peça numa orientação sorteada entre 5 rótulos — manter,
// 1x horário, 1x anti-horário, 2x horário, 2x anti-horário (os dois últimos
// colapsam em 180°, dando peso duplo a essa orientação) — filtrados aos que
// geram conexão com a peça geradora da vaga.

const ORIENTACOES_CANDIDATAS: readonly Orientacao[] = [0, 90, 180, 270];

const BORDA_OPOSTA_DO_BOT: Record<BordaCardinal, BordaCardinal> = {
  norte: 'sul',
  sul: 'norte',
  leste: 'oeste',
  oeste: 'leste',
};

export type RotuloDeGiroDoBot =
  | 'manter'
  | 'horario_1x'
  | 'anti_horario_1x'
  | 'horario_2x'
  | 'anti_horario_2x';

const ROTULOS_DE_GIRO_DO_BOT: readonly {
  readonly rotulo: RotuloDeGiroDoBot;
  readonly passosHorarios: 0 | 1 | 2 | 3;
  readonly giros: readonly SentidoDeRotacao[];
}[] = [
  { rotulo: 'manter', passosHorarios: 0, giros: [] },
  { rotulo: 'horario_1x', passosHorarios: 1, giros: ['horario'] },
  { rotulo: 'anti_horario_1x', passosHorarios: 3, giros: ['anti_horario'] },
  { rotulo: 'horario_2x', passosHorarios: 2, giros: ['horario', 'horario'] },
  {
    rotulo: 'anti_horario_2x',
    passosHorarios: 2,
    giros: ['anti_horario', 'anti_horario'],
  },
];

// A nova peça conecta com a geradora quando tem aberta a borda voltada para
// ela (a oposta da vaga — a geradora tem a vaga aberta por definição de
// vagasDisponiveis).
export function orientacaoConectaComGeradora(
  tipo: TipoDaPeca,
  orientacao: Orientacao,
  vaga: BordaCardinal,
): boolean {
  return bordasAbertas({ tipo, orientacao }).includes(
    BORDA_OPOSTA_DO_BOT[vaga],
  );
}

// Peças de 4 bordas abertas em qualquer orientação: o giro é no-op visual e
// toda orientação conecta — o bot poupa as ações de giro.
function ehPecaSimetrica(tipo: TipoDaPeca): boolean {
  return (
    tipo === 'cruz' || ehPecaEspecial(tipo) || ehPecaDeMonstro(tipo)
  );
}

// Conexões totais simuladas da peça numa célula (geradora + vizinhos
// laterais já posicionados): fallback quando nenhuma das 4 orientações
// conecta com a geradora — fica com as de maior contagem.
export function contarConexoesTotaisDoBot(
  posicionadas: readonly PecaPosicionada[],
  tipo: TipoDaPeca,
  orientacao: Orientacao,
  celula: Celula,
): number {
  const porCelula = new Map(
    posicionadas.map((peca) => [`${peca.celula.linha},${peca.celula.coluna}`, peca]),
  );
  let total = 0;
  for (const borda of bordasAbertas({ tipo, orientacao })) {
    const vizinha = celulaVizinhaNaBorda(celula, borda);
    if (!vizinha) {
      continue;
    }
    const pecaVizinha = porCelula.get(`${vizinha.linha},${vizinha.coluna}`);
    if (
      pecaVizinha &&
      bordasAbertas(pecaVizinha).includes(BORDA_OPOSTA_DO_BOT[borda])
    ) {
      total++;
    }
  }
  return total;
}

// Expande um posicionar_peca sorteado em [0..2 girar_peca, posicionar_peca],
// com a orientação-alvo sorteada entre os rótulos que conectam com a geradora
// (Inicial: entre os 5, sem filtro). Pura: não muta nada, só calcula.
// Retorna [comando] intacto quando não há o que girar — peça simétrica, peça
// fora da seleção (só a selecionada gira na engine) ou peça desconhecida.
export function expandirPosicionamentoDoBot(
  estado: EstadoDaPartida,
  comando: {
    readonly tipo: 'posicionar_peca';
    readonly pecaId: string;
    readonly celula: Celula;
  },
  sortear: <T>(acoes: readonly T[]) => T = sortearAcao,
): ComandoDePartida[] {
  const tabuleiro = estado.tabuleiro;
  if (tabuleiro.pecaSelecionadaId !== comando.pecaId) {
    return [comando];
  }
  const recebida = tabuleiro.recebidas.find(
    (item) => item.pecaId === comando.pecaId,
  );
  const inicial = recebida
    ? undefined
    : tabuleiro.iniciais.find((peca) => peca.pecaId === comando.pecaId);
  if (!recebida && !inicial) {
    return [comando];
  }
  const tipo = recebida ? recebida.tipo : inicial!.tipo;
  const atual = recebida ? recebida.orientacao : inicial!.orientacao;
  if (ehPecaSimetrica(tipo)) {
    return [comando];
  }
  let validas: Orientacao[];
  if (recebida) {
    if (recebida.vaga === null) {
      return [comando];
    }
    validas = ORIENTACOES_CANDIDATAS.filter((orientacao) =>
      orientacaoConectaComGeradora(tipo, orientacao, recebida.vaga!),
    );
    if (validas.length === 0) {
      const alvo = recebida.celulaAlvo ?? comando.celula;
      let melhor = -1;
      let candidatas: Orientacao[] = [];
      for (const orientacao of ORIENTACOES_CANDIDATAS) {
        const total = contarConexoesTotaisDoBot(
          tabuleiro.posicionadas,
          tipo,
          orientacao,
          alvo,
        );
        if (total > melhor) {
          melhor = total;
          candidatas = [orientacao];
        } else if (total === melhor) {
          candidatas.push(orientacao);
        }
      }
      validas = candidatas;
    }
  } else {
    validas = [...ORIENTACOES_CANDIDATAS];
  }
  const rotulosValidos = ROTULOS_DE_GIRO_DO_BOT.filter((rotulo) =>
    validas.includes(((atual + rotulo.passosHorarios * 90) % 360) as Orientacao),
  );
  if (rotulosValidos.length === 0) {
    return [comando];
  }
  const escolhido = sortear(rotulosValidos);
  return [
    ...escolhido.giros.map(
      (sentido) =>
        ({ tipo: 'girar_peca', pecaId: comando.pecaId, sentido }) as const,
    ),
    comando,
  ];
}

// Enumera EXATAMENTE as ações da subfase vigente do bot — nada da subfase
// anterior ou seguinte, nada em nome de outro jogador. Cada comando emitido
// carrega, quando houver campo de peão, exclusivamente o peaoId do bot.
export function acoesValidasDaSubfase(
  estado: EstadoDaPartida,
  jogadorId: string,
): ComandoDePartida[] {
  const jogador = estado.jogadores.find(
    (item) => item.jogadorId === jogadorId,
  );
  if (!jogador) {
    throw new Error(
      `O jogador ${jogadorId} não pertence a esta partida.`,
    );
  }
  // (a) Partida terminada ou vez de outro jogador: o bot não age.
  if (estado.resultado !== null) {
    return [];
  }
  if (jogadorId !== estado.jogadorAtivoId) {
    return [];
  }
  // Sem guarda de Amedrontado aqui, por decisão: a engine não veta ações do
  // Amedrontado (o pulo do turno vive só no avanço da vez) — e o bot pode se
  // tornar Amedrontado NO MEIO do próprio turno (ataque no confirmar), com
  // Recebimento pendente. Vetar aí strandaria o turno (o encerrar forçado
  // cairia em PENDENCIA_NAO_RESOLVIDA); resolver e encerrar conclui o turno e
  // o avanço pula quem estiver Amedrontado.
  const tabuleiro = estado.tabuleiro;

  // (b) Recebimento pendente tem precedência sobre qualquer sequência: cada
  // peça sorteada exige a escolha da vaga e o encaixe, sem pular. O planejador
  // emite as ações direto, mesmo sem Peão selecionado — o engine pré-adopta a
  // seleção do ator quando nula (review #333), e `pecaSobOPeaoDoJogador`
  // referencia o Peão do próprio jogador, não a Seleção.
  //
  // Sequencialidade por encaixe com anti-softlock (#311, #260, #349; grade
  // toroidal: ADR-0012): a escolha de vaga é sequencial POR encaixe — o guard
  // canônico da engine (peoes.ts) rejeita a escolha de vaga de uma pendência
  // enquanto outra Recebida tem vaga escolhida e ainda não encaixada
  // (PENDENCIA_NAO_RESOLVIDA). A FSM espelha o guard: com Recebida fixada,
  // enumera APENAS as ações sobre ela — sem isso, turnos com 2+ pendências, a
  // regra comum na grade toroidal, sorteavam a rejeição certa.
  //
  // Exatidão literal (review #350): a engine aceita escolher vaga morta — a
  // conexão só é validada no encaixe (MOVIMENTO_NAO_CONECTADO, peoes.ts) — e
  // o ramo da fixada recupera a vaga morta girando até a borda voltada à Peça
  // geradora abrir. A enumeração lista TODAS as vagas elegíveis da pendência,
  // conectantes ou mortas: filtrar um subconjunto de ações aceitas violaria a
  // exatidão (diferente do filtro de Baixa abaixo, que remove rejeições
  // certas). O tradeoff é aceito: o bot pode fixar vaga morta tendo
  // conectante disponível — custa ≤ 1 giro (reta: 2 de 4 orientações
  // conectam; T: 3 de 4; cruz/especial/monstro: sempre — não existe peça
  // "curva", TipoDePecaDeCaminho em tabuleiro.ts), dentro do teto do
  // failsafe.
  //
  // Baixa Iluminação (#341): a engine rejeita vaga em célula iluminada
  // (DADOS_INVALIDOS) e a camada Tabuleiro não conhece iluminação — o filtro
  // vive aqui, na FSM, para a enumeração espelhar exatamente o que a engine
  // aceita. Sem vaga escura, a pendência comum não é enumerável e o turno
  // desdobra em desistência honesta pelo failsafe (limitação pré-existente da
  // engine para humanos e bots, documentada no teste da #341).
  if (tabuleiro.recebidas.length > 0) {
    const fixada = tabuleiro.recebidas.find((item) => item.vaga !== null);
    if (fixada) {
      const vagaFixada = fixada.vaga;
      const alvoFixado = fixada.celulaAlvo;
      if (
        vagaFixada !== null &&
        alvoFixado !== null &&
        conectaNaVaga(fixada.tipo, fixada.orientacao, vagaFixada)
      ) {
        // Encaixe conectado: a borda voltada à Peça geradora — o oposto
        // da vaga — está aberta na orientação vigente, então a engine aceita.
        return [
          { tipo: 'posicionar_peca', pecaId: fixada.pecaId, celula: alvoFixado },
        ];
      }
      // Vaga morta (ou alvo nulo defensivo): recuperação por girar_peca sobre
      // a Recebida fixada. O girar da engine exige a peça selecionada
      // (PECA_NAO_SELECIONADA, tabuleiro.ts): guard defensivo — a divergência
      // é inalcançável por comandos válidos (a escolha da vaga fixa o
      // pecaSelecionadaId na Recebida — seleção da camada engine, peoes.ts,
      // não termo de domínio — e a desseleção é rejeitada com Recebidas
      // pendentes), mas divergindo o ramo não enumera nada ([] honesto,
      // inalcançável — o failsafe desiste sem girar em falso). Teste
      // artesanal em bot.test.ts prova a divergência.
      if (tabuleiro.pecaSelecionadaId !== fixada.pecaId) {
        return [];
      }
      // girarRecebida aceita o giro livremente, sem validar conexão. Cada
      // sentido é uma ação; em ≤ 1 giro a borda abre (reta: 2 de 4
      // orientações conectam; T: 3 de 4; cruz/especial/monstro: sempre).
      return [
        { tipo: 'girar_peca', pecaId: fixada.pecaId, sentido: 'horario' },
        { tipo: 'girar_peca', pecaId: fixada.pecaId, sentido: 'anti_horario' },
      ];
    }
    const emBaixa = jogador.emBaixaIluminacao ?? false;
    const iluminadas = emBaixa
      ? new Set(
          estado.celulasIluminadas.map(
            (celula) => `${celula.linha},${celula.coluna}`,
          ),
        )
      : null;
    const pecaSobOPeao = pecaSobOPeaoDoJogador(estado, jogador.peaoId);
    const acoes: ComandoDePartida[] = [];
    // Fluxo serial — anti-softlock (issue #311): enquanto uma Recebida aguarda
    // o encaixe (vaga + alvo fixados), a engine rejeita nova escolha de vaga
    // com PENDENCIA_NAO_RESOLVIDA, então o bot resolve o encaixe antes de
    // escolher outra vaga — assim o giro da expansão sempre encontra
    // pecaSelecionadaId == pecaId. Sem isso, turnos com 2+ pendências (a regra
    // na grade toroidal, issue #260) sorteavam a rejeição certa.
    // (Pendência travada da Travessia, com alvo mas sem vaga, nunca bloqueia
    // as demais: ela própria ainda precisa da escolha.)
    const haEncaixePendente = tabuleiro.recebidas.some(
      (item) => item.vaga !== null && item.celulaAlvo !== null,
    );
    for (const recebida of tabuleiro.recebidas) {
      if (recebida.vaga === null) {
        if (recebida.celulaAlvo === null && haEncaixePendente) {
          continue;
        }
        if (pecaSobOPeao === undefined) {
          continue;
        }
        const vagas = vagasDisponiveis(
          tabuleiro,
          pecaSobOPeao,
          tabuleiro.recebidas,
        );
        if (recebida.celulaAlvo !== null) {
          // Pendência travada (Travessia do Escuro): só a borda que mapeia à
          // célula travada é aceita pela engine.
          const travada = vagas.find((vaga) =>
            mesmaCelula(vaga.celula, recebida.celulaAlvo),
          );
          if (travada !== undefined) {
            acoes.push({
              tipo: 'escolher_vaga_da_peca_recebida',
              recebidaId: recebida.recebidaId,
              borda: travada.borda,
            });
          }
          continue;
        }
        for (const vaga of vagas) {
          // Em Baixa, vaga iluminada é rejeição certa (DADOS_INVALIDOS):
          // enumera apenas as vagas escuras restantes.
          if (
            iluminadas !== null &&
            iluminadas.has(`${vaga.celula.linha},${vaga.celula.coluna}`)
          ) {
            continue;
          }
          acoes.push({
            tipo: 'escolher_vaga_da_peca_recebida',
            recebidaId: recebida.recebidaId,
            borda: vaga.borda,
          });
        }
        continue;
      }
    }
    return acoes;
  }

  // (c) Primeiro Turno: a própria Peça Inicial e o próprio Peão, em ordem.
  if (jogador.primeiroTurnoPendente) {
    const pecaInicialId = `inicial-${jogador.ordem}`;
    const inicialPosicionada = tabuleiro.posicionadas.find(
      (peca) => peca.pecaId === pecaInicialId,
    );
    if (!inicialPosicionada) {
      if (tabuleiro.pecaSelecionadaId !== pecaInicialId) {
        return [{ tipo: 'selecionar_peca', pecaId: pecaInicialId }];
      }
      // A Inicial encaixa em qualquer célula livre da grade.
      const ocupadas = new Set(
        tabuleiro.posicionadas.map(
          (peca) => `${peca.celula.linha},${peca.celula.coluna}`,
        ),
      );
      const acoes: ComandoDePartida[] = [];
      for (let linha = 0; linha < 7; linha++) {
        for (let coluna = 0; coluna < 7; coluna++) {
          if (!ocupadas.has(`${linha},${coluna}`)) {
            acoes.push({
              tipo: 'posicionar_peca',
              pecaId: pecaInicialId,
              celula: { linha, coluna },
            });
          }
        }
      }
      return acoes;
    }
    const peao = tabuleiro.peoes.find(
      (item) => item.peaoId === jogador.peaoId,
    );
    if (!peao || peao.pecaId === null) {
      if (tabuleiro.peaoSelecionadoId !== jogador.peaoId) {
        return [{ tipo: 'selecionar_peao', peaoId: jogador.peaoId }];
      }
      // O primeiro posicionamento é sempre sobre a própria Inicial.
      return [
        {
          tipo: 'posicionar_peao',
          peaoId: jogador.peaoId,
          celula: inicialPosicionada.celula,
        },
      ];
    }
    // Peão posicionado e sem pendências: encerra o Primeiro Turno.
    return [{ tipo: 'encerrar_turno' }];
  }

  // (e) Posição confirmada (e sem pendências, pela precedência de (b)):
  // resta apenas encerrar o turno.
  if (estado.posicaoConfirmada) {
    return [{ tipo: 'encerrar_turno' }];
  }

  // (d) Turno normal sem confirmação: selecionar, mover UMA vez ou
  // permanecer — conforme a posição do Peão. Fora da Peça do início o bot
  // já andou: só confirma (nunca encadeia outro mover, que causava o
  // vai-e-vem até o failsafe desistir e strandar a partida).
  const peao = tabuleiro.peoes.find(
    (item) => item.peaoId === jogador.peaoId,
  );
  if (!peao || peao.pecaId === null) {
    return [];
  }
  if (tabuleiro.peaoSelecionadoId !== jogador.peaoId) {
    return [{ tipo: 'selecionar_peao', peaoId: jogador.peaoId }];
  }
  const sobreAPecaDoInicio = peao.pecaId === estado.pecaDoInicioDoTurnoId;
  if (!sobreAPecaDoInicio) {
    // Fora da Peça de início, terminar na peça atual exige a Confirmação de
    // Posição (a Permanência seria ENCERRAMENTO_INVALIDO e outro mover
    // seria o segundo passo do turno — proibido para o bot).
    return [{ tipo: 'confirmar_posicao_do_peao', peaoId: jogador.peaoId }];
  }
  const origem = tabuleiro.posicionadas.find(
    (peca) => peca.pecaId === peao.pecaId,
  );
  if (!origem) {
    return [];
  }
  const acoes: ComandoDePartida[] = [];
  // ADR-0014 / issue #377: mover pós-travessia é compulsório PARA a peça
  // colocada — a FSM espelha a guarda da engine (só ela é enumerada; as
  // demais seriam rejeitadas com MOVIMENTO_INDISPONIVEL).
  const pecaDaTravessiaId = estado.pecaDaTravessiaId ?? null;
  const moverSoParaTravessia =
    (estado.atravessouNoTurno ?? false) && pecaDaTravessiaId !== null;
  for (const vizinha of vizinhasConectadas(tabuleiro, origem.pecaId)) {
    // Monstros nunca aceitam peão; a engine rejeitaria.
    if (ehPecaDeMonstro(vizinha.tipo)) {
      continue;
    }
    if (moverSoParaTravessia && vizinha.pecaId !== pecaDaTravessiaId) {
      continue;
    }
    const ocupantes = tabuleiro.peoes.filter(
      (item) => item.pecaId === vizinha.pecaId,
    ).length;
    if (ocupantes >= tetoDeOcupacao(estado, vizinha, jogadorId)) {
      continue;
    }
    acoes.push({
      tipo: 'mover_peao',
      peaoId: jogador.peaoId,
      celula: vizinha.celula,
    });
  }
  const emBaixa = jogador.emBaixaIluminacao ?? false;
  const jaAtravessou = estado.atravessouNoTurno ?? false;
  // ADR-0014 / issue #377 (Opção B): em Baixa, o bot pode atravessar o Escuro —
  // uma ação por vaga escura conectada (borda aberta com célula vizinha vazia
  // e não-iluminada). A iluminação é a fresca unificada com a engine
  // (calcularIluminacao sobre os peões em Baixa, mesmo preamble de
  // atravessarOEscuroDaPartida), então a enumeração é exata. Após atravessar,
  // o mover é compulsório: sem nova travessia e sem permanência (a engine
  // rejeitaria ambas — MOVIMENTO_INDISPONIVEL).
  if (emBaixa && !jaAtravessou) {
    const iluminadasFrescas = new Set(
      calcularIluminacao(
        tabuleiro,
        estado.jogadores
          .filter((j) => (j.emBaixaIluminacao ?? false))
          .map((j) => j.peaoId),
      ).map((celula) => `${celula.linha},${celula.coluna}`),
    );
    for (const vaga of vagasDisponiveis(tabuleiro, origem, tabuleiro.recebidas)) {
      if (
        iluminadasFrescas.has(`${vaga.celula.linha},${vaga.celula.coluna}`)
      ) {
        continue;
      }
      acoes.push({
        tipo: 'atravessar_o_escuro',
        peaoId: jogador.peaoId,
        celula: vaga.celula,
      });
    }
  }
  // A Permanência vale só sobre a Peça do início do turno — e nunca sob o
  // período de graça do Resgate (a engine rejeitaria). Vale também após
  // atravessar o Escuro QUANDO a peça atravessada é Monstro: o Monstro não
  // aceita peão, o mover compulsório é impossível e o turno fechado via
  // Permanência (permanecerNaPartida reabre a via só para o monstro).
  const pecaDaTravessia = (estado.pecaDaTravessiaId ?? null)
    ? tabuleiro.posicionadas.find(
        (peca) => peca.pecaId === estado.pecaDaTravessiaId,
      )
    : undefined;
  const travessiaEhMonstro =
    pecaDaTravessia !== undefined && ehPecaDeMonstro(pecaDaTravessia.tipo);
  const emGraca = (estado.pecasEmPeriodoDeGraca ?? []).includes(
    peao.pecaId,
  );
  if (!emGraca && (!jaAtravessou || travessiaEhMonstro)) {
    acoes.push({ tipo: 'permanecer', peaoId: jogador.peaoId });
  }
  return acoes;
}

export type MotivoDoFimDoTurnoDoBot =
  | 'encerramento'
  | 'resultado'
  | 'fora_da_vez'
  | 'desistencia';

export interface ResultadoDoTurnoDoBot {
  readonly estado: EstadoDaPartida;
  readonly acoesExecutadas: readonly ComandoDePartida[];
  // encerramento: o encerrar_turno do bot foi aprovado e a vez avançou;
  // resultado: a partida terminou no meio do turno; fora_da_vez: a vez já não
  // era do bot; desistencia: o failsafe forçou o encerrar_turno e a engine o
  // rejeitou (codigoDaDesistencia carrega o código — sem contorno).
  readonly motivo: MotivoDoFimDoTurnoDoBot;
  readonly codigoDaDesistencia?: string;
}

export interface OpcoesDoTurnoDoBot {
  readonly maxActionsPerTurn?: number;
  readonly sortear?: <T>(acoes: readonly T[]) => T;
}

// Loop transacional puro do turno: consulta a FSM, sorteia, aplica via
// aplicarComandoDePartida com o jogadorId do bot como ator e repete até o
// encerramento, o término da partida ou o failsafe. Sem I/O — o driver WS
// decide como logar a desistencia (codigoDaDesistencia).
export function executarTurnoDoBot(
  estadoInicial: EstadoDaPartida,
  jogadorId: string,
  opcoes: OpcoesDoTurnoDoBot = {},
): ResultadoDoTurnoDoBot {
  const teto =
    opcoes.maxActionsPerTurn ?? MAX_ACOES_POR_TURNO_DO_BOT;
  const sortear = opcoes.sortear ?? sortearAcao;
  let estado = estadoInicial;
  const acoesExecutadas: ComandoDePartida[] = [];
  for (let passo = 0; ; passo++) {
    if (estado.resultado !== null) {
      return { estado, acoesExecutadas, motivo: 'resultado' };
    }
    if (estado.jogadorAtivoId !== jogadorId) {
      // A vez mudou sem ação nossa (ex.: pulo de Amedrontado): fora da vez.
      // Os fins de turno próprios retornam logo após a aplicação, abaixo.
      return { estado, acoesExecutadas, motivo: 'fora_da_vez' };
    }
    const validas = acoesValidasDaSubfase(estado, jogadorId);
    if (validas.length === 0 || passo >= teto) {
      const encerramentoForcado: ComandoDePartida = { tipo: 'encerrar_turno' };
      const tentativa = aplicarComandoDePartida(
        estado,
        encerramentoForcado,
        jogadorId,
      );
      if (tentativa.sucesso) {
        return {
          estado: tentativa.estado,
          acoesExecutadas: [...acoesExecutadas, encerramentoForcado],
          motivo:
            tentativa.estado.resultado !== null
              ? 'resultado'
              : 'encerramento',
        };
      }
      return {
        estado,
        acoesExecutadas,
        motivo: 'desistencia',
        codigoDaDesistencia: tentativa.erro.codigo,
      };
    }
    const comando = sortear(validas);
    // O posicionar sorteado vira a sequência de orientação + encaixe (0..2
    // girar_peca com conexão garantida + o posicionar). Cada passo é aplicado
    // e registrado como os demais — a macro é auto-curativa: se interrompida,
    // a próxima expansão recalcula a partir da orientação corrente.
    const sequencia =
      comando.tipo === 'posicionar_peca'
        ? expandirPosicionamentoDoBot(estado, comando, sortear)
        : [comando];
    let fimAntecipado: ResultadoDoTurnoDoBot | undefined;
    for (const passo of sequencia) {
      const resultado = aplicarComandoDePartida(estado, passo, jogadorId);
      if (!resultado.sucesso) {
        if (resultado.erro.codigo === 'FORA_DA_VEZ') {
          fimAntecipado = { estado, acoesExecutadas, motivo: 'fora_da_vez' };
          break;
        }
        // Defesa: a enumeração deveria ser exata — rejeição inesperada vira
        // desistência em vez de girar em falso.
        fimAntecipado = {
          estado,
          acoesExecutadas,
          motivo: 'desistencia',
          codigoDaDesistencia: resultado.erro.codigo,
        };
        break;
      }
      estado = resultado.estado;
      acoesExecutadas.push(passo);
      // Fim de turno próprio: o encerrar_turno e a permanência (que encerra o
      // turno direto) emitem turno_encerrado no lote. O término da partida tem
      // prioridade, como no funil do dispatch.
      if (estado.resultado !== null) {
        fimAntecipado = { estado, acoesExecutadas, motivo: 'resultado' };
        break;
      }
      if (
        resultado.eventos.some((evento) => evento.tipo === 'turno_encerrado')
      ) {
        fimAntecipado = { estado, acoesExecutadas, motivo: 'encerramento' };
        break;
      }
    }
    if (fimAntecipado) {
      return fimAntecipado;
    }
  }
}

// Teto de ocupação do destino (espelho de partida.ts): peça comum no máximo
// 1 (+1 com afetado pelo Resgate); Portão de Saída escala com o roster
// (tetoDoPortao) mais a mesma exceção.
function tetoDeOcupacao(
  estado: EstadoDaPartida,
  destino: PecaPosicionada,
  atorId: string,
): number {
  const temAfetado = estado.jogadores.some((jogador) => {
    if (jogador.jogadorId === atorId) {
      return false;
    }
    const peao = estado.tabuleiro.peoes.find(
      (item) => item.peaoId === jogador.peaoId,
    );
    return (
      peao?.pecaId === destino.pecaId &&
      ((jogador.emBaixaIluminacao ?? false) ||
        (jogador.amedrontado ?? jogador.sanidade === 0))
    );
  });
  if (destino.tipo !== 'portao_de_saida') {
    return temAfetado ? 2 : 1;
  }
  return tetoDoPortao(estado.jogadores.length, temAfetado);
}

function pecaSobOPeaoDoJogador(
  estado: EstadoDaPartida,
  peaoId: string,
): PecaPosicionada | undefined {
  const peao = estado.tabuleiro.peoes.find(
    (item) => item.peaoId === peaoId,
  );
  if (!peao || peao.pecaId === null) {
    return undefined;
  }
  return estado.tabuleiro.posicionadas.find(
    (peca) => peca.pecaId === peao.pecaId,
  );
}

function mesmaCelula(a: Celula | null, b: Celula | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.linha === b.linha &&
    a.coluna === b.coluna
  );
}
