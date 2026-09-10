// Stream de debug do lobby-server (issue #340, "Modo Desenvolvedor").
//
// Registro por `salaId`: cada conexão que envia `ATIVAR_DEBUG` entra no mapa
// de ativos com o escopo resolvido na hora (projeção → fallback PG, a mesma
// resolução dos handlers). O cliente não informa `salaId` no comando — o
// servidor gera o id, e a Sala pode nem existir no momento da ativação
// (ativação antes de CRIAR_SALA/ENTRAR_NA_SALA): nesses casos o escopo fica
// `null` e é re-resolvido em cada emissão (jogador pode ter entrado numa Sala
// depois de ativar). `emitir` entrega unicast apenas aos ativos cujo escopo
// é a Sala da emissão — nunca broadcast aos Membros comuns.
//
// `DESATIVAR_DEBUG` ou o `close` da conexão encerram o stream (o `ws.ts`
// chama `desconectar` no fechamento). Todas as entregas seguem o padrão do
// `SalasBroadcaster`: `readyState === OPEN`, engolir falha de `send`.

import type { WebSocket } from 'ws';
import type { DebugLogEvento } from '@flicker/shared';
import type { AuthenticatedWebSocket } from './ws.ts';

export type NivelDeDebug = DebugLogEvento['nivel'];

export type TipoDeComandoDeDebug = 'ATIVAR_DEBUG' | 'DESATIVAR_DEBUG';

/**
 * Type guard dos comandos de controle de debug. Usado pelo `ws.ts` para
 * interceptá-los ANTES do despacho aos handlers (que os recusariam como
 * DADOS_INVALIDOS — o switch de `SalasHandlers` não conhece estas variantes).
 */
export function tipoDeComandoDeDebug(value: unknown): TipoDeComandoDeDebug | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const type = (value as { type?: unknown }).type;
  return type === 'ATIVAR_DEBUG' || type === 'DESATIVAR_DEBUG' ? type : null;
}

export interface DebugStreamDasSalasDeps {
  /**
   * Resolve a Sala do Jogador (projeção → fallback PG). Mesma resolução dos
   * handlers; injetada para o `criarContextoDasSalas` compor com `projecao` +
   * `repo` e para os testes substituírem por um resolver determinístico.
   */
  readonly resolverSalaId: (jogadorId: string) => Promise<string | null>;
}

export class DebugStreamDasSalas {
  private readonly ativos: Map<WebSocket, string | null> = new Map();
  private readonly resolverSalaId: (jogadorId: string) => Promise<string | null>;

  constructor(deps: DebugStreamDasSalasDeps) {
    this.resolverSalaId = deps.resolverSalaId;
  }

  /**
   * Interpreta `ATIVAR_DEBUG`/`DESATIVAR_DEBUG` de uma conexão autenticada.
   * Idempotente: reativar re-resolve o escopo e reenvia o ack (o cliente
   * reenvia o comando a cada reconexão do socket).
   *
   * Qualquer Jogador autenticado pode ativar (sem allowlist): risco aceito
   * documentado no ADR-0011 — a entrega fica restrita ao escopo do Jogador.
   */
  async receberComando(socket: AuthenticatedWebSocket, tipo: TipoDeComandoDeDebug): Promise<void> {
    if (tipo === 'DESATIVAR_DEBUG') {
      // Ack antes de remover: o cliente confirma o encerramento no painel.
      this.enviar(socket, 'info', 'stream de debug encerrado', 'lobby');
      this.ativos.delete(socket);
      return;
    }
    const jogadorId = socket.data?.jogadorId;
    // Sem sessão (não deveria ocorrer — o despacho é pós-auth): ativa sem
    // escopo; as emissões re-resolverão e falharão em silêncio.
    const salaId = typeof jogadorId === 'string' ? await this.resolverSalaId(jogadorId).catch(() => null) : null;
    this.ativos.set(socket, salaId);
    const escopo = salaId !== null ? `sala ${salaId}` : 'sem sala ainda';
    this.enviar(socket, 'info', `stream de debug ativado (${escopo})`, 'lobby');
  }

  /** `close` da conexão encerra o stream (issue #340: desconexão encerra). */
  desconectar(socket: WebSocket): void {
    this.ativos.delete(socket);
  }

  /**
   * Espelha uma linha escopada à Sala. Sockets com escopo ainda `null`
   * re-resolvem a associação (ativação antes de entrar numa Sala); a
   * resolução é assíncrona e a emissão desta chamada já partiu — o socket
   * passa a receber as emissões seguintes.
   */
  emitir(salaId: string, nivel: NivelDeDebug, mensagem: string, contexto: string = 'lobby'): void {
    for (const [socket, escopo] of [...this.ativos]) {
      if (escopo === salaId) {
        this.enviar(socket, nivel, mensagem, contexto);
        continue;
      }
      if (escopo !== null) continue;
      const jogadorId = (socket as AuthenticatedWebSocket).data?.jogadorId;
      if (typeof jogadorId !== 'string') continue;
      void this.resolverSalaId(jogadorId)
        .then((resolvida) => {
          if (resolvida === null) return;
          this.ativos.set(socket, resolvida);
          if (resolvida === salaId) {
            this.enviar(socket, nivel, mensagem, contexto);
          }
        })
        .catch(() => undefined);
    }
  }

  /**
   * Espelha uma linha direcionada a UMA conexão (erros do originador), desde
   * que ela seja um cliente de debug ativo — erros são pessoais, não de Sala.
   */
  emitirParaSocket(socket: WebSocket, nivel: NivelDeDebug, mensagem: string, contexto: string = 'lobby'): void {
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
