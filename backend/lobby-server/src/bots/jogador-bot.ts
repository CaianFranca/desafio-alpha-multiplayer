// Jogador-bot — driver WS cliente do bot Random Walk.
//
// DIVERGÊNCIA DE CONTRATO (lida no game-server antes de codar): o servidor
// NÃO envia ESTADO_DA_PARTIDA por mutação — o snapshot é unicast só na
// admissão (ws.ts) e cada mutação chega como o lote de eventos traduzidos
// (handlers.ts → traduzirEventos → broadcast). O loop do turno, por isso,
// não "aguarda o próximo ESTADO": ele mantém um ESPELHO do EstadoDaPartida
// da engine, semeado pelo snapshot da admissão e avançado pelo fold puro
// aplicarEventoNoEspelho sobre cada evento do broadcast — o lote da mutação
// é a confirmação. Sem o espelho, o bot não teria como consultar a FSM
// (posições, vagas, vez) e qualquer decisão seria chute, queimando o teto de
// ações e strandando a mesa.
//
// Propriedades do espelho (server-autoritativo, caminho único):
// - a semente é exata (o snapshot da admissão reflete o estado corrente);
// - durante o turno do bot SÓ o bot muta a partida (vez exclusiva), e cada
//   comando próprio só é considerado após o lote-resposta dobrar no espelho;
// - fora do turno, os lotes alheios dobram do mesmo jeito — na vez do bot o
//   espelho está exato;
// - a Caixa é opaca no snapshot (só a contagem): o espelho guarda fichas
//   opacas e cada PECA_SORTEADA consome uma; as Recebidas vêm sempre com ids
//   reais no RECEBIMENTO_GERADO (dobra por atacado), então nenhuma ficha
//   opaca é jamais enviada ao servidor;
// - reconexão re-semeia pelo snapshot novo e aborta a espera em voo com
//   segurança (o loop reconsulta e segue).
//
// O bot NUNCA age por outro playerId: o jogadorId do wire é sempre o próprio
// (converterComandoParaWire recebe só comandos da FSM consultada com o id do
// bot) e o turno só roda no TURNO_INICIADO do próprio bot.

import {
  acoesValidasDaSubfase,
  ehPecaDeMonstro,
  ehPecaEspecial,
  expandirPosicionamentoDoBot,
  MAX_ACOES_POR_TURNO_DO_BOT,
  sortearAcao,
  type ComandoDePartida,
  type EstadoDaPartida,
} from '@flicker/engine';
import type {
  EstadoDaPartidaSnapshot,
  PartidaComandoDoCliente,
} from '@flicker/shared';

// --- Semente: snapshot wire → domínio da engine ---------------------------

function fichaOpaca(indice: number) {
  return {
    pecaId: `caixa-opaca-${indice}`,
    tipo: 'reta' as const,
    orientacao: 0 as const,
  };
}

