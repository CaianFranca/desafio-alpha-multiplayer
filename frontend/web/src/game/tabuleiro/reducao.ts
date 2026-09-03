/**
 * Redutor puro evento→estado do Tabuleiro no cliente (issue #85).
 *
 * O game-server não reenvia o histórico de posicionamentos a quem conecta
 * depois (as 4 conexões partem juntas do `PARTIDA_DISPONIVEL`). Assim o
 * cliente parte do estado inicial determinístico — `criarReservaInicial()`
 * (mesma composição e ids de `estadoInicialDoTabuleiro()` do engine) e
 * `posicionadas: []` — e aplica cada evento do broadcast em ordem ao modelo
 * local (deltas aditivos).
 *
 * Semântica alinhada ao engine (`packages/engine/src/tabuleiro.ts`):
 *   - PECA_POSICIONADA não traz `tipo` no wire → preserva o `tipo` da Reserva
 *     ao consumir a peça (ver `traducao.ts` do game-server).
 *   - Novo posicionamento abre a janela de Manipulação (`pecaEmManipulacaoId`)
 *     e limpa a Seleção.
 *   - Nova Seleção com Manipulação em aberto emite [manipulacao_finalizada,
 *     peca_selecionada] em ordem — o broadcast preserva a ordem; a aplicação
 *     sequencial aqui reproduz esse encadeamento.
 *   - ERRO_DO_TABULEIRO chega só ao autor e não altera o estado do cliente
 *     (o flash vermelho é gerenciado pela camada de feedback, não pelo reducer).
 *
 * Ciclo do Peão (issue #91 — espelho do engine):
 *   - Peões nascem seedados (`peao-${cor}`, sobre a Mesa) e o servidor move.
 *   - Pendência de Recebimento carrega campo client-side `pecaId` (null até o
 *     TIPO) e só sai da lista no PECA_POSICIONADA (encaixe na célula-alvo).
 *   - TIPO consome a peça da Reserva (peoes.ts:367 do engine) e seleciona a
 *     Recebida (pecaSelecionadaId) até o encaixe.
 *   - PEAO_POSICIONADO re-seleciona o peão (Primeiro Turno, partida.ts:344);
 *     PEAO_MOVIDO/PEAO_PERMANECEU limpam a seleção (mover/permanecer).
 *
 * Turnos (issue #118 — espelho do ST-11):
 *   - TURNO_INICIADO seta jogadorAtivoId/rodada e reseta a fase do turno;
 *     TURNO_ENCERRADO limpa a vez (limpeza mínima; rodada e mapa preservados).
 *   - PEAO_MOVIDO dentro do turno marca movimentouNoTurno; POSICAO_CONFIRMADA
 *     marca posicaoConfirmadaNoTurno (a Permanência encerra a vez no servidor —
 *     o próximo TURNO_INICIADO governa a fase seguinte).
 *   - PEAO_POSICIONADO/PEAO_MOVIDO/PEAO_PERMANECEU atribuem o peão do evento
 *     ao Jogador Ativo no mapa peaoPorJogador (janela do turno, ver campo).
 *
 * Objetivos globais no HUD (issue #145 — espelho dos contadores do engine):
 *   - `pecasRestantesNaCaixa`: baseline do snapshot + decremento ao vivo a cada
 *     PECA_SORTEADA com pecaId inédito (mesmo gate de `pecasDeRecebimento`),
 *     clamp ≥ 0; `null` (sem snapshot) mantém a contagem oculta.
 *   - `geradoresLigados`/`cartaoDeAcessoObtido`: derivados no POSICAO_CONFIRMADA
 *     com o tipo resolvido no estado ANTERIOR (a Confirmação chega antes da
 *     Limpeza no mesmo lote) — dedupe por pecaId e monotonicidade espelhando o
 *     engine. Snapshot substitui a baseline (autoridade, sem merge).
 *   - Encaixe de Peça Especial/Monstro NÃO abre janela de Manipulação no
 *     cliente (AC1 — o engine também não abre; peoes.ts do engine).
 */

