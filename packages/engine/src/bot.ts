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
//   (b) Recebimento pendente → escolher a vaga / encaixar a Recebida (em
//       Baixa Iluminação, apenas vagas em células escuras — #341);
//   (c) Primeiro Turno → selecionar/posicionar a Inicial, selecionar o Peão,
//       posicionar o Peão e, sem pendências, encerrar;
//   (d) turno normal sem Confirmação → selecionar o Peão, mover, permanecer
//       ou confirmar a posição (quando houve mudança de peça);
//   (e) posição confirmada (e sem pendências) → encerrar o turno.
//
// A confirmação em (d) — confirmar_posicao_do_peao quando o Peão saiu da Peça
// do início do turno — é exigência estrutural da engine (o Encerramento do
// Turno normal a requer e a Permanência só vale sobre a Peça de início); sem
// ela o loop jamais alcançaria o encerrar_turno nos turnos normais.
//
// Fora do escopo deliberado: girar_peca/finalizar_manipulacao (janela
// opcional de Manipulação — o bot encaixa na orientação sorteada),
// atravessar_o_escuro (jogada opcional de Baixa Iluminação — o bot em Baixa
// usa a movimentação normal; a pendência da Travessia, com célula travada,
// segue enumerada em (b)) e desselecionar_peao (sem efeito útil no turno).

import {
  ehPecaDeMonstro,
  tetoDoPortao,
  vagasDisponiveis,
  vizinhasConectadas,
  type Celula,
  type CorDoPeao,
  type PecaPosicionada,
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
export const MAX_ACOES_POR_TURNO_DO_BOT = 10;

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
  // Baixa Iluminação (#341): a engine rejeita vaga em célula iluminada
  // (DADOS_INVALIDOS) e a camada Tabuleiro não conhece iluminação — o filtro
  // vive aqui, na FSM, para a enumeração espelhar exatamente o que a engine
  // aceita. Sem vaga escura, a pendência comum não é enumerável e o turno
  // desdobra em desistência honesta pelo failsafe. A pendência da Travessia
  // (celulaAlvo fixado) não passa pelo filtro: a engine valida só o match da
  // célula travada, escura por construção.
  if (tabuleiro.recebidas.length > 0) {
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
    for (const recebida of tabuleiro.recebidas) {
      if (recebida.vaga === null) {
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
      if (recebida.celulaAlvo !== null) {
        // Encaixe só conectado (issue #311): sem conexão, NÃO age — a
        // selecionada com vaga já teve prioridade absoluta acima, então
        // recebida não selecionada desconectada é inalcançável no fluxo do
        // próprio bot.
        if (conectaNaVaga(recebida.tipo, recebida.orientacao, recebida.vaga)) {
          acoes.push({
            tipo: 'posicionar_peca',
            pecaId: recebida.pecaId,
            celula: recebida.celulaAlvo,
          });
        }
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

  // (d) Turno normal sem confirmação: selecionar, mover, permanecer ou
  // confirmar — conforme a posição do Peão.
  const peao = tabuleiro.peoes.find(
    (item) => item.peaoId === jogador.peaoId,
  );
  if (!peao || peao.pecaId === null) {
    return [];
  }
  if (tabuleiro.peaoSelecionadoId !== jogador.peaoId) {
    return [{ tipo: 'selecionar_peao', peaoId: jogador.peaoId }];
  }
  const origem = tabuleiro.posicionadas.find(
    (peca) => peca.pecaId === peao.pecaId,
  );
  if (!origem) {
    return [];
  }
  const acoes: ComandoDePartida[] = [];
  for (const vizinha of vizinhasConectadas(tabuleiro, origem.pecaId)) {
    // Monstros nunca aceitam peão; a engine rejeitaria.
    if (ehPecaDeMonstro(vizinha.tipo)) {
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
  const sobreAPecaDoInicio = peao.pecaId === estado.pecaDoInicioDoTurnoId;
  if (sobreAPecaDoInicio) {
    // A Permanência vale só sobre a Peça do início do turno — e nunca sob o
    // período de graça do Resgate (a engine rejeitaria).
    const emGraca = (estado.pecasEmPeriodoDeGraca ?? []).includes(
      peao.pecaId,
    );
    if (!emGraca) {
      acoes.push({ tipo: 'permanecer', peaoId: jogador.peaoId });
    }
    return acoes;
  }
  // Fora da Peça de início, terminar na peça atual exige a Confirmação de
  // Posição (a Permanência seria ENCERRAMENTO_INVALIDO).
  acoes.push({ tipo: 'confirmar_posicao_do_peao', peaoId: jogador.peaoId });
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
    const resultado = aplicarComandoDePartida(estado, comando, jogadorId);
    if (!resultado.sucesso) {
      if (resultado.erro.codigo === 'FORA_DA_VEZ') {
        return { estado, acoesExecutadas, motivo: 'fora_da_vez' };
      }
      // Defesa: a enumeração deveria ser exata — rejeição inesperada vira
      // desistência em vez de girar em falso.
      return {
        estado,
        acoesExecutadas,
        motivo: 'desistencia',
        codigoDaDesistencia: resultado.erro.codigo,
      };
    }
    estado = resultado.estado;
    acoesExecutadas.push(comando);
    // Fim de turno próprio: o encerrar_turno e a permanência (que encerra o
    // turno direto) emitem turno_encerrado no lote. O término da partida tem
    // prioridade, como no funil do dispatch.
    if (estado.resultado !== null) {
      return { estado, acoesExecutadas, motivo: 'resultado' };
    }
    if (resultado.eventos.some((evento) => evento.tipo === 'turno_encerrado')) {
      return { estado, acoesExecutadas, motivo: 'encerramento' };
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
