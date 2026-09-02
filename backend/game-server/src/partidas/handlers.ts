// Handlers WS do canal de Partida (issue #117).
//
// Roteia os 11 comandos wire de Partida (`@flicker/shared`) para o domínio
// (`@flicker/engine`) via `aplicarComandoDePartida`, persiste o novo estado
// (tabuleiro + Turnos) no Redis e faz broadcast dos eventos traduzidos. O
// ator do dispatch é sempre a sessão autenticada do socket (passada por
// `ws.ts` como `sessaoJogadorId`), nunca o `jogadorId` autodeclarado no wire:
// o campo permanece obrigatório no contrato (guarda de forma) mas é vestigial
// no dispatch — um comando cujo `jogadorId` do wire divirja da sessão é
// aceito e aplicado como a sessão (issue #155), então o broadcast carrega a
// identidade da Sessão por construção. Rejeições do domínio e comandos fora
// do contrato (incluindo
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
  aplicarRetencaoDeTermino,
  obterEstadoDaPartida,
  salvarEstadoDaPartida,
} from './estado.ts';
import { obterPartida, type PartidaPreparada } from './partidas.ts';
import type { AvisoDeRetorno } from '../retorno/cliente.ts';
import { sleep } from '../utils/sleep.ts';

export interface PartidaHandlersDeps {
  readonly redis: Redis;
  readonly broadcaster: PartidaBroadcaster;
  readonly partidaTerminadaTtlSegundos?: number;
  readonly notificarRetorno?: (aviso: AvisoDeRetorno) => Promise<void>;
}

export class PartidaHandlers {
  private readonly redis: Redis;
  private readonly broadcaster: PartidaBroadcaster;
  private readonly partidaTerminadaTtlSegundos: number;
  private readonly notificarRetorno?: (aviso: AvisoDeRetorno) => Promise<void>;
  // Serialização mononodo: uma cadeia de promessas por partidaId.
  private readonly cadeiasPorPartida: Map<string, Promise<unknown>> = new Map();
  private readonly retornosPendentes: Map<string, Promise<void>> = new Map();
  private readonly callbacksEnviados: Set<string> = new Set();

  constructor(deps: PartidaHandlersDeps) {
    this.redis = deps.redis;
    this.broadcaster = deps.broadcaster;
    this.partidaTerminadaTtlSegundos = deps.partidaTerminadaTtlSegundos ?? 3600;
    this.notificarRetorno = deps.notificarRetorno;
  }