import {
  CORES_DOS_PEOES,
  abreJanelaDeManipulacao,
  chaveCelula,
  criarReservaInicial,
  type CorDoPeao,
  type EstadoExibicaoTabuleiro,
  type Orientacao,
  type PecaDaReserva,
  type PecaPosicionada,
  type PeaoDaExibicao,
  type TipoDaPeca,
} from './contrato'
import type { PendenciaNoCliente } from './interacaoPeoes'
import { ehPendenciaSorteada } from './interacaoPeoes'
import type {
  Celula,
  CelulasIluminadasWireEvento,
  LimpezaAplicadaWireEvento,
  PeaoEventoDoServidor,
  TabuleiroEventoDoServidor,
  PecaSorteadaEvento,
  VagaDaPecaRecebidaEscolhidaEvento,
  PosicaoConfirmadaEvento,
  TurnoEncerradoEvento,
  TurnoIniciadoEvento,
} from '@flicker/shared'

/**
 * Eventos que o canal da Partida entrega ao redutor: tabuleiro (ST-09),
 * peões/ciclo (ST-10), turnos (ST-11, issue #118) e iluminação/limpeza
 * (issue #151). É o tipo roteado pelo socket e aceito pelo reducer.
 */
export type EventoDoJogoNoCliente =
  | TabuleiroEventoDoServidor
  | PeaoEventoDoServidor
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento
  | CelulasIluminadasWireEvento
  | LimpezaAplicadaWireEvento
  | PecaSorteadaEvento
  | VagaDaPecaRecebidaEscolhidaEvento

/** Estado do modelo de tabuleiro mantido no cliente. */
export interface EstadoDoTabuleiroNoCliente {
  readonly reserva: readonly PecaDaReserva[]
  readonly posicionadas: readonly PecaPosicionada[]
  readonly pecaSelecionadaId: string | null
  readonly pecaEmManipulacaoId: string | null
  /** Peões com posição autoritativa do servidor (issue #91). */
  readonly peoes: readonly PeaoDaExibicao[]
  /** Recebidas aguardando escolha de tipo e encaixe (com pecaId client-side). */
  readonly recebidasPendentes: readonly PendenciaNoCliente[]
  /** Peão selecionado no ciclo (vem do servidor via PEAO_SELECIONADO). */
  readonly peaoSelecionadoId: string | null
  /** Peças cujo tipo foi definido por ESCOLHER_TIPO_DA_PECA_RECEBIDA (chave = pecaId). */
  readonly pecasDeRecebimento: Record<string, TipoDaPeca>
  /**
   * Células iluminadas espelhadas do estado compartilhado (issue #151).
   * O motor é a autoridade: o cliente apenas substitui a lista inteira a
   * cada evento CELULAS_ILUMINADAS — nunca recalcula iluminação.
   */
  readonly celulasIluminadas: readonly Celula[]
  /** Jogador Ativo da vez (TURNO_INICIADO; null entre turnos). */
  readonly jogadorAtivoId: string | null
  /** Rodada corrente (TURNO_INICIADO; rodada 1 = Primeiro Turno de todos). */
  readonly rodada: number | null
  /** O peão do Jogador Ativo já se moveu neste turno (PEAO_MOVIDO). */
  readonly movimentouNoTurno: boolean
  /** A posição do peão do Jogador Ativo já foi confirmada (POSICAO_CONFIRMADA). */
  readonly posicaoConfirmadaNoTurno: boolean
  /**
    * Mapa aprendido jogadorId→peaoId (issue #118): cada evento de peão dentro
    * da janela do turno (TURNO_INICIADO→TURNO_ENCERRADO) atribui o peão ao
    * Jogador Ativo — turnos são serializados, então o dono é o ativo. Sem
    * eventos ainda (início da rodada 1), a consulta fica indefinida e o
    * destaque/buttons degradam a null (substituído pelo snapshot #154/#156).
    */
  readonly peaoPorJogador: Readonly<Record<string, string>>
  /**
    * Dicionário jogadorId → dados de exibição (apelido/cor) derivado do
    * snapshot (issue #156). Fonte única para o chip de Jogador Ativo.
    */
  readonly jogadorPorId: Readonly<Record<string, { apelido: string; cor: CorDoPeao }>>
  /**
    * Peças restantes na Caixa para o HUD (issue #145): baseline do snapshot
    * (`tabuleiro.pecasRestantesNaCaixa`) + derivação ao vivo por decremento em
    * PECA_SORTEADA com pecaId inédito (mesmo gate de idempotência de
    * `pecasDeRecebimento`), clamp em 0. `null` = ainda sem snapshot — a
    * contagem fica oculta (nunca se conta a partir do nada).
    */
  readonly pecasRestantesNaCaixa: number | null
  /**
    * pecaIds dos Geradores ligados (chips de Objetivo Global, issue #145):
    * espelho do wire/engine — a contagem exibida é o length. Incrementa no
    * POSICAO_CONFIRMADA com dedupe por id (confirmar o mesmo gerador não
    * conta 2×); substituído pela baseline a cada snapshot (autoridade).
    */
  readonly geradoresLigados: readonly string[]
  /**
    * Cartão de Acesso obtido (issue #145): monotônico — POSICAO_CONFIRMADA de
    * peça `sala_do_diretor` liga; nada local revoga (Limpeza não revoga no
    * engine). O snapshot substitui a baseline (reconexão reconcilia).
    */
  readonly cartaoDeAcessoObtido: boolean
}

