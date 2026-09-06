// Handlers WS do Tabuleiro e do ciclo de Peões (issues #80 e #88).
//
// Roteia os comandos wire de tabuleiro e de Peões (`@flicker/shared`) para o
// domínio (`@flicker/engine`) via `aplicarComandoDeTabuleiro`, persiste o
// novo estado no Redis e faz broadcast dos eventos traduzidos. No primeiro
// posicionamento do Peão (sobre a Peça Inicial) o handler compõe também o
// Recebimento — gera as pendências via `gerarRecebidas` e mantém o Peão
// selecionado para a sequência (seam intermediário, substituído pelo canal de
// Partida do #117). Rejeições do domínio (e comandos inválidos) são roteadas
// ao originador com `ERRO_DO_TABULEIRO`, usando o `codigo` fechado do domínio.
// As mutações são serializadas por `partidaId` para evitar lost-update no
// read-modify-write do Redis.

import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import {
  aplicarComandoDeTabuleiro,
  gerarRecebidas,
  type CodigoDeErroDeTabuleiro,
  type ComandoDeTabuleiro,
} from '@flicker/engine';
import type { CodigoDeErroDoTabuleiro } from '@flicker/shared';
import { PartidaBroadcaster } from '../partidas/broadcast.ts';
import { ehComandoDoTabuleiro, type ComandoDoTabuleiroAceito } from './validacao.ts';
import { traduzirEventos } from '../partidas/traducao.ts';
import {
  obterEstadoDoTabuleiro,
  salvarEstadoDoTabuleiro,
} from '../partidas/tabuleiro.ts';

export interface TabuleiroHandlersDeps {
  readonly redis: Redis;
  readonly broadcaster: PartidaBroadcaster;
}

export class TabuleiroHandlers {
  private readonly redis: Redis;
  private readonly broadcaster: PartidaBroadcaster;
  // Serialização mononodo: uma cadeia de promessas por partidaId.
  private readonly cadeiasPorPartida: Map<string, Promise<unknown>> = new Map();

  constructor(deps: TabuleiroHandlersDeps) {
    this.redis = deps.redis;
    this.broadcaster = deps.broadcaster;
  }

  /**
   * Despacho principal chamado por `ws.ts` em `'message'`. Espera uma
   * mensagem já parseada. Comandos fora do conjunto fechado (validados por
   * `ehComandoDoTabuleiro`) viram `ERRO_DO_TABULEIRO { DADOS_INVALIDOS }`.
   * Erros inesperados viram `ERRO_DO_TABULEIRO` genérico + `console.error`.
   */
  async aplicarMensagem(
    socket: WebSocket,
    partidaId: string,
    mensagem: unknown,
  ): Promise<void> {
    if (!ehComandoDoTabuleiro(mensagem)) {
      this.broadcaster.enviarParaSocket(socket, {
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'DADOS_INVALIDOS',
        mensagem: 'Comando fora do escopo do tabuleiro.',
      });
      return;
    }

    await this.enfileirarMutacao(partidaId, async () => {
      const estado = await obterEstadoDoTabuleiro(this.redis, partidaId);
      if (estado === null) {
        // Partida expirada/cancelada (falha de ciclo de vida) — distinto de
        // dado do cliente inválido. Código próprio, não DADOS_INVALIDOS.
        this.broadcaster.enviarParaSocket(socket, {
          type: 'ERRO_DO_TABULEIRO',
          codigo: 'ESTADO_INDISPONIVEL',
          mensagem: 'Estado do tabuleiro não encontrado para a partida.',
        });
        return;
      }

      const comando = mapearComando(mensagem);
      const resultado = aplicarComandoDeTabuleiro(estado, comando);
      if (!resultado.sucesso) {
        this.broadcaster.enviarParaSocket(socket, {
          type: 'ERRO_DO_TABULEIRO',
          codigo: paraCodigoDoTabuleiroWire(resultado.erro.codigo),
          mensagem: resultado.erro.mensagem,
        });
        return;
      }

      // Primeiro posicionamento do Peão: após o encaixe aceito sobre a Peça
      // Inicial, compõe o Recebimento (gerarRecebidas sobre a Peça recém-
      // ocupada) e mantém o Peão selecionado para a sequência — espelha
      // `posicionarPeaoDaPartida` do Primeiro Turno em partida.ts (#117).
      // Desde a #138 o Recebimento sorteia as peças da Caixa (peca_sorteada
      // por peça) e cria as pendências sem vaga.
      let novoEstado = resultado.estado;
      const eventos = [...resultado.eventos];
      if (comando.tipo === 'posicionar_peao') {
        const peao = resultado.estado.peoes.find(
          (item) => item.peaoId === comando.peaoId,
        );
        const peca = peao?.pecaId
          ? resultado.estado.posicionadas.find((item) => item.pecaId === peao.pecaId)
          : undefined;
        const sorteio = peca
          ? gerarRecebidas(resultado.estado, peca)
          : { estado: resultado.estado, recebidas: [], eventos: [] };
        novoEstado = {
          ...sorteio.estado,
          peaoSelecionadoId: comando.peaoId,
          recebidas: sorteio.recebidas,
        };
        eventos.push(...sorteio.eventos);
        if (sorteio.recebidas.length > 0) {
          eventos.push({
            tipo: 'recebimento_gerado',
            recebidas: sorteio.recebidas.map(
              ({ recebidaId, pecaId, tipo, vaga, celulaAlvo }) => ({
                recebidaId,
                pecaId,
                tipoDaPeca: tipo,
                vaga,
                celulaAlvo,
              }),
            ),
          });
        }
      }

      await salvarEstadoDoTabuleiro(this.redis, partidaId, novoEstado);
      this.broadcaster.enviar(partidaId, ...traduzirEventos(eventos));
    }).catch((erro: unknown) => {
      console.error('[tabuleiro] erro inesperado ao processar comando:', erro);
      this.broadcaster.enviarParaSocket(socket, {
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'DADOS_INVALIDOS',
        mensagem: 'Erro interno ao processar comando do tabuleiro.',
      });
    });
  }