  /**
   * Despacho principal chamado por `ws.ts` em `'message'`. Espera a mensagem
   * já parseada e o `sessaoJogadorId` (a sessão autenticada do socket). A
   * guarda `ehComandoDaPartida` confere o contrato de forma; o ator do
   * dispatch é sempre a sessão — o `jogadorId` do wire é vestigial (#155) e
   * comandos com `jogadorId` alheio são aplicados como a sessão. Comandos
   * fora do conjunto fechado viram `ERRO_DO_TABULEIRO { DADOS_INVALIDOS }`.
   * Erros inesperados viram `ERRO_DO_TABULEIRO` genérico + `console.error`.
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

      // Captura antecipada dos metadados da partida para fallback do callback (B1).
      let partidaPrevia: import('./partidas.ts').PartidaPreparada | null = null;
      if (this.notificarRetorno !== undefined) {
        try {
          partidaPrevia = await obterPartida(this.redis, partidaId);
        } catch {
          partidaPrevia = null;
        }
      }

      const comando = mapearComandoDaPartida(mensagem);
      // Ator = sessão autenticada do socket (#155): o `jogadorId` do wire é
      // vestigial no dispatch, então o broadcast carrega a identidade da
      // Sessão mesmo quando o cliente declara outro `jogadorId`.
      const resultado = aplicarComandoDePartida(estado, comando, sessaoJogadorId);
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

      const termino = resultado.eventos.find((evento) => evento.tipo === 'partida_terminada');
      if (termino?.tipo === 'partida_terminada') {
        let aviso: AvisoDeRetorno | undefined;
        if (this.notificarRetorno !== undefined) {
          let partida: import('./partidas.ts').PartidaPreparada | null = null;
          for (let tentativa = 0; tentativa < 3; tentativa += 1) {
            try {
              partida = await obterPartida(this.redis, partidaId);
              if (partida !== null) break;
            } catch {
              partida = null;
            }
            if (partida === null && tentativa < 2) {
              await sleep(100 * 2 ** tentativa);
            }
          }
          if (partida === null && partidaPrevia !== null) {
            console.warn('[partida] usando metadados prévios para callback de retorno', { partidaId });
            partida = partidaPrevia;
          }
          if (partida === null) {
            console.error('[partida] não foi possível preparar callback de retorno após retries', { partidaId });
            if (this.retornosPendentes.has(partidaId) || this.callbacksEnviados.has(partidaId)) return;
            const atrasoMs = 1000;
            setTimeout(() => {
              void this.enfileirarMutacao(partidaId, async () => {
                if (this.retornosPendentes.has(partidaId) || this.callbacksEnviados.has(partidaId)) return;
                let partidaReagendada: PartidaPreparada | null = null;
                try {
                  partidaReagendada = await obterPartida(this.redis, partidaId);
                } catch {}
                if (partidaReagendada === null && partidaPrevia !== null) {
                  partidaReagendada = partidaPrevia;
                }
                if (partidaReagendada === null || this.notificarRetorno === undefined) return;
                const avisoReagendado = this.montarAviso(partidaReagendada, termino.desfecho.tipo);
                this.callbacksEnviados.add(partidaId);
                const promessa = this.notificarRetorno(avisoReagendado).catch((erro: unknown) => {
                  console.error('[partida] callback de retorno reagendado terminou com erro', { partidaId, erro });
                });
                this.rastrearRetorno(partidaId, promessa);
              }).catch(() => undefined);
            }, atrasoMs).unref?.();
          } else {
            if (this.callbacksEnviados.has(partidaId)) return;
            aviso = this.montarAviso(partida, termino.desfecho.tipo);
            this.callbacksEnviados.add(partidaId);
          }
        }

        try {
          await aplicarRetencaoDeTermino(
            this.redis,
            partidaId,
            this.partidaTerminadaTtlSegundos,
          );
        } catch (erro: unknown) {
          console.error('[partida] falha ao aplicar retenção do término', {
            partidaId,
            ttlSegundos: this.partidaTerminadaTtlSegundos,
            erro,
          });
        }

        if (aviso !== undefined && this.notificarRetorno !== undefined) {
          const promessa = this.notificarRetorno(aviso).catch((erro: unknown) => {
            console.error('[partida] callback de retorno terminou com erro', {
              partidaId,
              erro,
            });
          });
          this.rastrearRetorno(partidaId, promessa);
        }
      }
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

  private montarAviso(partida: PartidaPreparada, resultado: 'vitoria' | 'derrota'): AvisoDeRetorno {
    return {
      salaId: partida.salaId,
      partidaId: partida.partidaId,
      serverId: partida.serverId,
      resultado,
      jogadores: partida.roster.map((m) => m.jogadorId),
    };
  }

  private rastrearRetorno(partidaId: string, promessa: Promise<void>): void {
    this.retornosPendentes.set(partidaId, promessa);
    void promessa.finally(() => {
      if (this.retornosPendentes.get(partidaId) === promessa) {
        this.retornosPendentes.delete(partidaId);
      }
    });
  }

  async drenarRetornosPendentes(timeoutMs = 5000): Promise<void> {
    const pendentes = [...this.retornosPendentes.values()];
    if (pendentes.length === 0) return;
    await Promise.race([
      Promise.allSettled(pendentes),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  }

  private limparCadeia(partidaId: string, proxima: Promise<unknown>): void {
    if (this.cadeiasPorPartida.get(partidaId) === proxima) {
      this.cadeiasPorPartida.delete(partidaId);
    }
  }
}