/** Estado inicial determinístico do cliente (deltas a partir do zero). */
export function criarEstadoInicialDoCliente(): EstadoDoTabuleiroNoCliente {
  return {
    reserva: criarReservaInicial(),
    posicionadas: [],
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: null,
    // Seed dos peões (issue #91): ids determinísticos por cor, espelhando o
    // engine (`peaoId: peao-${cor}`, `pecaId: null` na origem); os 4 nascem
    // sobre a Mesa (celula: null) e o servidor confirma cada movimento.
    peoes: CORES_DOS_PEOES.map((cor) => ({
      peaoId: `peao-${cor}`,
      cor,
      celula: null,
    })),
    recebidasPendentes: [],
    peaoSelecionadoId: null,
    pecasDeRecebimento: {},
    // Sem iluminação até o primeiro CELULAS_ILUMINADAS do broadcast.
    celulasIluminadas: [],
    // Turnos (issue #118): sem vez nem rodada até o primeiro TURNO_INICIADO.
    jogadorAtivoId: null,
    rodada: null,
    movimentouNoTurno: false,
    posicaoConfirmadaNoTurno: false,
    peaoPorJogador: {},
    jogadorPorId: {},
    // Objetivos globais (issue #145): sem baseline até o primeiro snapshot —
    // a contagem da Caixa fica oculta (null) e os chips partem zerados.
    pecasRestantesNaCaixa: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
  }
}

function girarNaReserva(
  estado: EstadoDoTabuleiroNoCliente,
  pecaId: string,
  orientacao: Orientacao,
): EstadoDoTabuleiroNoCliente {
  return {
    ...estado,
    reserva: estado.reserva.map((p) =>
      p.pecaId === pecaId ? { ...p, orientacao } : p,
    ),
  }
}

function girarPosicionada(
  estado: EstadoDoTabuleiroNoCliente,
  pecaId: string,
  orientacao: Orientacao,
): EstadoDoTabuleiroNoCliente {
  return {
    ...estado,
    posicionadas: estado.posicionadas.map((p) =>
      p.pecaId === pecaId ? { ...p, orientacao } : p,
    ),
  }
}

/**
 * Atribui o peão do evento ao Jogador Ativo no mapa aprendido (issue #118):
 * turnos são serializados, então os eventos de peão dentro da janela
 * TURNO_INICIADO→TURNO_ENCERRADO pertencem ao jogador da vez. Sem vez ativa
 * (ex.: eventos anteriores ao primeiro TURNO_INICIADO), o mapa fica intacto.
 */
function aprenderPeaoDoAtivo(
  estado: EstadoDoTabuleiroNoCliente,
  peaoId: string,
): Readonly<Record<string, string>> {
  if (estado.jogadorAtivoId === null) return estado.peaoPorJogador
  return { ...estado.peaoPorJogador, [estado.jogadorAtivoId]: peaoId }
}

/**
 * Aplica um evento do servidor ao estado do cliente, produzindo um novo
 * estado imutável. Eventos desconhecidos ou erro retornam o estado inalterado.
 *
 * Aceita eventos de tabuleiro (ST-09), de peões/ciclo (ST-10), de turno
 * (ST-11) e de iluminação/limpeza (issue #151).
 */
