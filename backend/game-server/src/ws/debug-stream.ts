// Stream de debug do game-server (issue #340, "Modo Desenvolvedor").
//
// Registro por `partidaId`: a conexão de jogo nasce escopada (o
// `partida-id` vem no upgrade e é validado pela admissão), então
// `ATIVAR_DEBUG` registra o socket diretamente no escopo da Partida — sem
// resolução posterior, diferente do lobby. `emitir` entrega unicast apenas
// aos ativos daquela Partida; `DESATIVAR_DEBUG` ou o `close` encerram o
// stream. Padrão de entrega igual ao `PartidaBroadcaster`:
// `readyState === OPEN`, engolir falha de `send`.

import type { WebSocket } from 'ws';
import type { DebugLogEvento } from '@flicker/shared';

export type NivelDeDebug = DebugLogEvento['nivel'];

export type TipoDeComandoDeDebug = 'ATIVAR_DEBUG' | 'DESATIVAR_DEBUG';

/**
 * Type guard dos comandos de controle de debug. Usado pelo `ws.ts` para
 * interceptá-los ANTES de `aplicarMensagem` — a guarda do contrato
 * (`ehComandoDaPartida`) os recusaria como DADOS_INVALIDOS.
 */
export function tipoDeComandoDeDebug(value: unknown): TipoDeComandoDeDebug | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const type = (value as { type?: unknown }).type;
  return type === 'ATIVAR_DEBUG' || type === 'DESATIVAR_DEBUG' ? type : null;
}

export class DebugStreamDaPartida {
  private readonly ativos: Map<WebSocket, string> = new Map();

  /**
   * Interpreta `ATIVAR_DEBUG`/`DESATIVAR_DEBUG`. Idempotente: reativar
   * reenvia o ack (o cliente reenvia o comando a cada reconexão do socket).
   */
  receberComando(socket: WebSocket, partidaId: string, tipo: TipoDeComandoDeDebug): void {
    if (tipo === 'DESATIVAR_DEBUG') {
      // Ack antes de remover: o cliente confirma o encerramento no painel.
      this.enviar(socket, 'info', 'stream de debug encerrado', 'partida');
      this.ativos.delete(socket);
      return;
    }
    this.ativos.set(socket, partidaId);
    this.enviar(socket, 'info', `stream de debug ativado (partida ${partidaId})`, 'partida');
  }

  /** `close` da conexão encerra o stream (issue #340: desconexão encerra). */
  desconectar(socket: WebSocket): void {
    this.ativos.delete(socket);
  }

  /** Espelha uma linha escopada à Partida (julgamento de Ações etc.). */
  emitir(partidaId: string, nivel: NivelDeDebug, mensagem: string, contexto: string = 'partida'): void {
    for (const [socket, escopo] of this.ativos) {
      if (escopo !== partidaId) continue;
      this.enviar(socket, nivel, mensagem, contexto);
    }
  }

  /**
   * Espelha uma linha direcionada a UMA conexão (erros do originador), desde
   * que ela seja um cliente de debug ativo.
   */
  emitirParaSocket(socket: WebSocket, nivel: NivelDeDebug, mensagem: string, contexto: string = 'partida'): void {
    if (!this.ativos.has(socket)) return;
    this.enviar(socket, nivel, mensagem, contexto);
  }

  /** Quantidade de clientes ativos — diagnóstico e testes. */
  get totalDeAtivos(): number {
    return this.ativos.size;
  }

  private enviar(socket: WebSocket, nivel: NivelDeDebug, mensagem: string, contexto: string): void {
    if (socket.readyState !== socket.OPEN) return;
    const evento: DebugLogEvento = { type: 'DEBUG_LOG', nivel, contexto, mensagem };
    try {
      socket.send(JSON.stringify(evento));
    } catch {
      // Socket em estado intermediário: engole (padrão do broadcaster).
    }
  }
}
