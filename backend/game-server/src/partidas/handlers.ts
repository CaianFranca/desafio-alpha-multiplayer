// Handlers WS do canal de Partida (issue #117).
//
// Roteia os 14 comandos wire de Partida (`@flicker/shared`) para o domínio
// (`@flicker/engine`) via `aplicarComandoDePartida`, persiste o novo estado
// (tabuleiro + Turnos) no Redis e faz broadcast dos eventos traduzidos —
// incluindo a desistência (issue #288), cujo efeito atômico do engine
// (remoção do peão, exclusão da vez com Passagem imediata se era o Ativo,
// Iluminação, Limpeza e reavaliação do término em N−1 num único lote) viaja
// integral no broadcast, com o término em N−1 reutilizando a retenção e o
// callback de Retorno existentes. O
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
import { aplicarComandoDePartida, type EventoDaPartida } from '@flicker/engine';
import { PartidaBroadcaster } from './broadcast.ts';
import { traduzirEventos } from './traducao.ts';
import type { DebugStreamDaPartida } from '../ws/debug-stream.ts';
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
import { chaveDoRetornoPendente } from './chaves.ts';
import { obterPartida, type PartidaPreparada } from './partidas.ts';
import type { AvisoDeRetorno, AvisoDeDesistencia } from '../retorno/cliente.ts';
import { sleep } from '../utils/sleep.ts';

export interface PartidaHandlersDeps {
  readonly redis: Redis;
  readonly broadcaster: PartidaBroadcaster;
  readonly partidaTerminadaTtlSegundos?: number;
  readonly notificarRetorno?: (aviso: AvisoDeRetorno) => Promise<void>;
  /**
   * Desvinculação imediata do desistente no lobby (issue #290): a cada
   * `desistencia_registrada` o lobby remove SÓ o desistente da sala
   * `encaminhada` para que ele possa criar/entrar em outra sala na hora.
   * Best-effort com retry (nunca falha a desistência).
   */
  readonly notificarDesistencia?: (aviso: AvisoDeDesistencia) => Promise<void>;
  /**
   * Teto por desistente no detach antes do retorno (issue #290, R1): evita a
   * cadeia travar para sempre com o lobby fora do ar (o cliente de desistência
   * tem retry infinito). Injetável nos testes.
   */
  readonly tetoDesvinculoMs?: number;
  /** Stream de debug (issue #340). Opcional: sem o campo, nenhuma linha é espelhada. */
  readonly debug?: DebugStreamDaPartida;
}

export class PartidaHandlers {
  private readonly redis: Redis;
  private readonly broadcaster: PartidaBroadcaster;
  private readonly partidaTerminadaTtlSegundos: number;
  private readonly notificarRetorno?: (aviso: AvisoDeRetorno) => Promise<void>;
  private readonly notificarDesistencia?: (aviso: AvisoDeDesistencia) => Promise<void>;
  private readonly tetoDesvinculoMs: number;
  private readonly debug?: DebugStreamDaPartida;
  // Serialização mononodo: uma cadeia de promessas por partidaId.
  private readonly cadeiasPorPartida: Map<string, Promise<unknown>> = new Map();
  private readonly retornosPendentes: Map<string, Promise<void>> = new Map();
  // Detaches em voo (nunca contam para o dedup do retorno — só para o drain).
  private readonly desvinculosPendentes: Map<string, Set<Promise<void>>> = new Map();
  private readonly callbacksEnviados: Set<string> = new Set();