  /**
   * Enfileira a mutação na cadeia da partida. A cadeia ignora a falha de uma
   * mutação anterior para não bloquear as seguintes, mas o erro da mutação
   * atual é propagado para o `catch` de `aplicarMensagem`.
   */
  private enfileirarMutacao(partidaId: string, fn: () => Promise<void>): Promise<void> {
    const anterior = this.cadeiasPorPartida.get(partidaId) ?? Promise.resolve();
    const proxima = anterior.catch(() => undefined).then(fn);
    this.cadeiasPorPartida.set(partidaId, proxima);
    void proxima.then(
      () => this.limparCadeia(partidaId, proxima),
      () => this.limparCadeia(partidaId, proxima),
    );
    return proxima;
  }

  private limparCadeia(partidaId: string, proxima: Promise<unknown>): void {
    if (this.cadeiasPorPartida.get(partidaId) === proxima) {
      this.cadeiasPorPartida.delete(partidaId);
    }
  }
}

/**
 * Mapeia wire (UPPER_SNAKE) → domínio (snake), tanto para comandos de
 * tabuleiro quanto para o ciclo de Peões. Campos em camelCase são idênticos.
 * A entrada já foi estreitada por `ehComandoDoTabuleiro` (o comando legado de
 * escolha de tipo, fora do domínio desde a #138, não chega aqui).
 */
function mapearComando(
  comando: ComandoDoTabuleiroAceito,
): ComandoDeTabuleiro {
  switch (comando.type) {
    case 'SELECIONAR_PECA':
      return { tipo: 'selecionar_peca', pecaId: comando.pecaId };
    case 'GIRAR_PECA':
      return { tipo: 'girar_peca', pecaId: comando.pecaId, sentido: comando.sentido };
    case 'POSICIONAR_PECA':
      return { tipo: 'posicionar_peca', pecaId: comando.pecaId, celula: comando.celula };
    case 'FINALIZAR_MANIPULACAO':
      return { tipo: 'finalizar_manipulacao' };
    case 'SELECIONAR_PEAO':
      return { tipo: 'selecionar_peao', peaoId: comando.peaoId };
    case 'POSICIONAR_PEAO':
      return { tipo: 'posicionar_peao', peaoId: comando.peaoId, celula: comando.celula };
    case 'ESCOLHER_VAGA_DA_PECA_RECEBIDA':
      return {
        tipo: 'escolher_vaga_da_peca_recebida',
        recebidaId: comando.recebidaId,
        borda: comando.borda,
      };
    case 'MOVER_PEAO':
      return { tipo: 'mover_peao', peaoId: comando.peaoId, celula: comando.celula };
    case 'PERMANECER':
      return { tipo: 'permanecer', peaoId: comando.peaoId };
    default: {
      // Exaustividade: um novo `type` sem case falha a compilação; em runtime
      // a entrada já foi validada por `ehComandoDoTabuleiro`.
      const _exaustivo: never = comando;
      return _exaustivo;
    }
  }
}

// Conjunto fechado dos códigos do domínio que pertencem ao contrato wire do
// tabuleiro (issues #80 e #88): os códigos de Peças do #80, os do ciclo de
// Peões/Recebimento do #88 e o da Caixa da ST-12 (#144). Qualquer código fora
// deste conjunto (ex.: códigos do canal de Partida do #117, fora do escopo)
// é normalizado para DADOS_INVALIDOS para nunca vazar um código fora do
// contrato.
const CODIGOS_DO_TABULEIRO_WIRE: ReadonlySet<string> = new Set([
  'DADOS_INVALIDOS',
  'ESTADO_INDISPONIVEL',
  'PECA_NAO_ENCONTRADA',
  'PECA_NAO_SELECIONADA',
  'CAIXA_ESGOTADA',
  'CELULA_NAO_ENCONTRADA',
  'CELULA_JA_OCUPADA',
  'PECA_JA_POSICIONADA',
  'MANIPULACAO_ENCERRADA',
  'PEAO_NAO_ENCONTRADO',
  'PEAO_JA_POSICIONADO',
  'PEAO_NAO_SELECIONADO',
  'PECA_INICIAL_EXIGIDA',
  'CELULA_SEM_PECA',
  'PECA_JA_TEM_PEAO',
  'PENDENCIA_NAO_RESOLVIDA',
  'MOVIMENTO_NAO_CONECTADO',
  'PECA_NAO_RECEBIDA',
  'PECA_FORA_DO_ALVO',
  'RECEBIDA_NAO_ENCONTRADA',
]);

function paraCodigoDoTabuleiroWire(codigo: CodigoDeErroDeTabuleiro): CodigoDeErroDoTabuleiro {
  return CODIGOS_DO_TABULEIRO_WIRE.has(codigo)
    ? (codigo as CodigoDeErroDoTabuleiro)
    : 'DADOS_INVALIDOS';
}