// Adapta o snapshot da admissão ao EstadoDaPartida autoritativo do espelho.
// Limites documentados: a Caixa entra como fichas opacas (só a contagem é
// real — os sorteios reais chegam nos eventos); peoesNoAlcance,
// pecasEmPeriodoDeGraca e atravessouNoTurno nascem zerados e são dobrados
// pelos eventos (RESGATE_REALIZADO/PEAO_MOVIDO/LIMPEZA/ATRAVESSOU_O_ESCURO).
export function adaptarSnapshotParaEspelho(
  snapshot: EstadoDaPartidaSnapshot,
): EstadoDaPartida {
  const caixa = Array.from(
    { length: snapshot.tabuleiro.pecasRestantesNaCaixa },
    (_, indice) => fichaOpaca(indice),
  );
  let resultado: EstadoDaPartida['resultado'] = null;
  if (snapshot.estado === 'terminada') {
    resultado =
      snapshot.resultado === 'vitoria'
        ? { tipo: 'vitoria' }
        : {
            tipo: 'derrota',
            motivo: snapshot.motivo ?? 'caixa_esgotada',
          };
  }
  return {
    tabuleiro: {
      caixa,
      iniciais: snapshot.tabuleiro.iniciais.map((peca) => ({ ...peca })),
      posicionadas: snapshot.tabuleiro.posicionadas.map((peca) => ({
        ...peca,
        celula: { ...peca.celula },
      })),
      pecaSelecionadaId: snapshot.tabuleiro.pecaSelecionadaId,
      pecaEmManipulacaoId: snapshot.tabuleiro.pecaEmManipulacaoId,
      peoes: snapshot.tabuleiro.peoes.map((peao) => ({ ...peao })),
      peaoSelecionadoId: snapshot.tabuleiro.peaoSelecionadoId,
      recebidas: snapshot.tabuleiro.recebidas.map((recebida) => ({
        recebidaId: recebida.recebidaId,
        pecaId: recebida.pecaId,
        tipo: recebida.tipo,
        orientacao: recebida.orientacao,
        vaga: recebida.vaga,
        celulaAlvo: recebida.celulaAlvo
          ? { ...recebida.celulaAlvo }
          : null,
      })),
    },
    jogadores: snapshot.jogadores.map((jogador) => ({
      jogadorId: jogador.jogadorId,
      ordem: jogador.ordem,
      cor: jogador.cor,
      peaoId: jogador.peaoId,
      primeiroTurnoPendente: jogador.primeiroTurnoPendente,
      sanidade: jogador.sanidade,
      protegido: jogador.protegido,
      emBaixaIluminacao: jogador.emBaixaIluminacao,
      amedrontado: jogador.amedrontado,
    })),
    jogadorAtivoId: snapshot.jogadorAtivoId,
    rodada: snapshot.rodada,
    pecaDoInicioDoTurnoId: snapshot.pecaDoInicioDoTurnoId,
    posicaoConfirmada: snapshot.posicaoConfirmada,
    atravessouNoTurno: false,
    celulasIluminadas: snapshot.celulasIluminadas.map((celula) => ({
      ...celula,
    })),
    resultado,
    geradoresLigados: [...snapshot.geradoresLigados],
    cartaoDeAcessoObtido: snapshot.cartaoDeAcessoObtido,
    peoesNoAlcance: {},
    pecasEmPeriodoDeGraca: [],
  };
}

// --- Espelho: fold puro de um evento wire ----------------------------------

export interface EspelhoDoBot {
  readonly estado: EstadoDaPartida;
  // Última confirmação do turno (para o escudo da Sala Médica sobreviver ao
  // consumo do MESMO gatilho — espelho da issue #227): válida só até o
  // próximo ATAQUE_RESOLVIDO (consome) ou a próxima virada de turno (limpa).
  readonly ultimaConfirmacao: {
    readonly jogadorId: string;
    readonly pecaId: string;
    readonly emSalaMedica: boolean;
  } | null;
}

export function espelhoInicial(estado: EstadoDaPartida): EspelhoDoBot {
  return { estado, ultimaConfirmacao: null };
}

function comTabuleiro(
  espelho: EspelhoDoBot,
  tabuleiro: EstadoDaPartida['tabuleiro'],
): EspelhoDoBot {
  return { ...espelho, estado: { ...espelho.estado, tabuleiro } };
}

function comJogadores(
  espelho: EspelhoDoBot,
  jogadores: EstadoDaPartida['jogadores'],
): EspelhoDoBot {
  return { ...espelho, estado: { ...espelho.estado, jogadores } };
}

