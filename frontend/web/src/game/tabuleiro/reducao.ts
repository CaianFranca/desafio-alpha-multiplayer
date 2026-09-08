/**
 * Redutor puro evento→estado do Tabuleiro no cliente (issue #85).
 *
 * O game-server não reenvia o histórico de posicionamentos a quem conecta
 * depois (as 4 conexões partem juntas do `PARTIDA_DISPONIVEL`); desde a
 * issue #156 o snapshot `ESTADO_DA_PARTIDA` fecha essa lacuna. Ainda assim o
 * cliente parte do estado inicial determinístico — `criarIniciaisDaMesa()`
 * (mesmos ids de `estadoInicialDoTabuleiro()` do engine) e `posicionadas: []`
 * — e aplica cada evento do broadcast em ordem ao modelo local (deltas
 * aditivos).
 *
 * Semântica alinhada ao engine (`packages/engine/src/tabuleiro.ts`):
 *   - PECA_POSICIONADA não traz `tipo` no wire → preserva o `tipo` da Peça
 *     Inicial da mesa ou da pendência sorteada da Caixa ao encaixar (ver
 *     `traducao.ts` do game-server).
 *   - Novo posicionamento abre a janela de Manipulação (`pecaEmManipulacaoId`)
 *     e limpa a Seleção — exceto Especiais e Monstros, que não têm janela
 *     (`abreJanelaDeManipulacao`, espelho do engine peoes.ts:622-630/683-689;
 *     revisão PR #199).
 *   - Nova Seleção com Manipulação em aberto emite [manipulacao_finalizada,
 *     peca_selecionada] em ordem — o broadcast preserva a ordem; a aplicação
 *     sequencial aqui reproduz esse encadeamento.
  *   - ERRO_DO_TABULEIRO chega só ao autor e não altera o estado do cliente
  *     (o som de recusa é gerenciado pela PartidaPage, não pelo reducer).
 *
 * Ciclo do Peão (issue #91 — espelho do engine; forma #138):
 *   - Peões nascem seedados (`peao-${cor}`, sobre a Mesa) e o servidor move.
 *   - Pendência de Recebimento nasce com a Peça sorteada da Caixa (pecaId +
 *     tipo) e a vaga nula; só sai da lista no PECA_POSICIONADA (encaixe na
 *     célula-alvo derivada da vaga escolhida).
 *   - VAGA_DA_PECA_RECEBIDA_ESCOLHIDO fixa a vaga/célula-alvo e seleciona a
 *     Recebida (pecaSelecionadaId) até o encaixe.
 *   - PEAO_POSICIONADO re-seleciona o peão (Primeiro Turno, partida.ts:344);
 *     PEAO_MOVIDO mantém selecionado o peão movido (mover_peaoDaPartida
 *     re-seleciona para encerrar o turno sem seleção intermediária, #263);
 *     PEAO_PERMANECEU limpa a seleção (permanecer).
 *   - PEAO_DESELECIONADO limpa a seleção vigente (desseleção autoritativa do
 *     servidor, issue #249 — idempotentes não reemitem, fora de sequência é
 *     no-op); o snapshot é a autoridade total da seleção no reload.
 *
 * Turnos (issue #118 — espelho do ST-11):
 *   - TURNO_INICIADO seta jogadorAtivoId/rodada e reseta a fase do turno;
 *     TURNO_ENCERRADO limpa a vez (limpeza mínima; rodada e mapa preservados).
 *     Exceção (issue #258): o replay do MESMO turno re-anunciado após o
 *     snapshot (reload) só confirma a vez — não apaga seleção/pendências.
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
  criarIniciaisDaMesa,
  type CorDoPeao,
  type EstadoExibicaoTabuleiro,
  type Orientacao,
  type PecaDaMesa,
  type PecaPosicionada,
  type PeaoDaExibicao,
  type PeaoId,
  type TipoDaPeca,
} from './contrato'
import type { PendenciaNoCliente } from './interacaoPeoes'
import type {
  AtaqueResolvidoWireEvento,
  Celula,
  CelulasIluminadasWireEvento,
  LimpezaAplicadaWireEvento,
  PeaoEventoDoServidor,
  ResgateRealizadoWireEvento,
  TabuleiroEventoDoServidor,
  PecaSorteadaEvento,
  VagaDaPecaRecebidaEscolhidaEvento,
  PosicaoConfirmadaEvento,
  TurnoEncerradoEvento,
  TurnoIniciadoEvento,
} from '@flicker/shared'

export type PercepcaoDeJogador = {
  readonly apelido: string
  readonly cor: CorDoPeao
  readonly sanidade: number
  readonly emBaixaIluminacao: boolean
  readonly amedrontado: boolean
  readonly protegido: boolean
  /**
   * Ordem de entrada na Sala (snapshot `jogadores[].ordem`, issue #226):
   * base da fila circular do Turno no HUD. Preservada nos deltas por spread
   * (`...anterior`); projeções sem snapshot ficam sem ordem até a baseline.
   */
  readonly ordem: number
}