  constructor(deps: PartidaHandlersDeps) {
    this.redis = deps.redis;
    this.broadcaster = deps.broadcaster;
    this.partidaTerminadaTtlSegundos = deps.partidaTerminadaTtlSegundos ?? 3600;
    this.notificarRetorno = deps.notificarRetorno;
    this.notificarDesistencia = deps.notificarDesistencia;
    this.tetoDesvinculoMs = deps.tetoDesvinculoMs ?? 5000;
    this.debug = deps.debug;
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
      // Espelho do erro de guarda no stream de debug (issue #340).
      this.debug?.emitirParaSocket(socket, 'error', 'Comando fora do escopo da partida.');
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

      // Re-drive do Retorno (issue #290, item 4): comandos que chegam com a
      // partida já terminada (ex.: recusa pós-término) completam pendência
      // deixada por crash-restart ou lote degradado — já dentro da mutação,
      // sem re-enfileirar (isso travaria a cadeia nela mesma).
      if (estado.resultado !== null) {
        const pendente = await this.lerRetornoPendente(partidaId);
        if (pendente !== null) {
          await this.completarRetornoPendenteDentroDaMutacao(partidaId, pendente);
        }
      }

      // Captura antecipada dos metadados da partida para fallback do callback (B1/B3).
      let partidaPrevia: import('./partidas.ts').PartidaPreparada | null = null;
      if (this.notificarRetorno !== undefined || this.notificarDesistencia !== undefined) {
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
        // Espelho da Ação recusada no stream de debug (issue #340).
        this.debug?.emitirParaSocket(socket, 'error', `Ação ${comando.tipo} recusada: ${paraCodigoDaPartidaWire(resultado.erro.codigo)} — ${resultado.erro.mensagem}`);
        return;
      }

      // Espelho do julgamento de Ação no stream de debug (issue #340).
      this.debug?.emitir(partidaId, 'info', `Ação ${comando.tipo} de ${sessaoJogadorId} julgada`);

      await salvarEstadoDaPartida(this.redis, partidaId, resultado.estado);
      // Causa explícita (issue #295): o ato explícito viaja com
      // `causa:'desistencia'` — a conversão por expiração já chega com
      // `causa:'expiracao'` (ver `converterExpiracaoEmDesistencia`) e
      // payloads antigos sem causa seguem lidos como explícitos.
      const eventosComCausa: readonly EventoDaPartida[] = resultado.eventos.map((evento) =>
        evento.tipo === 'desistencia_registrada' && evento.causa === undefined
          ? { ...evento, causa: 'desistencia' as const }
          : evento,
      );
      this.broadcaster.enviar(partidaId, ...traduzirEventos(eventosComCausa));

      await this.processarPosLoteDeDesistencia(
        partidaId,
        partidaPrevia,
        eventosComCausa,
        resultado.estado.jogadores.map((j) => j.jogadorId),
      );
    }).catch((erro: unknown) => {
      console.error('[partida] erro inesperado ao processar comando:', erro);
      this.broadcaster.enviarParaSocket(socket, {
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'DADOS_INVALIDOS',
        mensagem: 'Erro interno ao processar comando da partida.',
      });
      // Espelho do erro interno no stream de debug (issue #340).
      this.debug?.emitirParaSocket(socket, 'error', `erro interno ao processar comando: ${(erro as Error).message}`);
    });
  }

  /**
   * Pós-lote de desistência compartilhado (issues #288/#295): o bloco antes
   * duplicado entre `aplicarMensagem` (B, caminho explícito) e
   * `converterExpiracaoEmDesistencia` (a expiração passa os eventos já com
   * `causa: 'expiracao'`) — extração mecânica, sem mudar ordem/retries do
   * caminho feliz de B. Desistência parcial (sem término) desvincula cada
   * desistente no lobby em fire-and-forget; com término, retenção +
   * `desvincularDesistentes` (detach antes do retorno) + `montarAviso` (N−1)
   * + `enviarRetornoComPersistencia`, com o cascade de reagendamento do
   * caminho feliz no degradado sem metadados.
   */
  private async processarPosLoteDeDesistencia(
    partidaId: string,
    partidaPrevia: PartidaPreparada | null,
    eventos: readonly EventoDaPartida[],
    jogadoresApos: readonly string[],
  ): Promise<void> {
    const termino = eventos.find((evento) => evento.tipo === 'partida_terminada');
    const desistencias = eventos.filter((evento) => evento.tipo === 'desistencia_registrada');
    if (termino?.tipo !== 'partida_terminada' && desistencias.length > 0 && this.notificarDesistencia !== undefined) {
      // Desistência parcial (sobram ≥2, sem término): desvincula cada
      // desistente no lobby em fire-and-forget (a partida continua; não há
      // retorno aqui). O caso com término é tratado abaixo com await para
      // garantir a ordem detach → retorno.
      const notificar = this.notificarDesistencia;
      // R5: placeholder rastreado (mapa de desvinculos, fora do dedup do
      // retorno) ANTES do await obterPartida para que
      // drenarRetornosPendentes (SIGTERM) enxergue o detach em voo.
      const concluirEspera = this.rastrearEspera(partidaId);
      void (async () => {
        try {
          let partida: PartidaPreparada | null = partidaPrevia;
          if (partida === null) {
            try {
              partida = await obterPartida(this.redis, partidaId);
            } catch {
              partida = null;
            }
          }
          if (partida === null) {
            console.error('[partida] sem metadados para callback de desistência', { partidaId });
            return;
          }
          for (const evento of desistencias) {
            if (evento.tipo !== 'desistencia_registrada') continue;
            const promessa = notificar({
              salaId: partida.salaId,
              partidaId,
              serverId: partida.serverId,
              jogadorId: evento.jogadorId,
              // Causa informativa (#295): distingue o ato explícito
              // (`desistencia`) da conversão (`expiracao`) sem mudar o detach.
              ...(evento.causa === undefined ? {} : { causa: evento.causa }),
            }).catch((erro: unknown) => {
              console.error('[partida] callback de desistência terminou com erro', { partidaId, erro });
            });
            this.rastrearDesvinculo(partidaId, promessa);
          }
        } finally {
          concluirEspera();
        }
      })().catch(() => undefined);
    }
    if (termino?.tipo === 'partida_terminada') {
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

      let aviso: AvisoDeRetorno | undefined;
      if (this.notificarRetorno !== undefined) {
        // Término com desistentes (2→1, issue #290): desvincula TODOS os
        // desistentes (roster − engine) ANTES do retorno — o lobby revalida
        // `jogadores == membros ativos` com 409 definitivo, então o detach
        // precisa ter commitado antes do POST /api/retorno. Best-effort com
        // teto por desistente (R1): com o lobby fora do ar, segue para o
        // retorno (que tem retry próprio) em vez de travar a cadeia; o
        // detach em fundo continua tentando e o lobby é idempotente.
        await this.desvincularDesistentes(
          partidaId,
          partidaPrevia,
          jogadoresApos,
          desistencias,
        );
        if (this.callbacksEnviados.has(partidaId) || this.retornosPendentes.has(partidaId)) {
          // Já há callback em voo ou enviado — retenção já aplicada acima, apenas evita duplicar aviso
        } else {
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
            const atrasoMs = 1000;
            setTimeout(() => {
              void this.enfileirarMutacao(partidaId, async () => {
                if (this.retornosPendentes.has(partidaId) || this.callbacksEnviados.has(partidaId)) return;
                let partidaReagendada: PartidaPreparada | null = null;
                for (let tentativa = 0; tentativa < 3; tentativa += 1) {
                  try {
                    partidaReagendada = await obterPartida(this.redis, partidaId);
                    if (partidaReagendada !== null) break;
                  } catch {}
                  if (partidaReagendada === null && tentativa < 2) {
                    await sleep(100 * 2 ** tentativa);
                  }
                }
                if (partidaReagendada === null && partidaPrevia !== null) {
                  partidaReagendada = partidaPrevia;
                }
                if (partidaReagendada === null) {
                  console.error('[partida] reagendamento ainda sem metadados, reagendando novamente', { partidaId });
                  const reatrasoMs = 2000;
                  setTimeout(() => {
                    void this.enfileirarMutacao(partidaId, async () => {
                      let partidaReagendada2: PartidaPreparada | null = null;
                      try {
                        partidaReagendada2 = await obterPartida(this.redis, partidaId);
                      } catch {}
                      if (partidaReagendada2 === null && partidaPrevia !== null) {
                        partidaReagendada2 = partidaPrevia;
                      }
                      if (partidaReagendada2 === null) {
                        // Sem metadados mesmo após retries: retry sem
                        // desistir (converge transientes; crash-restart
                        // recupera via re-drive da pendência).
                        this.reagendarRetornoSemN1(
                          partidaId,
                          termino.desfecho.tipo,
                          jogadoresApos,
                          desistencias.length > 0,
                        );
                        return;
                      }
                      // F9 (#290): o detach pode ter sido pulado por falta de
                      // metadados no término — tenta antes do retorno para
                      // não esbarrar no 409 do lobby (mesma ordem do feliz).
                      await this.desvincularDesistentes(
                        partidaId,
                        partidaReagendada2,
                        jogadoresApos,
                        desistencias,
                      );
                      const avisoReagendado2 = await this.montarAviso(
                        partidaReagendada2,
                        termino.desfecho.tipo,
                        jogadoresApos,
                        desistencias.length > 0,
                      );
                      if (avisoReagendado2 === null) {
                        this.reagendarRetornoSemN1(
                          partidaId,
                          termino.desfecho.tipo,
                          jogadoresApos,
                          desistencias.length > 0,
                        );
                        return;
                      }
                      this.enviarRetornoComPersistencia(partidaId, avisoReagendado2);
                    }).catch(() => undefined);
                  }, reatrasoMs).unref?.();
                  return;
                }
                if (this.notificarRetorno === undefined) return;
                // F9 (#290): idem acima — detach antes do retorno reagendado.
                await this.desvincularDesistentes(
                  partidaId,
                  partidaReagendada,
                  jogadoresApos,
                  desistencias,
                );
                const avisoReagendado = await this.montarAviso(
                  partidaReagendada,
                  termino.desfecho.tipo,
                  jogadoresApos,
                  desistencias.length > 0,
                );
                if (avisoReagendado === null) {
                  this.reagendarRetornoSemN1(
                    partidaId,
                    termino.desfecho.tipo,
                    jogadoresApos,
                    desistencias.length > 0,
                  );
                  return;
                }
                this.enviarRetornoComPersistencia(partidaId, avisoReagendado);
              }).catch(() => undefined);
            }, atrasoMs).unref?.();
          } else {
            const avisoMontado = await this.montarAviso(
              partida,
              termino.desfecho.tipo,
              jogadoresApos,
              desistencias.length > 0,
            );
            if (avisoMontado === null) {
              this.reagendarRetornoSemN1(
                partidaId,
                termino.desfecho.tipo,
                jogadoresApos,
                desistencias.length > 0,
              );
            } else {
              aviso = avisoMontado;
            }
          }
        }
      }

      if (aviso !== undefined) {
        this.enviarRetornoComPersistencia(partidaId, aviso);
      }
    }
  }

  /**
   * Conversão automática da expiração da reconexão em desistência (issue
   * #295): reaproveita integralmente o caminho de B — despacho interno direto
   * ao engine com ator = ausente (sem rota wire nova), efeito atômico idêntico
   * ao explícito, com `causa: 'expiracao'` anexada ao evento de domínio (o
   * wire a projeta 1:1). Broadcast do lote integral + pós-lote compartilhado
   * com B (`processarPosLoteDeDesistencia`: `notificarDesistencia`/
   * `notificarRetorno`, retenção e término idênticos ao fluxo explícito). Idempotente: partida terminada/ausente, presença já
   * `conectado` (readmissão venceu a corrida) ou jogador já fora do engine
   * abortam sem mutar e retornam false; só a conversão efetiva retorna true.
   * Serializada na cadeia da partida como as demais mutações.
   */
  async converterExpiracaoEmDesistencia(partidaId: string, jogadorAusente: string): Promise<boolean> {
    let converteu = false;
    await this.enfileirarMutacao(partidaId, async () => {
      const estado = await obterEstadoDaPartida(this.redis, partidaId);
      if (estado === null) {
        return;
      }
      if (estado.resultado !== null) {
        const pendente = await this.lerRetornoPendente(partidaId);
        if (pendente !== null) {
          await this.completarRetornoPendenteDentroDaMutacao(partidaId, pendente);
        }
        return;
      }
      let partidaPrevia: PartidaPreparada | null = null;
      if (this.notificarRetorno !== undefined || this.notificarDesistencia !== undefined) {
        try {
          partidaPrevia = await obterPartida(this.redis, partidaId);
        } catch {
          partidaPrevia = null;
        }
      }
      // Guarda de corrida admissão-vs-timer (#295): a presença vigente decide
      // dentro da mutação — readmissão entre o fire do timer e a cadeia aborta.
      const partidaAtual = partidaPrevia ?? await obterPartida(this.redis, partidaId).catch(() => null);
      if (partidaAtual === null || partidaAtual.estado !== 'em_andamento') {
        return;
      }
      const membro = partidaAtual.roster.find((m) => m.jogadorId === jogadorAusente);
      if (membro === undefined || membro.presenca !== 'em_reconexao') {
        return;
      }
      if (!estado.jogadores.some((j) => j.jogadorId === jogadorAusente)) {
        return;
      }
      const resultado = aplicarComandoDePartida(estado, { tipo: 'desistir_da_partida' }, jogadorAusente);
      if (!resultado.sucesso) {
        return;
      }
      const eventosComCausa: readonly EventoDaPartida[] = resultado.eventos.map((evento) =>
        evento.tipo === 'desistencia_registrada'
          ? { ...evento, causa: 'expiracao' as const }
          : evento,
      );
      await salvarEstadoDaPartida(this.redis, partidaId, resultado.estado);
      this.broadcaster.enviar(partidaId, ...traduzirEventos(eventosComCausa));
      this.debug?.emitir(partidaId, 'info', `Expiração de ${jogadorAusente} convertida em desistência`);

      await this.processarPosLoteDeDesistencia(
        partidaId,
        partidaPrevia,
        eventosComCausa,
        resultado.estado.jogadores.map((j) => j.jogadorId),
      );
      converteu = true;
    }).catch((erro: unknown) => {
      console.error('[partida] erro inesperado na conversão por expiração:', erro);
    });
    return converteu;
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
      // Re-drive do Retorno (issue #290, item 4): toda (re)conexão passa por
      // aqui — partida terminada com pendência (crash-restart/degradado)
      // completa a entrega agora. O retorno do lobby é idempotente.
      if (estado.resultado !== null) {
        await this.tentarCompletarRetornoPendente(partidaId);
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

  /**
   * Desvincula no lobby todos os desistentes de uma partida terminada
   * (roster − participação atual no engine), aguardando cada callback COM
   * TETO (R1). Chamado antes do retorno para garantir a ordem detach →
   * retorno no caminho feliz; no degradado segue para o retorno e deixa o
   * retry de fundo convergir (lobby idempotente).
   */
  private async desvincularDesistentes(
    partidaId: string,
    partidaPrevia: PartidaPreparada | null,
    jogadoresNaPartida: readonly string[],
    desistenciasNoLote: readonly EventoDaPartida[] = [],
  ): Promise<void> {
    const notificar = this.notificarDesistencia;
    if (notificar === undefined) return;
    let partida: PartidaPreparada | null = partidaPrevia;
    if (partida === null) {
      try {
        partida = await obterPartida(this.redis, partidaId);
      } catch {
        partida = null;
      }
    }
    if (partida === null) {
      console.error('[partida] sem metadados para desvincular desistentes', { partidaId });
      return;
    }
    const naPartida = new Set(jogadoresNaPartida);
    const desistentes = partida.roster.map((m) => m.jogadorId).filter((id) => !naPartida.has(id));
    // Causa informativa por desistente (#295): o lote carrega a origem de
    // cada saída (explícita `desistencia` vs conversão `expiracao`); fora do
    // lote (reagendamentos degradados) a causa é omitida, sem mudar o detach.
    const causas = new Map<string, 'desistencia' | 'expiracao'>();
    for (const evento of desistenciasNoLote) {
      if (evento.tipo === 'desistencia_registrada' && evento.causa !== undefined) {
        causas.set(evento.jogadorId, evento.causa);
      }
    }
    // Em paralelo com teto individual: jogadorIds distintos, lobby idempotente
    // e serializado na fila — o tempo total vira max(teto), não soma.
    await Promise.all(desistentes.map(async (jogadorId) => {
      const causa = causas.get(jogadorId);
      const promessa = notificar({
        salaId: partida.salaId,
        partidaId,
        serverId: partida.serverId,
        jogadorId,
        ...(causa === undefined ? {} : { causa }),
      });
      // Rastreia em mapa próprio (nunca no de retornos — o dedup do retorno
      // abaixo não pode ver detach como "callback em voo").
      this.rastrearDesvinculo(partidaId, promessa.catch(() => undefined));
      try {
        const desfecho = await this.correrComTeto(promessa, this.tetoDesvinculoMs);
        if (desfecho === 'teto') {
          console.warn('[partida] teto do detach, seguindo para o retorno', {
            partidaId,
            jogadorId,
            tetoMs: this.tetoDesvinculoMs,
          });
        }
      } catch (erro: unknown) {
        // O cliente só rejeita em erro de programação (rede/HTTP viram
        // retry infinito, agora limitado pelo teto acima); logar e seguir
        // para não travar os demais.
        console.error('[partida] falha ao desvincular desistente', { partidaId, jogadorId, erro });
      }
    }));
  }

  /** Corre com teto: 'ok' se resolveu/rejeitou a tempo, 'teto' se estourou. */
  private async correrComTeto(promessa: Promise<unknown>, tetoMs: number): Promise<'ok' | 'teto'> {
    if (tetoMs <= 0) {
      await promessa;
      return 'ok';
    }
    let estourou = false;
    const teto = sleep(tetoMs).then(() => {
      estourou = true;
    });
    void promessa.catch(() => undefined);
    await Promise.race([promessa.then(() => undefined, () => undefined), teto]);
    return estourou ? 'teto' : 'ok';
  }

  /**
   * Monta o aviso de Retorno com N−1 (participação atual no engine), não N
   * (roster pré-desistência) — issue #290, resolve o follow-up #371 (R3).
   *
   * Prefere `jogadoresEmMemoria` (estado pós-mutação já em mãos, sempre N−1
   * correto mesmo com Redis indisponível); sem memória, tenta o Redis; sem
   * ambos e com desistência no lote, retorna null (não inventa N — o lobby
   * rejeitaria com 409 definitivo e a sala prenderia). Sem desistência
   * (não-início/vitória limpa), cai no roster como antes.
   */
  private async montarAviso(
    partida: PartidaPreparada,
    resultado: 'vitoria' | 'derrota',
    jogadoresEmMemoria: readonly string[] | null = null,
    teveDesistencia = false,
  ): Promise<AvisoDeRetorno | null> {
    if (jogadoresEmMemoria !== null) {
      return {
        salaId: partida.salaId,
        partidaId: partida.partidaId,
        serverId: partida.serverId,
        resultado,
        jogadores: jogadoresEmMemoria,
        teveDesistencia,
      };
    }
    let jogadores: readonly string[] | null = null;
    try {
      const estado = await obterEstadoDaPartida(this.redis, partida.partidaId);
      if (estado !== null) jogadores = estado.jogadores.map((j) => j.jogadorId);
    } catch {
      jogadores = null;
    }
    if (jogadores !== null) {
      return {
        salaId: partida.salaId,
        partidaId: partida.partidaId,
        serverId: partida.serverId,
        resultado,
        jogadores,
        teveDesistencia,
      };
    }
    if (teveDesistencia) return null;
    return {
      salaId: partida.salaId,
      partidaId: partida.partidaId,
      serverId: partida.serverId,
      resultado,
      jogadores: partida.roster.map((m) => m.jogadorId),
      teveDesistencia,
    };
  }

  /**
   * Reagendamento do retorno sem N−1 confiável (review PR #378, item 4): nunca
   * descarta a derrota 2→1 no degradado — reagenda com backoff exponencial
   * (cap 30s, mesmo teto do cliente de retorno) até convergir. Transientes de
   * Redis convergem sozinhos; crash-restart recupera via re-drive da
   * pendência (`tentarCompletarRetornoPendente`). Timer com `unref` para não
   * segurar o processo; sem desistência após N tentativas.
   */
  private reagendarRetornoSemN1(
    partidaId: string,
    resultado: 'vitoria' | 'derrota',
    jogadoresEmMemoria: readonly string[] | null,
    teveDesistencia: boolean,
    atrasoMs = 1000,
    tentativa = 1,
  ): void {
    if (this.notificarRetorno === undefined) return;
    // Visibilidade operacional: retry sem desistir, então cada reagendamento
    // é logado (tentativa + atraso) em vez de espiral silenciosa.
    console.warn('[partida] retorno sem dados confiáveis, reagendando', {
      partidaId,
      resultado,
      tentativa,
      atrasoMs,
    });
    setTimeout(() => {
      void this.enfileirarMutacao(partidaId, async () => {
        if (this.retornosPendentes.has(partidaId) || this.callbacksEnviados.has(partidaId)) return;
        if (this.notificarRetorno === undefined) return;
        let partida: PartidaPreparada | null = null;
        try {
          partida = await obterPartida(this.redis, partidaId);
        } catch {
          partida = null;
        }
        if (partida === null) {
          this.reagendarRetornoSemN1(
            partidaId,
            resultado,
            jogadoresEmMemoria,
            teveDesistencia,
            Math.min(atrasoMs * 2, 30000),
            tentativa + 1,
          );
          return;
        }
        // F9 (#290): detach antes do retorno (mesma ordem do caminho feliz)
        // para não esbarrar no 409 do lobby; idempotente, converge junto.
        await this.desvincularDesistentes(
          partidaId,
          partida,
          jogadoresEmMemoria ?? [],
        );
        const aviso = await this.montarAviso(partida, resultado, jogadoresEmMemoria, teveDesistencia);
        if (aviso === null) {
          this.reagendarRetornoSemN1(
            partidaId,
            resultado,
            jogadoresEmMemoria,
            teveDesistencia,
            Math.min(atrasoMs * 2, 30000),
            tentativa + 1,
          );
          return;
        }
        this.enviarRetornoComPersistencia(partidaId, aviso);
      }).catch(() => undefined);
    }, atrasoMs).unref?.();
  }

  /**
   * Envio do Retorno com persistência da pendência (issue #290, item 4): grava
   * a chave ANTES de enviar e apaga após a conclusão (aceito ou rejeição
   * definitiva — o cliente de retorno só retorna nesses casos). Marca
   * `callbacksEnviados` antes do envio (dedup de concorrentes, como antes).
   */
  private enviarRetornoComPersistencia(partidaId: string, aviso: AvisoDeRetorno): void {
    const notificar = this.notificarRetorno;
    this.callbacksEnviados.add(partidaId);
    if (notificar === undefined) return;
    const promessa = (async () => {
      try {
        await this.redis.set(
          chaveDoRetornoPendente(partidaId),
          JSON.stringify({ resultado: aviso.resultado, teveDesistencia: aviso.teveDesistencia }),
          'EX',
          this.partidaTerminadaTtlSegundos,
        );
      } catch {
        // Redis fora do ar: segue para o envio; o retry em memória cobre.
      }
      try {
        await notificar(aviso);
      } catch (erro: unknown) {
        console.error('[partida] callback de retorno terminou com erro', {
          partidaId,
          erro,
        });
      } finally {
        try {
          await this.redis.del(chaveDoRetornoPendente(partidaId));
        } catch {
          // Sem Redis não há pendência persistida a limpar.
        }
      }
    })();
    this.rastrearRetorno(partidaId, promessa);
  }

  /**
   * Re-drive da pendência de Retorno (issue #290, item 4): se um crash-restart
   * (ou lote degradado) deixou a chave, completa a entrega com dados vivos —
   * N−1 do estado atual + metadados da partida. Chamado em
   * `anunciarTurnoAtual` (fora de mutação — com serialização; toda
   * (re)conexão passa por lá).
   * O retorno do lobby é idempotente; guards em memória evitam duplicar um
   * envio em voo. Sem estado/resultado ou sem metadados, mantém a chave para
   * a próxima oportunidade — nunca apaga sem entregar.
   */
  private async tentarCompletarRetornoPendente(partidaId: string): Promise<void> {
    const pendente = await this.lerRetornoPendente(partidaId);
    if (pendente === null) return;
    await this.enfileirarMutacao(partidaId, async () => {
      await this.completarRetornoPendenteDentroDaMutacao(partidaId, pendente);
    }).catch(() => undefined);
  }

  /**
   * Lê e valida a pendência sem mutar nada (`null` = sem re-drive): chave
   * ausente, JSON inválido (limpa) ou resultado desconhecido (limpa).
   */
  private async lerRetornoPendente(
    partidaId: string,
  ): Promise<{ resultado: 'vitoria' | 'derrota'; teveDesistencia: boolean } | null> {
    if (this.notificarRetorno === undefined) return null;
    if (this.callbacksEnviados.has(partidaId) || this.retornosPendentes.has(partidaId)) return null;
    let bruto: string | null = null;
    try {
      bruto = await this.redis.get(chaveDoRetornoPendente(partidaId));
    } catch {
      return null;
    }
    if (bruto === null) return null;
    let pendente: { resultado?: unknown; teveDesistencia?: unknown } | null = null;
    try {
      pendente = JSON.parse(bruto) as { resultado?: unknown; teveDesistencia?: unknown };
    } catch {
      pendente = null;
    }
    if (pendente?.resultado !== 'vitoria' && pendente?.resultado !== 'derrota') {
      try {
        await this.redis.del(chaveDoRetornoPendente(partidaId));
      } catch {
        // Sem Redis, nada a limpar.
      }
      return null;
    }
    return { resultado: pendente.resultado, teveDesistencia: pendente.teveDesistencia === true };
  }

  /**
   * Completa a pendência JÁ dentro de uma mutação (nunca enfileira aqui —
   * dentro de `aplicarMensagem` isso travaria a cadeia nela mesma).
   */
  private async completarRetornoPendenteDentroDaMutacao(
    partidaId: string,
    pendente: { resultado: 'vitoria' | 'derrota'; teveDesistencia: boolean },
  ): Promise<void> {
    if (this.retornosPendentes.has(partidaId) || this.callbacksEnviados.has(partidaId)) return;
    if (this.notificarRetorno === undefined) return;
    let estado: import('@flicker/engine').EstadoDaPartida | null = null;
    try {
      estado = await obterEstadoDaPartida(this.redis, partidaId);
    } catch {
      estado = null;
    }
    if (estado === null || estado.resultado === null) return;
    let partida: PartidaPreparada | null = null;
    try {
      partida = await obterPartida(this.redis, partidaId);
    } catch {
      partida = null;
    }
    if (partida === null) return;
    const aviso = await this.montarAviso(
      partida,
      pendente.resultado,
      estado.jogadores.map((j) => j.jogadorId),
      pendente.teveDesistencia,
    );
    if (aviso === null) return;
    this.enviarRetornoComPersistencia(partidaId, aviso);
  }

  /**
   * Rastreia uma espera ainda sem promise real (R5): o placeholder entra no
   * mapa imediatamente para o drain do SIGTERM enxergar o detach em voo; o
   * `concluir` devolve a vaga sem apagar um callback real que o substituiu.
   */
  private rastrearEspera(partidaId: string): () => void {
    let concluir!: () => void;
    const espera = new Promise<void>((resolver) => {
      concluir = resolver;
    });
    this.rastrearDesvinculo(partidaId, espera);
    return concluir;
  }

  /** Desvinculos não participam do dedup do retorno; só do drain. */
  private rastrearDesvinculo(partidaId: string, promessa: Promise<void>): void {
    let conjunto = this.desvinculosPendentes.get(partidaId);
    if (conjunto === undefined) {
      conjunto = new Set();
      this.desvinculosPendentes.set(partidaId, conjunto);
    }
    conjunto.add(promessa);
    void promessa.finally(() => {
      const atual = this.desvinculosPendentes.get(partidaId);
      atual?.delete(promessa);
      if (atual !== undefined && atual.size === 0) {
        this.desvinculosPendentes.delete(partidaId);
      }
    });
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
    // B3 (issue #290): loop com re-snapshot até o teto total. Os callbacks
    // reais nascem após `obterPartida` (o placeholder de `rastrearEspera`
    // existe antes) — com snapshot único, o drain retornava após o
    // placeholder sem esperar o payload. Reamostra enquanto houver pendentes.
    const inicio = Date.now();
    for (;;) {
      const pendentes: Promise<unknown>[] = [...this.retornosPendentes.values()];
      for (const conjunto of this.desvinculosPendentes.values()) {
        pendentes.push(...conjunto);
      }
      if (pendentes.length === 0) return;
      const restante = timeoutMs - (Date.now() - inicio);
      if (restante <= 0) return;
      await Promise.race([
        Promise.allSettled(pendentes),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, restante);
          timer.unref?.();
        }),
      ]);
    }
  }

  private limparCadeia(partidaId: string, proxima: Promise<unknown>): void {
    if (this.cadeiasPorPartida.get(partidaId) === proxima) {
      this.cadeiasPorPartida.delete(partidaId);
    }
  }
}
