// Handlers WS do Tabuleiro (issue #80).
//
// Roteia os 4 comandos wire (`@flicker/shared`) para o domínio
// (`@flicker/engine`) via `aplicarComandoDeTabuleiro`, persiste o novo estado
// no Redis e faz broadcast dos eventos traduzidos. Rejeições do domínio (e
// comandos inválidos) são roteadas ao originador com `ERRO_DO_TABULEIRO`,
// usando o `codigo` fechado do domínio. As mutações são serializadas por
// `partidaId` para evitar lost-update no read-modify-write do Redis.

import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import {
  aplicarComandoDeTabuleiro,
  type CodigoDeErroDeTabuleiro,
  type ComandoDeTabuleiro,
} from '@flicker/engine';
import type {
  CodigoDeErroDoTabuleiro,
  TabuleiroComandoDoCliente,
} from '@flicker/shared';
import { TabuleiroBroadcaster } from './broadcast.ts';
import { ehComandoDoTabuleiro } from './validacao.ts';
import { traduzirEventos } from './traducao.ts';
import {
  obterEstadoDoTabuleiro,
  salvarEstadoDoTabuleiro,
} from '../partidas/tabuleiro.ts';

export interface TabuleiroHandlersDeps {
  readonly redis: Redis;
  readonly broadcaster: TabuleiroBroadcaster;
}

export class TabuleiroHandlers {
  private readonly redis: Redis;
  private readonly broadcaster: TabuleiroBroadcaster;
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
        this.broadcaster.enviarParaSocket(socket, {
          type: 'ERRO_DO_TABULEIRO',
          codigo: 'DADOS_INVALIDOS',
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

      await salvarEstadoDoTabuleiro(this.redis, partidaId, resultado.estado);
      this.broadcaster.enviar(partidaId, ...traduzirEventos(resultado.eventos));
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

/** Mapeia wire (UPPER_SNAKE) → domínio (snake). Campos em camelCase são idênticos. */
function mapearComando(comando: TabuleiroComandoDoCliente): ComandoDeTabuleiro {
  switch (comando.type) {
    case 'SELECIONAR_PECA':
      return { tipo: 'selecionar_peca', pecaId: comando.pecaId };
    case 'GIRAR_PECA':
      return { tipo: 'girar_peca', pecaId: comando.pecaId, sentido: comando.sentido };
    case 'POSICIONAR_PECA':
      return { tipo: 'posicionar_peca', pecaId: comando.pecaId, celula: comando.celula };
    case 'FINALIZAR_MANIPULACAO':
      return { tipo: 'finalizar_manipulacao' };
    default: {
      // Exaustividade: um novo `type` sem case falha a compilação; em runtime
      // a entrada já foi validada por `ehComandoDoTabuleiro`.
      const _exaustivo: never = comando;
      return _exaustivo;
    }
  }
}

// Conjunto fechado dos códigos do domínio que pertencem ao contrato wire do
// tabuleiro (issue #80). O domínio (`@flicker/engine`) tem códigos extras do
// ST-10 (Peões/Recebimento) que não são alcançáveis pelos 4 comandos do #80;
// qualquer código fora deste conjunto é normalizado para DADOS_INVALIDOS para
// nunca vazar um código fora do contrato.
const CODIGOS_DO_TABULEIRO_WIRE: ReadonlySet<string> = new Set([
  'DADOS_INVALIDOS',
  'PECA_NAO_ENCONTRADA',
  'PECA_NAO_SELECIONADA',
  'RESERVA_ESGOTADA',
  'CELULA_NAO_ENCONTRADA',
  'CELULA_JA_OCUPADA',
  'PECA_JA_POSICIONADA',
  'MANIPULACAO_ENCERRADA',
]);

function paraCodigoDoTabuleiroWire(codigo: CodigoDeErroDeTabuleiro): CodigoDeErroDoTabuleiro {
  return CODIGOS_DO_TABULEIRO_WIRE.has(codigo)
    ? (codigo as CodigoDeErroDoTabuleiro)
    : 'DADOS_INVALIDOS';
}