export type SanidadePorPeao = Readonly<
  Record<string, { sanidade: number; emBaixaIluminacao: boolean; amedrontado: boolean }>
>

/**
 * Peões em Baixa Iluminação (issue #297): projeção de exibição do estado do
 * Vulto por jogador (`emBaixaIluminacao` — per-player, não por célula), para o
 * avatar 3D do Diretor alternar para a variante *apagado*.
 */
export function peoesEmBaixaIluminacaoDe(
  sanidadePorPeao: SanidadePorPeao,
): ReadonlySet<PeaoId> {
  const out = new Set<string>()
  for (const [peaoId, dados] of Object.entries(sanidadePorPeao)) {
    if (dados.emBaixaIluminacao) out.add(peaoId)
  }
  return out
}

/**
 * Eventos que o canal da Partida entrega ao redutor: tabuleiro (ST-09),
 * peões/ciclo (ST-10), turnos (ST-11, issue #118), iluminação/limpeza
 * (issue #151) e monstros/estados (ST-15, issue #174 — ATAQUE_RESOLVIDO e
 * RESGATE_REALIZADO). É o tipo roteado pelo socket e aceito pelo reducer.
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
  | AtaqueResolvidoWireEvento
  | ResgateRealizadoWireEvento

/** Estado do modelo de tabuleiro mantido no cliente. */
export interface EstadoDoTabuleiroNoCliente {
  /** Peças Iniciais na mesa aguardando encaixe (issue #143; ids do engine). */
  readonly iniciais: readonly PecaDaMesa[]
  readonly posicionadas: readonly PecaPosicionada[]
  readonly pecaSelecionadaId: string | null
  readonly pecaEmManipulacaoId: string | null
  /** Peões com posição autoritativa do servidor (issue #91). */
  readonly peoes: readonly PeaoDaExibicao[]
  /** Recebidas aguardando escolha de vaga e encaixe (forma sorteada #138). */
  readonly recebidasPendentes: readonly PendenciaNoCliente[]
  /** Peão selecionado no ciclo (vem do servidor via PEAO_SELECIONADO). */
  readonly peaoSelecionadoId: string | null
  /** Tipos sorteados da Caixa conhecidos (chave = pecaId; fonte do encaixe). */
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
   * Estendido na issue #174 com Sanidade e estados (Baixa Iluminação,
   * Amedrontado) — projeção mínima sem recalcular no cliente.
   */
  readonly jogadorPorId: Readonly<Record<string, PercepcaoDeJogador>>
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
    iniciais: criarIniciaisDaMesa(),
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