// Dobra UM evento do broadcast no espelho. Eventos fora do canal da partida
// (lobby, PING, formas desconhecidas) voltam o espelho intacto.
export function aplicarEventoNoEspelho(
  espelho: EspelhoDoBot,
  evento: unknown,
): EspelhoDoBot {
  if (typeof evento !== 'object' || evento === null) {
    return espelho;
  }
  const tipo = (evento as { type?: unknown }).type;
  if (typeof tipo !== 'string') {
    return espelho;
  }
  const estado = espelho.estado;
  const tab = estado.tabuleiro;
  switch (tipo) {
    case 'PECA_SELECIONADA': {
      const { pecaId } = evento as { pecaId: string };
      return comTabuleiro(espelho, { ...tab, pecaSelecionadaId: pecaId });
    }
    case 'PECA_DESELECIONADA': {
      const { pecaId } = evento as { pecaId: string };
      if (tab.pecaSelecionadaId !== pecaId) return espelho;
      return comTabuleiro(espelho, { ...tab, pecaSelecionadaId: null });
    }
    case 'PECA_GIRADA': {
      const { pecaId, orientacao } = evento as {
        pecaId: string;
        orientacao: 0 | 90 | 180 | 270;
      };
      return comTabuleiro(espelho, {
        ...tab,
        iniciais: tab.iniciais.map((peca) =>
          peca.pecaId === pecaId ? { ...peca, orientacao } : peca,
        ),
        recebidas: tab.recebidas.map((recebida) =>
          recebida.pecaId === pecaId ? { ...recebida, orientacao } : recebida,
        ),
        posicionadas: tab.posicionadas.map((peca) =>
          peca.pecaId === pecaId ? { ...peca, orientacao } : peca,
        ),
      });
    }
    case 'PECA_POSICIONADA': {
      const { pecaId, celula, orientacao } = evento as {
        pecaId: string;
        celula: { linha: number; coluna: number };
        orientacao: 0 | 90 | 180 | 270;
      };
      const inicial = tab.iniciais.find((peca) => peca.pecaId === pecaId);
      const recebida = tab.recebidas.find((item) => item.pecaId === pecaId);
      if (!inicial && !recebida) return espelho;
      const tipoDaPeca = inicial ? inicial.tipo : recebida!.tipo;
      const posicionada = {
        pecaId,
        tipo: tipoDaPeca,
        orientacao,
        celula: { ...celula },
      };
      // Peças Especiais e Monstros não abrem janela de Manipulação.
      const abreManipulacao =
        !ehPecaEspecial(tipoDaPeca) && !ehPecaDeMonstro(tipoDaPeca);
      return comTabuleiro(espelho, {
        ...tab,
        iniciais: tab.iniciais.filter((peca) => peca.pecaId !== pecaId),
        recebidas: tab.recebidas.filter((item) => item.pecaId !== pecaId),
        posicionadas: [...tab.posicionadas, posicionada],
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: abreManipulacao ? pecaId : null,
      });
    }
    case 'MANIPULACAO_FINALIZADA': {
      return comTabuleiro(espelho, { ...tab, pecaEmManipulacaoId: null });
    }
    case 'PEAO_SELECIONADO': {
      const { peaoId } = evento as { peaoId: string };
      return comTabuleiro(espelho, { ...tab, peaoSelecionadoId: peaoId });
    }
    case 'PEAO_DESELECIONADO': {
      const { peaoId } = evento as { peaoId: string };
      if (tab.peaoSelecionadoId !== peaoId) return espelho;
      return comTabuleiro(espelho, { ...tab, peaoSelecionadoId: null });
    }
    case 'PECA_SORTEADA': {
      // Cada sorteio consome uma ficha da Caixa opaca.
      return comTabuleiro(espelho, { ...tab, caixa: tab.caixa.slice(1) });
    }
    case 'RECEBIMENTO_GERADO': {
      const { recebidas } = evento as {
        recebidas: readonly {
          recebidaId: string;
          pecaId: string;
          tipoDaPeca:
            | 'reta'
            | 'T'
            | 'cruz'
            | 'gerador'
            | 'sala_do_diretor'
            | 'sala_medica'
            | 'portao_de_saida'
            | 'vulto'
            | 'espectro';
          orientacao: 0 | 90 | 180 | 270;
          vaga: 'norte' | 'leste' | 'sul' | 'oeste' | null;
          celulaAlvo: { linha: number; coluna: number } | null;
        }[];
      };
      return comTabuleiro(espelho, {
        ...tab,
        recebidas: recebidas.map((item) => ({
          recebidaId: item.recebidaId,
          pecaId: item.pecaId,
          tipo: item.tipoDaPeca,
          // A orientação nasce 0 na Caixa e viaja no evento desde o fix do
          // giro das Recebidas; o `?? 0` blinda contra payloads antigos sem o
          // campo (sem ele a expansão calculava sobre `undefined` e nunca
          // girava a Recebida).
          orientacao: item.orientacao ?? 0,
          vaga: item.vaga,
          celulaAlvo: item.celulaAlvo ? { ...item.celulaAlvo } : null,
        })),
      });
    }
    case 'PEAO_POSICIONADO': {
      const { peaoId, pecaId } = evento as {
        peaoId: string;
        pecaId: string;
      };
      return comTabuleiro(espelho, {
        ...tab,
        peoes: tab.peoes.map((peao) =>
          peao.peaoId === peaoId ? { ...peao, pecaId } : peao,
        ),
        peaoSelecionadoId: peaoId,
      });
    }
    case 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO': {
      const { recebidaId, borda, celulaAlvo } = evento as {
        recebidaId: string;
        borda: 'norte' | 'leste' | 'sul' | 'oeste';
        celulaAlvo: { linha: number; coluna: number };
      };
      const recebida = tab.recebidas.find(
        (item) => item.recebidaId === recebidaId,
      );
      return comTabuleiro(espelho, {
        ...tab,
        recebidas: tab.recebidas.map((item) =>
          item.recebidaId === recebidaId
            ? { ...item, vaga: borda, celulaAlvo: { ...celulaAlvo } }
            : item,
        ),
        pecaSelecionadaId: recebida ? recebida.pecaId : tab.pecaSelecionadaId,
      });
    }
    case 'PEAO_MOVIDO': {
      const { peaoId, pecaIdDe, pecaIdPara } = evento as {
        peaoId: string;
        pecaIdDe: string;
        pecaIdPara: string;
        celula: { linha: number; coluna: number };
      };
      let gracas = estado.pecasEmPeriodoDeGraca ?? [];
      if (pecaIdDe !== pecaIdPara && gracas.includes(pecaIdDe)) {
        gracas = gracas.filter((id) => id !== pecaIdDe);
      }
      gracas = podarGracasOrfas(tab.posicionadas, gracas);
      // O mover re-seleciona o Peão no engine (partida.ts, re-land da #263
      // pela #324) sem emitir peao_selecionado: o espelho segue a mesma
      // semântica (reducao.ts faz o mesmo no cliente). Zerar aqui
      // dessincronizava a FSM: com recebidas pendentes ela propunha
      // selecionar_peao, o engine aceitava idempotente SEM eventos e o
      // driver estourava o timeout de 8s desistindo do turno (rodada 2).
      return {
        ...espelho,
        estado: {
          ...estado,
          tabuleiro: {
            ...tab,
            peoes: tab.peoes.map((peao) =>
              peao.peaoId === peaoId ? { ...peao, pecaId: pecaIdPara } : peao,
            ),
            peaoSelecionadoId: peaoId,
          },
          pecasEmPeriodoDeGraca: gracas,
        },
      };
    }
    case 'PEAO_PERMANECEU': {
      return comTabuleiro(espelho, { ...tab, peaoSelecionadoId: null });
    }
    case 'ATRAVESSOU_O_ESCURO': {
      return {
        ...espelho,
        estado: { ...estado, atravessouNoTurno: true },
      };
    }
    case 'POSICAO_CONFIRMADA': {
      const { jogadorId, pecaId, protegido } = evento as {
        jogadorId: string;
        peaoId: string;
        pecaId: string;
        protegido: boolean;
      };
      const destino = tab.posicionadas.find((peca) => peca.pecaId === pecaId);
      let geradores = estado.geradoresLigados;
      if (
        destino?.tipo === 'gerador' &&
        !geradores.includes(destino.pecaId)
      ) {
        geradores = [...geradores, destino.pecaId];
      }
      const cartao =
        estado.cartaoDeAcessoObtido || destino?.tipo === 'sala_do_diretor';
      return {
        ...espelho,
        ultimaConfirmacao: {
          jogadorId,
          pecaId,
          emSalaMedica: destino?.tipo === 'sala_medica',
        },
        estado: {
          ...estado,
          posicaoConfirmada: true,
          geradoresLigados: geradores,
          cartaoDeAcessoObtido: cartao,
          jogadores: estado.jogadores.map((jogador) =>
            jogador.jogadorId === jogadorId
              ? { ...jogador, protegido }
              : jogador,
          ),
        },
      };
    }
    case 'CELULAS_ILUMINADAS': {
      const { celulas } = evento as {
        celulas: readonly { linha: number; coluna: number }[];
      };
      return {
        ...espelho,
        estado: {
          ...estado,
          celulasIluminadas: celulas.map((celula) => ({ ...celula })),
        },
      };
    }
    case 'LIMPEZA_APLICADA': {
      const { pecasRemovidas } = evento as {
        pecasRemovidas: readonly string[];
      };
      const removidas = new Set(pecasRemovidas);
      const posicionadas = tab.posicionadas.filter(
        (peca) => !removidas.has(peca.pecaId),
      );
      return {
        ...espelho,
        estado: {
          ...estado,
          tabuleiro: { ...tab, posicionadas },
          pecasEmPeriodoDeGraca: podarGracasOrfas(
            posicionadas,
            estado.pecasEmPeriodoDeGraca ?? [],
          ),
        },
      };
    }
    case 'ATAQUE_RESOLVIDO': {
      const { protegidos, estadosAplicados } = evento as {
        protegidos: readonly string[];
        estadosAplicados: readonly {
          jogadorId: string;
          emBaixaIluminacao: boolean;
          sanidade: number;
          amedrontado: boolean;
        }[];
      };
      const consumidos = new Set(protegidos);
      const resultantes = new Map(
        estadosAplicados.map((item) => [item.jogadorId, item] as const),
      );
      const ultima = espelho.ultimaConfirmacao;
      const jogadores = estado.jogadores.map((jogador) => {
        const resultante = resultantes.get(jogador.jogadorId);
        let proximo = resultante
          ? {
              ...jogador,
              emBaixaIluminacao: resultante.emBaixaIluminacao,
              sanidade: resultante.sanidade,
              amedrontado: resultante.amedrontado,
            }
          : jogador;
        // O escudo recém-concedido pela Sala Médica sobrevive ao consumo do
        // MESMO gatilho (a concessão vive após a resolução no domínio); nos
        // demais casos o consumo apaga.
        const blindado =
          ultima !== null &&
          ultima.emSalaMedica &&
          ultima.jogadorId === jogador.jogadorId;
        if (consumidos.has(jogador.jogadorId) && !blindado) {
          proximo = { ...proximo, protegido: false };
        }
        return proximo;
      });
      return {
        ...espelho,
        ultimaConfirmacao: null,
        estado: { ...estado, jogadores },
      };
    }
    case 'RESGATE_REALIZADO': {
      const { pecaId, resgatadoJogadorId } = evento as {
        pecaId: string;
        resgatadoJogadorId: string;
        resgatadorJogadorId: string;
        resgatadorPeaoId: string;
      };
      const gracas = (estado.pecasEmPeriodoDeGraca ?? []).includes(pecaId)
        ? (estado.pecasEmPeriodoDeGraca ?? [])
        : [...(estado.pecasEmPeriodoDeGraca ?? []), pecaId];
      return {
        ...espelho,
        estado: {
          ...estado,
          pecasEmPeriodoDeGraca: gracas,
          jogadores: estado.jogadores.map((jogador) => {
            if (jogador.jogadorId !== resgatadoJogadorId) return jogador;
            const eraAmedrontado =
              (jogador.amedrontado ?? jogador.sanidade === 0) === true;
            return {
              ...jogador,
              emBaixaIluminacao: false,
              amedrontado: false,
              sanidade: eraAmedrontado ? 1 : jogador.sanidade,
            };
          }),
        },
      };
    }
    case 'TURNO_ENCERRADO': {
      // O engine vira primeiroTurnoPendente em avancarVez sem emitir evento
      // para o campo (nenhum tipo no wire o carrega): quem encerrou o turno
      // necessariamente já atuou, então o espelho baixa o flag dele aqui. O
      // jogador pulado por Amedrontado nunca encerra turno e mantém o flag —
      // a semântica correta.
      const { jogadorId } = evento as { jogadorId?: unknown };
      return {
        ...espelho,
        ultimaConfirmacao: null,
        estado: {
          ...estado,
          jogadores:
            typeof jogadorId === 'string'
              ? estado.jogadores.map((jogador) =>
                  jogador.jogadorId === jogadorId
                    ? { ...jogador, primeiroTurnoPendente: false }
                    : jogador,
                )
              : estado.jogadores,
        },
      };
    }
    case 'TURNO_INICIADO': {
      const { jogadorId, rodada } = evento as {
        jogadorId: string;
        rodada: number;
      };
      const peaoDoNovo = tab.peoes.find(
        (peao) =>
          peao.peaoId ===
          estado.jogadores.find((j) => j.jogadorId === jogadorId)?.peaoId,
      );
      return {
        ultimaConfirmacao: null,
        estado: {
          ...estado,
          jogadorAtivoId: jogadorId,
          rodada,
          pecaDoInicioDoTurnoId: peaoDoNovo?.pecaId ?? null,
          posicaoConfirmada: false,
          atravessouNoTurno: false,
          tabuleiro: {
            ...tab,
            pecaSelecionadaId: null,
            pecaEmManipulacaoId: null,
            peaoSelecionadoId: null,
            recebidas: [],
          },
        },
      };
    }
    case 'PARTIDA_TERMINADA': {
      const { resultado, motivo } = evento as {
        resultado: 'vitoria' | 'derrota';
        motivo?: 'caixa_esgotada' | 'equipe_amedrontada' | null;
      };
      return {
        ...espelho,
        estado: {
          ...estado,
          resultado:
            resultado === 'vitoria'
              ? { tipo: 'vitoria' }
              : { tipo: 'derrota', motivo: motivo ?? 'caixa_esgotada' },
        },
      };
    }
    default:
      return espelho;
  }
}