export function reduzirEvento(
  estado: EstadoDoTabuleiroNoCliente,
  evento: EventoDoJogoNoCliente,
): EstadoDoTabuleiroNoCliente {
  switch (evento.type) {
    // ── Eventos de Tabuleiro (ST-09) ──
    case 'PECA_SELECIONADA':
      return { ...estado, pecaSelecionadaId: evento.pecaId }
    case 'PECA_DESELECIONADA':
      return estado.pecaSelecionadaId === evento.pecaId
        ? { ...estado, pecaSelecionadaId: null }
        : estado
    case 'PECA_GIRADA': {
      const posicionada = estado.posicionadas.some(
        (p) => p.pecaId === evento.pecaId,
      )
      if (posicionada) return girarPosicionada(estado, evento.pecaId, evento.orientacao)
      const temPendencia = estado.recebidasPendentes.some(
        (r) => r.pecaId === evento.pecaId,
      )
      if (temPendencia) {
        return {
          ...estado,
          recebidasPendentes: estado.recebidasPendentes.map((r) =>
            r.pecaId === evento.pecaId ? { ...r, orientacao: evento.orientacao } : r,
          ),
        }
      }
      return girarNaReserva(estado, evento.pecaId, evento.orientacao)
    }
    case 'PECA_POSICIONADA': {
      const pecaNaReserva = estado.reserva.find(
        (p) => p.pecaId === evento.pecaId,
      )
      const encontrada = estado.recebidasPendentes.find(
        (r) => r.pecaId === evento.pecaId,
      )
      const tipoDaPendencia =
        encontrada !== undefined && ehPendenciaSorteada(encontrada)
          ? encontrada.tipoDaPeca
          : undefined
      const tipo =
        pecaNaReserva?.tipo ??
        estado.pecasDeRecebimento[evento.pecaId] ??
        tipoDaPendencia
      if (tipo === undefined) return estado
      const posicionada: PecaPosicionada = {
        pecaId: evento.pecaId,
        tipo,
        orientacao: evento.orientacao,
        celula: evento.celula,
      }
      return {
        ...estado,
        reserva: pecaNaReserva
          ? estado.reserva.filter((p) => p.pecaId !== evento.pecaId)
          : estado.reserva,
        posicionadas: [...estado.posicionadas, posicionada],
        // Encaixe limpa a Seleção. A janela de Manipulação só abre para peças
        // que a têm (caminho/inicial): Especiais e Monstros entram com encaixe
        // direto — espelho do engine (AC1 da issue #145; peoes.ts do engine,
        // posicionarRecebida).
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: abreJanelaDeManipulacao(tipo) ? evento.pecaId : null,
        // Encaixe na célula-alvo resolve a pendência correspondente (issue
        // #91: a pendência só sai da lista quando a peça é POSICIONADA).
        recebidasPendentes: estado.recebidasPendentes.filter(
          (r) =>
            // Forma nova (#138): célula-alvo indefinida (null) ainda não foi
            // resolvida pelo encaixe — não sai da lista aqui.
            r.celulaAlvo === null ||
            chaveCelula(r.celulaAlvo) !== chaveCelula(evento.celula),
        ),
      }
    }
    case 'MANIPULACAO_FINALIZADA':
      return estado.pecaEmManipulacaoId === evento.pecaId
        ? { ...estado, pecaEmManipulacaoId: null }
        : estado
    case 'ERRO_DO_TABULEIRO':
      // Rejeição não altera o modelo local (flash é da camada de feedback).
      return estado

    // ── Eventos de Peão / Ciclo (ST-10) ──
    case 'PEAO_SELECIONADO':
      return { ...estado, peaoSelecionadoId: evento.peaoId }
    case 'RECEBIMENTO_GERADO': {
      // União discriminada pelo campo exclusivo de cada forma: `bordaGeradora`
      // só existe na forma legada (ST-10, @deprecated); a forma nova (#138) já
      // vem como PendenciaDaPecaSorteada no wire e passa direto.
      const recebidasPendentes: readonly PendenciaNoCliente[] = evento.recebidas.map(
        (r) => ('bordaGeradora' in r ? { ...r, pecaId: null } : r),
      )
      const pecasDeRecebimento = { ...estado.pecasDeRecebimento }
      for (const r of evento.recebidas) {
        if (!('bordaGeradora' in r)) {
          pecasDeRecebimento[r.pecaId] = r.tipoDaPeca
        }
      }
      return { ...estado, recebidasPendentes, pecasDeRecebimento }
    }
    case 'PECA_SORTEADA':
      // Gate de idempotência (issue #145): pecaId já conhecido em
      // `pecasDeRecebimento` é repetição do mesmo sorteio — não regrava o
      // tipo e não decrementa a contagem da Caixa uma segunda vez.
      if (estado.pecasDeRecebimento[evento.pecaId] !== undefined) return estado
      return {
        ...estado,
        pecasDeRecebimento: {
          ...estado.pecasDeRecebimento,
          [evento.pecaId]: evento.tipoDaPeca,
        },
        // Decremento ao vivo da contagem da Caixa: só com baseline do
        // snapshot (null permanece null); clamp ≥ 0 (nunca negativa).
        pecasRestantesNaCaixa:
          estado.pecasRestantesNaCaixa === null
            ? null
            : Math.max(0, estado.pecasRestantesNaCaixa - 1),
      }
    case 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO': {
      const encontrada = estado.recebidasPendentes.find(
        (r) => r.recebidaId === evento.recebidaId,
      )
      // A escolha de vaga (#138) só se aplica à forma sorteada; a pendência
      // legada não tem vaga no domínio e é ignorada aqui.
      const pendente =
        encontrada !== undefined && ehPendenciaSorteada(encontrada)
          ? encontrada
          : undefined
      const pecasDeRecebimento =
        pendente && estado.pecasDeRecebimento[pendente.pecaId] === undefined
          ? {
              ...estado.pecasDeRecebimento,
              [pendente.pecaId]: pendente.tipoDaPeca,
            }
          : estado.pecasDeRecebimento
      return {
        ...estado,
        pecasDeRecebimento,
        pecaSelecionadaId: pendente ? pendente.pecaId : estado.pecaSelecionadaId,
        recebidasPendentes: estado.recebidasPendentes.map((r) =>
          r.recebidaId === evento.recebidaId && ehPendenciaSorteada(r)
            ? {
                ...r,
                vaga: evento.borda,
                celulaAlvo: evento.celulaAlvo,
              }
            : r,
        ),
      }
    }
    case 'PEAO_POSICIONADO': {
      const peoes = estado.peoes.map((p) =>
        p.peaoId === evento.peaoId ? { ...p, celula: evento.celula } : p,
      )
      return {
        ...estado,
        peoes,
        peaoSelecionadoId: evento.peaoId,
        peaoPorJogador: aprenderPeaoDoAtivo(estado, evento.peaoId),
      }
    }
    case 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO': {
      // Espelha o engine (peoes.ts:367): a peça escolhida é CONSUMIDA da
      // Reserva. A pendência PERMANECE na lista (agora tipada, com pecaId)
      // até o encaixe (PECA_POSICIONADA). A seleção passa para a Recebida.
      return {
        ...estado,
        reserva: estado.reserva.filter((p) => p.pecaId !== evento.pecaId),
        pecasDeRecebimento: {
          ...estado.pecasDeRecebimento,
          [evento.pecaId]: evento.tipoDaPeca,
        },
        pecaSelecionadaId: evento.pecaId,
        recebidasPendentes: estado.recebidasPendentes.map((r) =>
          r.recebidaId === evento.recebidaId ? { ...r, pecaId: evento.pecaId } : r,
        ),
      }
    }
    case 'PEAO_MOVIDO': {
      const peoes = estado.peoes.map((p) =>
        p.peaoId === evento.peaoId ? { ...p, celula: evento.celula } : p,
      )
      // mover_peao no engine limpa o peaoSelecionadoId — o cliente espelha
      // para não manter seleção fantasma. Dentro do turno, o movimento marca
      // a fase e atribui o peão ao Jogador Ativo (issue #118).
      return {
        ...estado,
        peoes,
        peaoSelecionadoId: null,
        movimentouNoTurno:
          estado.jogadorAtivoId !== null ? true : estado.movimentouNoTurno,
        peaoPorJogador: aprenderPeaoDoAtivo(estado, evento.peaoId),
      }
    }
    case 'PEAO_PERMANECEU':
      // permanecer no engine limpa o peaoSelecionadoId (não altera posição);
      // a janela do turno atribui o peão ao Jogador Ativo (issue #118).
      return {
        ...estado,
        peaoSelecionadoId: null,
        peaoPorJogador: aprenderPeaoDoAtivo(estado, evento.peaoId),
      }

    case 'TURNO_INICIADO':
      return {
        ...estado,
        jogadorAtivoId: evento.jogadorId,
        rodada: evento.rodada,
        movimentouNoTurno: false,
        posicaoConfirmadaNoTurno: false,
        peaoSelecionadoId: null,
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: null,
        recebidasPendentes: [],
      }
    case 'TURNO_ENCERRADO':
      return {
        ...estado,
        jogadorAtivoId: null,
        movimentouNoTurno: false,
        posicaoConfirmadaNoTurno: false,
        peaoSelecionadoId: null,
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: null,
        recebidasPendentes: [],
      }
    case 'POSICAO_CONFIRMADA': {
      // A Confirmação de Posição trava o peão do Jogador Ativo neste turno e
      // é o ÚNICO ponto onde o engine confere conquistas (issue #145, espelho
      // de partida.ts): gerador liga (dedupe por pecaId — reconfirmar o mesmo
      // gerador não conta 2×) e sala_do_diretor obtém o cartão (monotônico).
      // Ordem do lote: posicao_confirmada chega ANTES de limpeza/turno no
      // mesmo lote, então o tipo é resolvido no estado anterior — a peça ainda
      // está em `posicionadas`; `pecasDeRecebimento` é o fallback se ela já
      // saiu do tabuleiro local em outro lote.
      const tipo =
        estado.posicionadas.find((p) => p.pecaId === evento.pecaId)?.tipo ??
        estado.pecasDeRecebimento[evento.pecaId]
      return {
        ...estado,
        posicaoConfirmadaNoTurno: true,
        geradoresLigados:
          tipo === 'gerador' && !estado.geradoresLigados.includes(evento.pecaId)
            ? [...estado.geradoresLigados, evento.pecaId]
            : estado.geradoresLigados,
        cartaoDeAcessoObtido:
          estado.cartaoDeAcessoObtido || tipo === 'sala_do_diretor',
      }
    }

    // ── Iluminação / Limpeza (issue #151) ──
    case 'CELULAS_ILUMINADAS':
      // O cliente apenas espelha o estado compartilhado: o motor é a
      // autoridade da iluminação, então a lista nova substitui a inteira.
      return { ...estado, celulasIluminadas: evento.celulas }
    case 'LIMPEZA_APLICADA': {
      if (evento.pecasRemovidas.length === 0) return estado
      const removidas = evento.pecasRemovidas
      // Peças removidas saem da cena; como a ocupação é derivada de
      // `posicionadas`, as células liberadas voltam a aceitar
      // posicionamento/recebimento sem código adicional.
      return {
        ...estado,
        posicionadas: estado.posicionadas.filter(
          (p) => !removidas.includes(p.pecaId),
        ),
        // Seleção/Manipulação apontando para peça removida não pode sobreviver.
        pecaSelecionadaId:
          estado.pecaSelecionadaId !== null && removidas.includes(estado.pecaSelecionadaId)
            ? null
            : estado.pecaSelecionadaId,
        pecaEmManipulacaoId:
          estado.pecaEmManipulacaoId !== null && removidas.includes(estado.pecaEmManipulacaoId)
            ? null
            : estado.pecaEmManipulacaoId,
      }
    }

    default: {
      // Exaustividade: novo evento wire sem case falha em compilação.
      const _exaustivo: never = evento
      return _exaustivo
    }
  }
}

/**
 * Aplica um lote de eventos em ordem ao estado (o broadcast do game-server
 * preserva a ordem, ex.: [manipulacao_finalizada, peca_selecionada]).
 */
export function reduzirEventos(
  estado: EstadoDoTabuleiroNoCliente,
  eventos: readonly EventoDoJogoNoCliente[],
): EstadoDoTabuleiroNoCliente {
  return eventos.reduce(reduzirEvento, estado)
}

/** Deriva o estado de exibição consumido pela cena a partir do modelo. */
export function estadoDeExibicaoDoModelo(
  estado: EstadoDoTabuleiroNoCliente,
): EstadoExibicaoTabuleiro {
  return {
    reserva: estado.reserva,
    posicionadas: estado.posicionadas,
    peoes: estado.peoes,
    celulasIluminadas: estado.celulasIluminadas,
  }
}