function girarNaMesa(
  estado: EstadoDoTabuleiroNoCliente,
  pecaId: string,
  orientacao: Orientacao,
): EstadoDoTabuleiroNoCliente {
  return {
    ...estado,
    iniciais: estado.iniciais.map((p) =>
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
 * (ST-11), de iluminação/limpeza (issue #151) e de monstros/estados
 * (ST-15, #174 — ATAQUE_RESOLVIDO/RESGATE_REALIZADO).
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
      // Peça Inicial na mesa: o giro atualiza a entrada local (issue #143).
      if (estado.iniciais.some((p) => p.pecaId === evento.pecaId)) {
        return girarNaMesa(estado, evento.pecaId, evento.orientacao)
      }
      // Peça desconhecida (ex.: da Caixa sem pendência local): sem efeito.
      return estado
    }
    case 'PECA_POSICIONADA': {
      const pecaNaMesa = estado.iniciais.find(
        (p) => p.pecaId === evento.pecaId,
      )
      const encontrada = estado.recebidasPendentes.find(
        (r) => r.pecaId === evento.pecaId,
      )
      const tipo =
        pecaNaMesa?.tipo ??
        estado.pecasDeRecebimento[evento.pecaId] ??
        encontrada?.tipoDaPeca
      if (tipo === undefined) return estado
      const posicionada: PecaPosicionada = {
        pecaId: evento.pecaId,
        tipo,
        orientacao: evento.orientacao,
        celula: evento.celula,
      }
      return {
        ...estado,
        iniciais: pecaNaMesa
          ? estado.iniciais.filter((p) => p.pecaId !== evento.pecaId)
          : estado.iniciais,
        posicionadas: [...estado.posicionadas, posicionada],
        // Encaixe limpa a Seleção e abre a janela de Manipulação apenas para
        // peças com janela: Especiais e Monstros não abrem (espelha o engine
        // posicionarRecebida, peoes.ts:622-630/683-689 — o delta
        // PECA_POSICIONADA não carrega tipo, mas o modelo local o conhece).
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: abreJanelaDeManipulacao(tipo) ? evento.pecaId : null,
        // Encaixe na célula-alvo resolve a pendência correspondente (issue
        // #91: a pendência só sai da lista quando a peça é POSICIONADA).
        recebidasPendentes: estado.recebidasPendentes.filter(
          (r) =>
            // Célula-alvo ainda indefinida (vaga não escolhida): a pendência
            // não foi resolvida por este encaixe — permanece na lista.
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
      // Rejeição não altera o modelo local (recusa é da PartidaPage: som + anúncio).
      return estado

    // ── Eventos de Peão / Ciclo (ST-10) ──
    case 'PEAO_SELECIONADO':
      return { ...estado, peaoSelecionadoId: evento.peaoId }
    case 'PEAO_DESELECIONADO':
      // Desseleção autoritativa (#249): limpa só a seleção vigente; evento
      // para outro peão (ou sem seleção) é no-op — nunca ressuscita seleção obsoleta.
      return estado.peaoSelecionadoId === evento.peaoId
        ? { ...estado, peaoSelecionadoId: null }
        : estado
    case 'RECEBIMENTO_GERADO': {
      // Forma da #138: o wire já traz cada pendência com a Peça sorteada
      // (pecaId + tipo) e a vaga nula — passa direto para o modelo.
      const recebidasPendentes: readonly PendenciaNoCliente[] = evento.recebidas
      const pecasDeRecebimento = { ...estado.pecasDeRecebimento }
      for (const r of evento.recebidas) {
        pecasDeRecebimento[r.pecaId] = r.tipoDaPeca
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
      // A escolha da vaga (#138) fixa borda/célula-alvo e seleciona a Peça
      // sorteada correspondente (encaixe em foco até o posicionamento).
      const pendente = estado.recebidasPendentes.find(
        (r) => r.recebidaId === evento.recebidaId,
      )
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
          r.recebidaId === evento.recebidaId
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
    case 'PEAO_MOVIDO': {
      const peoes = estado.peoes.map((p) =>
        p.peaoId === evento.peaoId ? { ...p, celula: evento.celula } : p,
      )
      // mover_peaoDaPartida re-seleciona o Peão para que o turno possa ser
      // encerrado sem seleção intermediária. Dentro do turno, o movimento
      // marca a fase e atribui o peão ao Jogador Ativo (issue #118).
      return {
        ...estado,
        peoes,
        peaoSelecionadoId: evento.peaoId,
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

    case 'TURNO_INICIADO': {
      // Replay do anúncio pós-snapshot (issue #258): o game-server re-envia o
      // turno corrente em unicast a cada admissão — inclusive no reload, logo
      // após ESTADO_DA_PARTIDA (ws.ts: anunciarTurnoAtual). O par
      // (jogadorId, rodada) identifica unicamente um turno (o mesmo jogador
      // só volta a agir na rodada seguinte), então repetí-lo é replay, não
      // troca: confirma a vez sem apagar a seleção/pendências/fase que a foto
      // restaurou. A autoridade da seleção (#249) e do snapshot são
      // preservadas — o destravamento segue via DESELECIONAR_PEAO + ack.
      // Troca real (outro jogador ou nova rodada) cai no reset total abaixo.
      const mesmoTurno =
        estado.jogadorAtivoId !== null &&
        evento.jogadorId === estado.jogadorAtivoId &&
        estado.rodada !== null &&
        evento.rodada === estado.rodada
      if (mesmoTurno) {
        return { ...estado, jogadorAtivoId: evento.jogadorId, rodada: evento.rodada }
      }
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
      // Proteção da Sala Médica (issue #225): o wire traz o estado RESULTANTE
      // do ator (`evento.protegido` já inclui concessão da Sala Médica e consumo
      // do ataque do MESMO gatilho) — projeta sem derivar.
      const tipo =
        estado.posicionadas.find((p) => p.pecaId === evento.pecaId)?.tipo ??
        estado.pecasDeRecebimento[evento.pecaId]
      const anteriorProtegido = estado.jogadorPorId[evento.jogadorId]
      const protegidoResultante = (evento as { protegido?: boolean }).protegido ?? false
      const jogadorPorIdComProtecao = anteriorProtegido
        ? {
            ...estado.jogadorPorId,
            [evento.jogadorId]: { ...anteriorProtegido, protegido: protegidoResultante },
          }
        : estado.jogadorPorId
      return {
        ...estado,
        posicaoConfirmadaNoTurno: true,
        geradoresLigados:
          tipo === 'gerador' && !estado.geradoresLigados.includes(evento.pecaId)
            ? [...estado.geradoresLigados, evento.pecaId]
            : estado.geradoresLigados,
        cartaoDeAcessoObtido:
          estado.cartaoDeAcessoObtido || tipo === 'sala_do_diretor',
        jogadorPorId: jogadorPorIdComProtecao,
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

    // ── Monstros e estados (ST-15, issue #174) — Proteção (issue #225) ──
    case 'ATAQUE_RESOLVIDO': {
      // estadosAplicados carrega o estado resultante por Jogador mudado
      // (Baixa Iluminação, sanidade, Amedrontado) — issue #173. O cliente
      // apenas projeta no dicionário, sem derivar (mesma semântica do
      // snapshot). Ataque sem alvos ⇒ array vazio — estado permanece, a
      // recusa (som) é tratada na camada PartidaPage.
      // Proteção (issue #225): `protegidos` lista os Jogadores cuja Proteção
      // foi consumida nesta resolução — zera `protegido` no modelo. Jogadores
      // já Amedrontados/protegidos não aparecem em `estadosAplicados`, então
      // o consumo precisa ser tratado à parte; snapshot reconcilia em seguida.
      // Fallback defensivo para payloads antigos sem `protegidos` (rolling
      // deploy / replay persistido anterior à #227) — mesmo padrão de
      // `snapshot.ts:135`.
      const estadosAplicados = (evento as unknown as { estadosAplicados?: typeof evento.estadosAplicados }).estadosAplicados ?? []
      const protegidos = (evento as unknown as { protegidos?: typeof evento.protegidos }).protegidos ?? []
      if (estadosAplicados.length === 0 && protegidos.length === 0) {
        return estado
      }
      // Atualiza apenas jogadores já conhecidos via snapshot; eventos antes do
      // snapshot são ignorados até a projeção autoritativa (evita vazar
      // jogadorId como apelido).
      let mudou = false
      const jogadorPorId = { ...estado.jogadorPorId }
      for (const aplicado of estadosAplicados) {
        const anterior = jogadorPorId[aplicado.jogadorId]
        if (!anterior) continue
        mudou = true
        jogadorPorId[aplicado.jogadorId] = {
          ...anterior,
          sanidade: aplicado.sanidade,
          emBaixaIluminacao: aplicado.emBaixaIluminacao,
          amedrontado: aplicado.amedrontado,
        }
      }
      for (const jogadorId of protegidos) {
        const anterior = jogadorPorId[jogadorId]
        if (!anterior) continue
        if (!anterior.protegido) continue
        mudou = true
        jogadorPorId[jogadorId] = { ...anterior, protegido: false }
      }
      return mudou ? { ...estado, jogadorPorId } : estado
    }
    case 'RESGATE_REALIZADO': {
      const anterior = estado.jogadorPorId[evento.resgatadoJogadorId]
      if (!anterior) {
        // Sem snapshot ainda — aguarda projeção autoritativa.
        return estado
      }
      // Resgate remove todos os estados; se amedrontado, restaura sanidade
      // a 1 ponto (CONTEXT.md: Resgate) — o wire não carrega sanidade, então
      // o cliente aplica a regra mínima aqui; o snapshot autoritativo corrige
      // em seguida se houver divergência.
      const sanidadeRestaurada = anterior.amedrontado ? 1 : anterior.sanidade
      return {
        ...estado,
        jogadorPorId: {
          ...estado.jogadorPorId,
          [evento.resgatadoJogadorId]: {
            ...anterior,
            sanidade: sanidadeRestaurada,
            emBaixaIluminacao: false,
            amedrontado: false,
          },
        },
      }
    }

    case 'ATRAVESSOU_O_ESCURO': {
      // Sem lógica visual — ticket #268. Marco para exibição futura.
      return estado
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
    iniciais: estado.iniciais,
    posicionadas: estado.posicionadas,
    peoes: estado.peoes,
    celulasIluminadas: estado.celulasIluminadas,
  }
}