function podarGracasOrfas(
  posicionadas: readonly { pecaId: string }[],
  gracas: readonly string[],
): string[] {
  if (gracas.length === 0) return [];
  const vivas = new Set(posicionadas.map((peca) => peca.pecaId));
  return gracas.filter((id) => vivas.has(id));
}

// --- Domínio → wire (reverso exato de game-server/partidas/wire.ts) --------

export function converterComandoParaWire(
  comando: ComandoDePartida,
  jogadorId: string,
): PartidaComandoDoCliente {
  switch (comando.tipo) {
    case 'selecionar_peca':
      return {
        type: 'SELECIONAR_PECA',
        jogadorId,
        pecaId: comando.pecaId,
      };
    case 'posicionar_peca':
      return {
        type: 'POSICIONAR_PECA',
        jogadorId,
        pecaId: comando.pecaId,
        celula: comando.celula,
      };
    case 'girar_peca':
      return {
        type: 'GIRAR_PECA',
        jogadorId,
        pecaId: comando.pecaId,
        sentido: comando.sentido,
      };
    case 'selecionar_peao':
      return {
        type: 'SELECIONAR_PEAO',
        jogadorId,
        peaoId: comando.peaoId,
      };
    case 'posicionar_peao':
      return {
        type: 'POSICIONAR_PEAO',
        jogadorId,
        peaoId: comando.peaoId,
        celula: comando.celula,
      };
    case 'escolher_vaga_da_peca_recebida':
      return {
        type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
        jogadorId,
        recebidaId: comando.recebidaId,
        borda: comando.borda,
      };
    case 'mover_peao':
      return {
        type: 'MOVER_PEAO',
        jogadorId,
        peaoId: comando.peaoId,
        celula: comando.celula,
      };
    case 'permanecer':
      return {
        type: 'PERMANECER',
        jogadorId,
        peaoId: comando.peaoId,
      };
    case 'confirmar_posicao_do_peao':
      return {
        type: 'CONFIRMAR_POSICAO_DO_PEAO',
        jogadorId,
        peaoId: comando.peaoId,
      };
    case 'encerrar_turno':
      return { type: 'ENCERRAR_TURNO', jogadorId };
    default:
      // O bot Random Walk nunca emite finalizar/desselecionar/atravessar;
      // falhar alto aqui impede vazar comando fora do plano.
      throw new Error(
        `Comando fora do plano do bot: ${(comando as ComandoDePartida).tipo}.`,
      );
  }
}

