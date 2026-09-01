// Handlers WS do canal de Partida (issue #117).
//
// Roteia os 11 comandos wire de Partida (`@flicker/shared`) para o domínio
// (`@flicker/engine`) via `aplicarComandoDePartida`, persiste o novo estado
// (tabuleiro + Turnos) no Redis e faz broadcast dos eventos traduzidos. O
// ator do dispatch é a sessão autenticada do socket (passada por `ws.ts` como
// `sessaoJogadorId`), não o `jogadorId` autodeclarado no wire: um comando cujo
// `jogadorId` divirja da sessão é rejeitado como impersonation (#135). O
// `jogadorId` do wire apenas precisa coincidir com a sessão — ele segue sendo
// usado como ator no dispatch já com a igualdade garantida (contrato do ST-11).
// Rejeições do domínio e comandos fora do contrato (incluindo
// o wire legacy de tabuleiro/Peões sem `jogadorId`) são roteadas ao
// originador com `ERRO_DO_TABULEIRO`, usando o `codigo` fechado do domínio.
// As mutações são serializadas por `partidaId` para evitar lost-update no
// read-modify-write do Redis.

import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { aplicarComandoDePartida } from '@flicker/engine';
import { PartidaBroadcaster } from './broadcast.ts';
import { traduzirEventos } from './traducao.ts';
import {
  ehComandoDaPartida,
  mapearComandoDaPartida,
  paraCodigoDaPartidaWire,
} from './wire.ts';
import {
  obterEstadoDaPartida,
  salvarEstadoDaPartida,
} from './estado.ts';

export interface PartidaHandlersDeps {
  readonly redis: Redis;
  readonly broadcaster: PartidaBroadcaster;
}

export class PartidaHandlers {
  private readonly redis: Redis;
  private readonly broadcaster: PartidaBroadcaster;
  // Serialização mononodo: uma cadeia de promessas por partidaId.
  private readonly cadeiasPorPartida: Map<string, Promise<unknown>> = new Map();

  constructor(deps: PartidaHandlersDeps) {
    this.redis = deps.redis;
    this.broadcaster = deps.broadcaster;
  }

  /**
   * Despacho principal chamado por `ws.ts` em `'message'`. Espera a mensagem
   * já parseada e o `sessaoJogadorId` (a sessão autenticada do socket). A
   * guarda `ehComandoDaPartida` confere o contrato de forma; depois uma checagem
   * de impersonation garante que o `jogadorId` do wire coincide com a sessão,
   * rejeitando o comando com `ERRO_DO_TABULEIRO { DADOS_INVALIDOS }` caso
   * divirjam. Comandos fora do conjunto fechado também viram
   * `ERRO_DO_TABULEIRO { DADOS_INVALIDOS }`. Erros inesperados viram
   * `ERRO_DO_TABULEIRO` genérico + `console.error`.
   */
  async aplicarMensagem(
    socket: WebSocket,
    partidaId: string,
    sessaoJogadorId: string,
    mensagem: unknown,
  ): Promise<void> {
    if (!ehComandoDaPartida(mensagem)) {
      this.broadcaster.enviarParaSocket(socket, {
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'DADOS_INVALIDOS',
        mensagem: 'Comando fora do escopo da partida.',
      });
      return;
    }

    // Impersonation: a guarda acima confirma que é um comando válido de forma,
    // mas o ator do dispatch precisa ser a sessão autenticada (`sessaoJogadorId`),
    // não o `jogadorId` autodeclarado no wire. Se divergirem, rejeita antes de
    // enfileirar/mapear/dispachar para não deixar o cliente se passar por outro.
    if (mensagem.jogadorId !== sessaoJogadorId) {
      this.broadcaster.enviarParaSocket(socket, {
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'DADOS_INVALIDOS',
        mensagem: 'Ator do comando não corresponde à sessão.',
      });
      return;
    }

    await this.enfileirarMutacao(partidaId, async () => {
      const estado = await obterEstadoDaPartida(this.redis, partidaId);
      if (estado === null) {
        // Partida expirada/cancelada (falha de ciclo de vida) — distinto de
        // dado do cliente inválido. Código próprio, não DADOS_INVALIDOS.
        this.broadcaster.enviarParaSocket(socket, {
          type: 'ERRO_DO_TABULEIRO',
          codigo: 'ESTADO_INDISPONIVEL',
          mensagem: 'Estado da partida não encontrado para a partida.',
        });
        return;
      }

      const comando = mapearComandoDaPartida(mensagem);
      // Ator = jogadorId do wire, que já foi validado como igual à sessão na
      // guarda de impersonation acima; manter o jogadorId do wire (que o
      // contrato ST-11 já carrega para o broadcast) é consistente.
      const resultado = aplicarComandoDePartida(estado, comando, mensagem.jogadorId);
      if (!resultado.sucesso) {
        this.broadcaster.enviarParaSocket(socket, {
          type: 'ERRO_DO_TABULEIRO',
          codigo: paraCodigoDaPartidaWire(resultado.erro.codigo),
          mensagem: resultado.erro.mensagem,
        });
        return;
      }

      await salvarEstadoDaPartida(this.redis, partidaId, resultado.estado);
      this.broadcaster.enviar(partidaId, ...traduzirEventos(resultado.eventos));
    }).catch((erro: unknown) => {
      console.error('[partida] erro inesperado ao processar comando:', erro);
      this.broadcaster.enviarParaSocket(socket, {
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'DADOS_INVALIDOS',
        mensagem: 'Erro interno ao processar comando da partida.',
      });
    });
  }

  /**
   * Anuncia ao socket recém-admitido o turno corrente da partida
   * (`TURNO_INICIADO`) e, se houver iluminação estabelecida, replaya
   * `CELULAS_ILUMINADAS` em unicast (gap renato: tardio nunca recebia fog).
   * Ordem garantida: TURNO_INICIADO → CELULAS_ILUMINADAS (se houver).
   * Só envia celulas (não posicionadas) para não vazar fog; sem regravar o estado.
   * Chamado como `void` em `ws.ts:224` (fire-and-forget) — envio síncrono via
   * broadcaster, não requer await.
   * Se o estado não existir (partida expirada/cancelada), nada é enviado.
   */
  async anunciarTurnoAtual(partidaId: string, socket: WebSocket): Promise<void> {
    try {
      const estado = await obterEstadoDaPartida(this.redis, partidaId);
      if (estado === null) {
        return;
      }
      this.broadcaster.enviarParaSocket(socket, {
        type: 'TURNO_INICIADO',
        jogadorId: estado.jogadorAtivoId,
        rodada: estado.rodada,
      });
      if (estado.celulasIluminadas.length > 0) {
        this.broadcaster.enviarParaSocket(socket, {
          type: 'CELULAS_ILUMINADAS',
          celulas: estado.celulasIluminadas,
        });
      }
    } catch (erro: unknown) {
      console.error('[partida] erro ao anunciar turno atual:', erro);
    }
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