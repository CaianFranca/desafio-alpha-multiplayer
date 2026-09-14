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
  abreJanelaDeManipulacao,
  chaveCelula,
  coresParaN,
  criarIniciaisDaMesa,
  quantidadeValidaDeJogadores,
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
import type { FatiaDoAtaque } from './ataque'
import type {
  AtaqueResolvidoWireEvento,
  Celula,
  CelulasIluminadasWireEvento,
  DesistenciaRegistradaWireEvento,
  LimpezaAplicadaWireEvento,
  PeaoEventoDoServidor,
  ResgateRealizadoWireEvento,
  TabuleiroEventoDoServidor,
  PecaSorteadaEvento,
  VagaDaPecaRecebidaEscolhidaEvento,
  PosicaoConfirmadaEvento,
  PartidaIniciadaEvento,
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
 * (issue #151), monstros/estados (ST-15, issue #174 — ATAQUE_RESOLVIDO e
 * RESGATE_REALIZADO) e desistência (issue #290 — DESISTENCIA_REGISTRADA).
 * É o tipo roteado pelo socket e aceito pelo reducer.
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
  | PartidaIniciadaEvento
  | DesistenciaRegistradaWireEvento

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
  /**
   * Marco autoritativo do início da Partida (epoch ms, issue #259): baseline
   * do snapshot ou do broadcast PARTIDA_INICIADA, de onde o HUD deriva o
   * cronômetro. `null` enquanto a Partida não iniciou/sem snapshot.
   */
  readonly iniciadaEm: number | null
  /** O peão do Jogador Ativo já se moveu neste turno (PEAO_MOVIDO). */
  readonly movimentouNoTurno: boolean
  /** A posição do peão do Jogador Ativo já foi confirmada (POSICAO_CONFIRMADA). */
  readonly posicaoConfirmadaNoTurno: boolean
  /**
   * Peça do início do turno (zona da origem — espelho de partida.ts:119): a
   * Peça sob o Peão do Jogador Ativo quando o turno iniciou. O Peão só pode
   * pousar nela ou numa vizinha diretamente conectada a ela (ida-e-volta de
   * 1 salto, livre até a Confirmação) — nunca viajar pela mesa dentro do
   * turno. `null` = zona inativa (Peão na Mesa no Primeiro Turno, entre
   * turnos). Derivada no TURNO_INICIADO real; baseline do snapshot.
   */
  readonly pecaDoInicioDoTurnoId: string | null
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
  /**
   * Fila de chegada dos peões por célula (issue #298): a ordem em que os peões
   * pousam na peça que os abriga é o que define o arranjo visual de
   * co-ocupação (Portão: cantos SE→SD→ID→IE; peça comum: 1º no centro).
   * Chave = `chaveCelula`; o 1º da lista é o mais antigo na célula. É
   * reconstruída pelo snapshot na ordem do motor; o índice é usado só para
   * desempate visual em recarregamentos.
   */
  readonly ordemDeChegadaPorChave: Readonly<Record<string, readonly PeaoId[]>>
  /** N de layout/teto 2..4 derivado do roster (snapshot, clamp); null antes do snapshot. Não é o N real do anúncio. */
  readonly quantidadeParaLayout: number | null
}

/** Estado inicial determinístico do cliente (deltas a partir do zero). Suporta N=2..4; fallback 4. */
export function criarEstadoInicialDoCliente(quantidadeDeJogadores: number = 4): EstadoDoTabuleiroNoCliente {
  const n = quantidadeValidaDeJogadores(quantidadeDeJogadores)
  const cores = coresParaN(n)
  return {
    iniciais: criarIniciaisDaMesa(n),
    posicionadas: [],
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: null,
    // Seed dos peões (issue #91): ids determinísticos por cor, espelhando o
    // engine (`peaoId: peao-${cor}`, `pecaId: null` na origem); N peões nascem
    // sobre a Mesa (celula: null) e o servidor confirma cada movimento.
    peoes: cores.map((cor) => ({
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
    // Sem marco de início até o snapshot/PARTIDA_INICIADA (issue #259).
    iniciadaEm: null,
    movimentouNoTurno: false,
    posicaoConfirmadaNoTurno: false,
    pecaDoInicioDoTurnoId: null,
    peaoPorJogador: {},
    jogadorPorId: {},
    // Objetivos globais (issue #145): sem baseline até o primeiro snapshot —
    // a contagem da Caixa fica oculta (null) e os chips partem zerados.
    pecasRestantesNaCaixa: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
    // Sem fila de chegada até o primeiro posicionamento/movimento (issue #298).
    ordemDeChegadaPorChave: {},
    quantidadeParaLayout: n,
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
 * Rastreia a fila de chegada dos peões por célula (issue #298): cada
 * posicionamento/movimento de peão remove o peão do tracker da célula de
 * origem (derivada de `estado.peoes` — o estado ANTERIOR ao evento) e o anexa
 * ao fim da fila da célula de destino. Fila/chave vazias são podadas
 * (limpeza #151: não acumular chaves órfãs). `novaCelula` null (defensivo —
 * o wire de PEAO_POSICIONADO/MOVIDO nunca traz; cobre reposição sobre a Mesa
 * por paridade com o snapshot) só remove, sem anexar.
 */
export function atualizarOrdemDeChegada(
  estado: EstadoDoTabuleiroNoCliente,
  peaoId: PeaoId,
  novaCelula: Celula | null,
): Readonly<Record<string, readonly PeaoId[]>> {
  const anterior = estado.peoes.find((p) => p.peaoId === peaoId)
  const anteriorChave =
    anterior !== undefined && anterior.celula !== null
      ? chaveCelula(anterior.celula)
      : null
  const proximaChave = novaCelula !== null ? chaveCelula(novaCelula) : null
  const mapa: Record<string, PeaoId[]> = {}
  // Reutiliza as filas existentes (referências são imutáveis; só os arrays novos abaixo).
  for (const [chave, fila] of Object.entries(estado.ordemDeChegadaPorChave)) {
    mapa[chave] = [...fila]
  }
  // Remove da origem (podando fila vazia).
  if (anteriorChave !== null && mapa[anteriorChave]) {
    mapa[anteriorChave] = mapa[anteriorChave].filter((id) => id !== peaoId)
    if (mapa[anteriorChave].length === 0) delete mapa[anteriorChave]
  }
  // Anexa ao destino (no-op quando sem destino: remove sem anexar).
  if (proximaChave !== null) {
    const filaDestino = mapa[proximaChave] ?? []
    if (!filaDestino.includes(peaoId)) filaDestino.push(peaoId)
    mapa[proximaChave] = filaDestino
  }
  return mapa
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
    case 'PARTIDA_INICIADA':
      // Marco de início autoritativo (issue #259): os Jogadores admitidos
      // antes da virada receberam snapshot `preparada` (iniciadaEm null) — o
      // broadcast entrega o mesmo marco a todos para o HUD sincronizar.
      // Guard de runtime (review PR #374): wire de binário anterior pode
      // omitir o campo — o assign cego deixava `undefined` no modelo e
      // corrompia a baseline do cronômetro; inválido preserva o marco vigente.
      if (
        typeof evento.iniciadaEm !== 'number' ||
        !Number.isFinite(evento.iniciadaEm) ||
        evento.iniciadaEm <= 0
      ) {
        return estado
      }
      return { ...estado, iniciadaEm: evento.iniciadaEm }

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
        ordemDeChegadaPorChave: atualizarOrdemDeChegada(
          estado,
          evento.peaoId,
          evento.celula,
        ),
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
        ordemDeChegadaPorChave: atualizarOrdemDeChegada(
          estado,
          evento.peaoId,
          evento.celula,
        ),
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
      // Zona da origem (espelho de partida.ts:1689/1710): a Peça sob o Peão
      // do novo Jogador Ativo no início do turno. Peão na Mesa (Primeiro
      // Turno) → null → zona inativa.
      const peaoDoNovoAtivoId =
        estado.peaoPorJogador[evento.jogadorId] ?? null
      const peaoDoNovoAtivo = estado.peoes.find(
        (p) => p.peaoId === peaoDoNovoAtivoId,
      )
      const pecaDoInicioDoTurnoId =
        peaoDoNovoAtivo && peaoDoNovoAtivo.celula !== null
          ? (estado.posicionadas.find(
              (p) =>
                chaveCelula(p.celula) === chaveCelula(peaoDoNovoAtivo.celula as Celula),
            )?.pecaId ?? null)
          : null
      return {
        ...estado,
        jogadorAtivoId: evento.jogadorId,
        rodada: evento.rodada,
        movimentouNoTurno: false,
        posicaoConfirmadaNoTurno: false,
        pecaDoInicioDoTurnoId,
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
        pecaDoInicioDoTurnoId: null,
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
      // A fila de chegada (issue #298) acompanha: as chaves das células
      // removidas são podadas para não vazar fila órfã para a próxima peça
      // na mesma célula (limpeza #151: não acumular chaves órfãs).
      const chavesRemovidas = new Set(
        estado.posicionadas
          .filter((p) => removidas.includes(p.pecaId))
          .map((p) => chaveCelula(p.celula)),
      )
      const ordemDeChegadaPorChave = Object.fromEntries(
        Object.entries(estado.ordemDeChegadaPorChave).filter(
          ([chave]) => !chavesRemovidas.has(chave),
        ),
      )
      return {
        ...estado,
        posicionadas: estado.posicionadas.filter(
          (p) => !removidas.includes(p.pecaId),
        ),
        ordemDeChegadaPorChave,
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

    case 'DESISTENCIA_REGISTRADA': {
      // Desistência (issue #290, espelho do lote atômico #288): remove o peão
      // do desistente e sua vez da ordem. Iluminação/Limpeza/Passagem chegam
      // no mesmo lote via CELULAS_ILUMINADAS/LIMPEZA_APLICADA/TURNO_* — o
      // recálculo completo da regra vive no servidor (autoridade); aqui só a
      // queda óbvia otimista (peça hospedeira do peão removido) + remoção
      // imediata. Snapshot reconcilia qualquer divergência.
      // Idempotente: evento repetido (replay/reconexão) é no-op.
      // Seleção/Manipulação: se o desistente era o Jogador Ativo, a vez passa
      // (Passagem iminente no lote) e a seleção do turno anterior não pode
      // sobreviver sem TURNO_* — limpa aqui para não deixar peça órfã
      // selecionada. Demais casos ficam para o TURNO_*/LIMPEZA do lote.
      const jogadorId = evento.jogadorId
      const peaoId = evento.peaoId
      const temJogador = Object.prototype.hasOwnProperty.call(estado.jogadorPorId, jogadorId)
      const temPeao = estado.peoes.some((p) => p.peaoId === peaoId)
      const temMapeamento = Object.prototype.hasOwnProperty.call(estado.peaoPorJogador, jogadorId)
      if (!temJogador && !temPeao && !temMapeamento) return estado
      const eraAtivo = estado.jogadorAtivoId !== null && estado.jogadorAtivoId === jogadorId
      const jogadorPorId = { ...estado.jogadorPorId }
      delete jogadorPorId[jogadorId]
      const peaoPorJogador = { ...estado.peaoPorJogador }
      delete peaoPorJogador[jogadorId]
      const peoes = estado.peoes.filter((p) => p.peaoId !== peaoId)
      // Queda óbvia otimista (review PR #378, AC2): a peça sob o peão removido
      // perde o ocupante e cai pela regra normal no servidor — o lote traz a
      // LIMPEZA_APLICADA em seguida, mas a projeção imediata evita peça órfã
      // escura até o lote completar. Peças só-iluminadas-pelo-ausente vêm na
      // LIMPEZA do lote (servidor é autoridade, cliente nunca recalcula).
      const peaoRemovido = estado.peoes.find((p) => p.peaoId === peaoId)
      const celulaDoPeao = peaoRemovido?.celula ?? null
      const pecaHospedeiraId =
        celulaDoPeao !== null
          ? (estado.posicionadas.find(
              (p) => chaveCelula(p.celula) === chaveCelula(celulaDoPeao),
            )?.pecaId ?? null)
          : null
      const posicionadas =
        pecaHospedeiraId !== null
          ? estado.posicionadas.filter((p) => p.pecaId !== pecaHospedeiraId)
          : estado.posicionadas
      const chavesHospedeiras =
        pecaHospedeiraId !== null && celulaDoPeao !== null
          ? new Set([chaveCelula(celulaDoPeao)])
          : new Set<string>()
      const ordemDeChegadaPorChave: Record<string, readonly PeaoId[]> = {}
      for (const [chave, fila] of Object.entries(estado.ordemDeChegadaPorChave)) {
        if (chavesHospedeiras.has(chave)) continue
        const filtrada = fila.filter((id) => id !== peaoId)
        if (filtrada.length > 0) ordemDeChegadaPorChave[chave] = filtrada
      }
      const selecaoOrfa =
        pecaHospedeiraId !== null &&
        (estado.pecaSelecionadaId === pecaHospedeiraId ||
          estado.pecaEmManipulacaoId === pecaHospedeiraId)
      return {
        ...estado,
        peoes,
        posicionadas,
        jogadorPorId,
        peaoPorJogador,
        peaoSelecionadoId:
          estado.peaoSelecionadoId === peaoId ? null : estado.peaoSelecionadoId,
        pecaSelecionadaId: eraAtivo || selecaoOrfa ? null : estado.pecaSelecionadaId,
        pecaEmManipulacaoId: eraAtivo || selecaoOrfa ? null : estado.pecaEmManipulacaoId,
        ordemDeChegadaPorChave,
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

/**
 * Aplica a fatia de estado de UM slot do ataque (issue #385, follow-up da
 * ordem Espectro→Vulto) — espelha o bloco `ATAQUE_RESOLVIDO` acima, mas só
 * com a fatia do atacante (ver `coreografarAtaque`): o Vulto só projeta Baixa
 * Iluminação; o Espectro só Sanidade/Amedrontado; a proteção consumida zera
 * `protegido`. Mesmos guards do bloco integral (só jogadores conhecidos via
 * snapshot; sem vítimas/protegidos na fatia, nada a aplicar). Valores
 * RESULTANTES absolutos — reaplicar a mesma fatia é no-op.
 */
export function reduzirFatiaDoAtaque(
  estado: EstadoDoTabuleiroNoCliente,
  fatia: FatiaDoAtaque,
): EstadoDoTabuleiroNoCliente {
  if (fatia.estadosAplicados.length === 0 && fatia.protegidos.length === 0) {
    return estado
  }
  let mudou = false
  const jogadorPorId = { ...estado.jogadorPorId }
  for (const aplicado of fatia.estadosAplicados) {
    const anterior = jogadorPorId[aplicado.jogadorId]
    if (!anterior) continue
    if (fatia.tipo === 'vulto') {
      if (anterior.emBaixaIluminacao === aplicado.emBaixaIluminacao) continue
      mudou = true
      jogadorPorId[aplicado.jogadorId] = {
        ...anterior,
        emBaixaIluminacao: aplicado.emBaixaIluminacao,
      }
    } else {
      if (
        anterior.sanidade === aplicado.sanidade &&
        anterior.amedrontado === aplicado.amedrontado
      ) {
        continue
      }
      mudou = true
      jogadorPorId[aplicado.jogadorId] = {
        ...anterior,
        sanidade: aplicado.sanidade,
        amedrontado: aplicado.amedrontado,
      }
    }
  }
  for (const jogadorId of fatia.protegidos) {
    const anterior = jogadorPorId[jogadorId]
    if (!anterior) continue
    if (!anterior.protegido) continue
    mudou = true
    jogadorPorId[jogadorId] = { ...anterior, protegido: false }
  }
  return mudou ? { ...estado, jogadorPorId } : estado
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
    ordemDeChegadaPorChave: estado.ordemDeChegadaPorChave,
  }
}