// --- Loop de turno ----------------------------------------------------------

export interface OpcoesDoJogadorBot {
  readonly jogadorId: string;
  readonly enviar: (comando: PartidaComandoDoCliente) => void;
  readonly log?: (...args: unknown[]) => void;
  readonly maxActionsPerTurn?: number;
  readonly intervaloDeQuiescenciaMs?: number;
  readonly timeoutDeRespostaMs?: number;
}

type EsperaPelaMutacao =
  | { resultado: 'lote' }
  | { resultado: 'erro'; codigo: string }
  | { resultado: 'timeout' };

// Driver do turno do bot sobre o espelho server-autoritativo. Transporte
// agnóstico: o script injeta `enviar` e alimenta `aoReceberSnapshot`,
// `aoReceberEvento` e `aoReceberErro` conforme o WS entrega.
export class JogadorBot {
  private readonly jogadorId: string;
  private readonly enviar: (comando: PartidaComandoDoCliente) => void;
  private readonly log: (...args: unknown[]) => void;
  private readonly tetoDeAcoes: number;
  private readonly quiescenciaMs: number;
  private readonly timeoutMs: number;
  private espelho: EspelhoDoBot | null = null;
  private turnoEmAndamento = false;
  private espera:
    | {
        resolver: (desfecho: EsperaPelaMutacao) => void;
        timerQuiescencia: ReturnType<typeof setTimeout> | null;
        timerTimeout: ReturnType<typeof setTimeout>;
      }
    | null = null;

  constructor(opcoes: OpcoesDoJogadorBot) {
    this.jogadorId = opcoes.jogadorId;
    this.enviar = opcoes.enviar;
    this.log = opcoes.log ?? (() => undefined);
    this.tetoDeAcoes =
      opcoes.maxActionsPerTurn ?? MAX_ACOES_POR_TURNO_DO_BOT;
    this.quiescenciaMs = opcoes.intervaloDeQuiescenciaMs ?? 250;
    this.timeoutMs = opcoes.timeoutDeRespostaMs ?? 8000;
  }

  // Snapshot da admissão (ou re-semeadura em reconexão): substitui o espelho
  // e libera qualquer espera em voo — o loop reconsulta e segue no estado
  // fresco, sem travar.
  aoReceberSnapshot(snapshot: EstadoDaPartidaSnapshot): void {
    this.espelho = espelhoInicial(adaptarSnapshotParaEspelho(snapshot));
    this.sinalizarAtividade();
  }

  // Um evento do broadcast: dobra no espelho; TURNO_INICIADO próprio com o
  // bot ocioso abre o turno.
  aoReceberEvento(evento: unknown): void {
    if (this.espelho !== null) {
      this.espelho = aplicarEventoNoEspelho(this.espelho, evento);
    }
    const tipo =
      typeof evento === 'object' && evento !== null
        ? (evento as { type?: unknown }).type
        : undefined;
    const ehMeuTurno =
      tipo === 'TURNO_INICIADO' &&
      (evento as { jogadorId?: unknown }).jogadorId === this.jogadorId;
    if (ehMeuTurno && !this.turnoEmAndamento) {
      if (this.espelho === null) {
        this.log('meu turno sem espelho (sem snapshot); turno perdido');
        return;
      }
      void this.executarTurno();
    } else {
      this.sinalizarAtividade();
    }
  }

  // Rejeição endereçada ao bot: resolve a espera como erro (o estado não
  // mudou — o servidor garante).
  aoReceberErro(codigo: string): void {
    const espera = this.espera;
    if (!espera) return;
    this.espera = null;
    if (espera.timerQuiescencia) clearTimeout(espera.timerQuiescencia);
    clearTimeout(espera.timerTimeout);
    espera.resolver({ resultado: 'erro', codigo });
  }

  private sinalizarAtividade(): void {
    const espera = this.espera;
    if (!espera) return;
    if (espera.timerQuiescencia) clearTimeout(espera.timerQuiescencia);
    espera.timerQuiescencia = setTimeout(() => {
      if (this.espera !== espera) return;
      this.espera = null;
      clearTimeout(espera.timerTimeout);
      espera.resolver({ resultado: 'lote' });
    }, this.quiescenciaMs);
  }

  private aguardarMutacao(): Promise<EsperaPelaMutacao> {
    return new Promise((resolver) => {
      const timerTimeout = setTimeout(() => {
        if (this.espera?.resolver !== resolver) return;
        const espera = this.espera;
        this.espera = null;
        if (espera?.timerQuiescencia) clearTimeout(espera.timerQuiescencia);
        resolver({ resultado: 'timeout' });
      }, this.timeoutMs);
      this.espera = { resolver, timerQuiescencia: null, timerTimeout };
      // Sem tráfego algum, só o timeout resolve — a quiescência arma no
      // primeiro sinal de atividade.
    });
  }

  private async executarTurno(): Promise<void> {
    if (this.turnoEmAndamento) return;
    const espelhoInicialDoTurno = this.espelho;
    if (espelhoInicialDoTurno === null) {
      this.log('turno sem espelho (sem snapshot); aguardando admissão');
      return;
    }
    this.turnoEmAndamento = true;
    try {
      this.log('meu turno; consultando a FSM');
      const rejeitados = new Set<string>();
      let acoes = 0;
      while (acoes < this.tetoDeAcoes) {
        const espelho = this.espelho;
        if (!espelho || espelho.estado.resultado !== null) return;
        if (espelho.estado.jogadorAtivoId !== this.jogadorId) return;
        const validas = acoesValidasDaSubfase(
          espelho.estado,
          this.jogadorId,
        ).filter((comando) => !rejeitados.has(JSON.stringify(comando)));
        if (validas.length === 0) break;
        const comando = sortearAcao(validas);
        // O posicionar sorteado vira a sequência de orientação + encaixe (0..2
        // GIRAR_PECA com conexão garantida + o POSICIONAR), como no loop puro
        // do engine — o espelho já dobra PECA_GIRADA.
        const sequencia =
          comando.tipo === 'posicionar_peca'
            ? expandirPosicionamentoDoBot(espelho.estado, comando)
            : [comando];
        acoes++;
        let reconsultar = false;
        for (const passo of sequencia) {
          this.enviar(converterComandoParaWire(passo, this.jogadorId));
          const desfecho = await this.aguardarMutacao();
          if (desfecho.resultado === 'timeout') {
            this.log(
              `sem confirmação da mutação em ${this.timeoutMs}ms; desistindo do turno`,
            );
            return;
          }
          if (desfecho.resultado === 'erro') {
            if (desfecho.codigo === 'FORA_DA_VEZ') {
              this.log('vez perdida (FORA_DA_VEZ); encerrando o loop');
              return;
            }
            if (desfecho.codigo === 'PARTIDA_TERMINADA') {
              this.log('partida terminada; encerrando o loop');
              return;
            }
            // Rejeição sem mudança de estado: exclui o candidato e reconsulta.
            this.log(`recusado (${desfecho.codigo}); tentando outra ação`);
            rejeitados.add(JSON.stringify(comando));
            reconsultar = true;
            break;
          }
        }
        if (reconsultar) {
          continue;
        }
      }
      // Failsafe: força o encerrar_turno; se a engine o rejeitar, loga e
      // desiste do turno, sem contorno.
      const espelho = this.espelho;
      if (
        !espelho ||
        espelho.estado.resultado !== null ||
        espelho.estado.jogadorAtivoId !== this.jogadorId
      ) {
        return;
      }
      this.log('failsafe: forçando ENCERRAR_TURNO');
      this.enviar({ type: 'ENCERRAR_TURNO', jogadorId: this.jogadorId });
      const desfecho = await this.aguardarMutacao();
      if (desfecho.resultado === 'erro') {
        this.log(
          `failsafe recusado (${desfecho.codigo}); desistindo do turno`,
        );
      }
    } finally {
      this.turnoEmAndamento = false;
    }
  }
}
