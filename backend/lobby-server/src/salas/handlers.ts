// Handlers WS de Sala (issue #36, ST-06).
//
// Roteamento entre o protocolo Sala (`@flicker/shared`) e o engine
// (`@flicker/engine`). Persistência e projeção vivem em `SalasRepo` e
// `SalasProjecao`; a tradução engine→wire vive em `traduzirEventos`.
//
// Comandos no escopo do #36:
//   CRIAR_SALA       -> criarSala(engine)
//   ENTRAR_NA_SALA   -> entrarNaSala(engine), com codigoDeSala → salaId via Redis
//   SAIR_DA_SALA     -> sairDaSala(engine), com salaId via Redis
//
// Os outros 6 comandos (`ALTERNAR_PRONTIDAO`, `ENVIAR_MENSAGEM_DE_CHAT`,
// `EXPULSAR_MEMBRO`, `DESBLOQUEAR_JOGADOR`, `ENCERRAR_SALA`,
// `INICIAR_PARTIDA`) respondem `ERRO_DA_SALA` com
// `codigo: 'DADOS_INVALIDOS'` ao originador — fora do escopo deste servidor.
//
// Erros do engine são roteados ao originador (não broadcast) com o mesmo
// `codigo` do domínio.

import { randomUUID } from 'node:crypto';
import {
  type CodigoDeErro,
} from '@flicker/engine';
import type {
  SalaComandoDoCliente,
  SalaEventoDoServidor,
  ErroDaSalaEvento,
  CodigoDeErroDaSala,
} from '@flicker/shared';
import {
  CodigoDeSalaIndisponivelError,
  CODIGO_MAX_TENTATIVAS,
  ehColisaoDeCodigo,
  gerarCodigoDeSala,
} from './codigo.ts';
import { SalasRepo } from './repositorio.ts';
import { SalasProjecao } from './projecao.ts';
import { SalasBroadcaster } from './broadcast.ts';
import { SalasState } from './estado.ts';
import {
  traduzirEventos,
  type ApelidoPorJogadorId,
} from './eventos.ts';
import { getConfig } from '@flicker/config';
import type { AuthenticatedWebSocket } from '../ws/ws.ts';

const CODIGOS_DE_ERRO_DA_SALA: ReadonlySet<CodigoDeErroDaSala> = new Set([
  'DADOS_INVALIDOS',
  'SALA_NAO_ENCONTRADA',
  'SALA_ENCERRADA',
  'SALA_JA_EXISTE',
  'CODIGO_SALA_JA_EXISTE',
  'MEMBRO_ID_JA_EXISTE',
  'SALA_CHEIA',
  'JOGADOR_JA_ASSOCIADO',
  'MEMBRO_NAO_ENCONTRADO',
  'MEMBRO_NAO_ATIVO',
]);

/**
 * Conjunto fechado dos `type` aceitos em `SalaComandoDoCliente`. Usado por
 * `ws.ts` para decidir entre Salas e PING/PONG sem precisar repassar a
 * string crua.
 */
const TIPOS_DE_SALA_COMANDO: ReadonlySet<string> = new Set([
  'CRIAR_SALA',
  'ENTRAR_NA_SALA',
  'SAIR_DA_SALA',
  'ALTERNAR_PRONTIDAO',
  'ENVIAR_MENSAGEM_DE_CHAT',
  'EXPULSAR_MEMBRO',
  'DESBLOQUEAR_JOGADOR',
  'ENCERRAR_SALA',
  'INICIAR_PARTIDA',
]);

/**
 * Type guard puro para `SalaComandoDoCliente`. Exportado para o `ws.ts`
 * usar no despacho (sem precisar parsear duas vezes). Defensivo: aceita
 * qualquer objeto cujo `type` seja um literal conhecido da união.
 */
export function ehSalaComando(value: unknown): value is SalaComandoDoCliente {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && TIPOS_DE_SALA_COMANDO.has(type);
}

/**
 * Mapeia o código de erro do engine para o conjunto fechado de
 * `CodigoDeErroDaSala` exposto no wire. Códigos do engine que não estão
 * no wire (ex.: `MEMBRO_NAO_EM_RECONEXAO`, `APENAS_ANFITRIAO`,
 * `SALA_INCONSISTENTE`) são inalcançáveis a partir dos 3 comandos no
 * escopo (#36) — caem em `DADOS_INVALIDOS` defensivo.
 */
function paraCodigoDeErroDaSala(
  codigo: CodigoDeErro,
): CodigoDeErroDaSala {
  if (CODIGOS_DE_ERRO_DA_SALA.has(codigo as CodigoDeErroDaSala)) {
    return codigo as CodigoDeErroDaSala;
  }
  return 'DADOS_INVALIDOS';
}

export interface SalasHandlersDeps {
  readonly repo: SalasRepo;
  readonly projecao: SalasProjecao;
  readonly broadcast: SalasBroadcaster;
  readonly estado: SalasState;
  /** URL base para montar o link do convite (ex.: `http://localhost:3001/convite`). */
  readonly linkBase: string;
  /** Confere no Redis que a Sessão ainda pertence ao Jogador. */
  readonly revalidarSessao: (sessaoId: string, jogadorId: string) => Promise<boolean>;
  /** Injetável para tornar o retry de colisão determinístico nos testes. */
  readonly gerarCodigo?: () => string;
}

export class SalasHandlers {
  private readonly repo: SalasRepo;
  private readonly projecao: SalasProjecao;
  private readonly broadcast: SalasBroadcaster;
  private readonly estado: SalasState;
  private readonly linkBase: string;
  private readonly revalidarSessao: (sessaoId: string, jogadorId: string) => Promise<boolean>;
  private readonly gerarCodigo: () => string;
  // O lobby da #36 é mononodo. Serializar as mutações evita que dois awaits
  // de persistência confirmem candidatos calculados sobre o mesmo estado.
  private cadeiaDeMutacoes: Promise<void> = Promise.resolve();

  constructor(deps: SalasHandlersDeps) {
    this.repo = deps.repo;
    this.projecao = deps.projecao;
    this.broadcast = deps.broadcast;
    this.estado = deps.estado;
    this.linkBase = deps.linkBase;
    this.revalidarSessao = deps.revalidarSessao;
    this.gerarCodigo = deps.gerarCodigo ?? gerarCodigoDeSala;
  }

/**
   * Despacho principal chamado pelo `ws.ts` em `'message'`. Espera uma
   * mensagem já parseada (JSON.parse feito pelo chamador para evitar
   * dupla-parsing e permitir o despacho de PING/PONG no mesmo caminho).
   *
   * Defesas: a função revalida o tipo com `ehSalaComando` antes de
   * processar — qualquer coisa fora do conjunto fechado vira
   * `ERRO_DA_SALA { DADOS_INVALIDOS }` para o originador. Erros inesperados
   * viram `ERRO_DA_SALA` genérico + `console.error` para diagnóstico.
   */
  async aplicarMensagem(
    socket: AuthenticatedWebSocket,
    mensagem: unknown,
  ): Promise<void> {
    if (!ehSalaComando(mensagem)) {
      this.enviarErro(
        socket,
        'DADOS_INVALIDOS',
        'Comando fora do escopo deste servidor.',
      );
      return;
    }

    const jogadorId = socket.data.jogadorId;
    try {
      await this.enfileirarMutacao(async () => {
        if (exigeRevalidacaoDeSessao(mensagem)) {
          const sessaoValida = await this.revalidarSessao(
            socket.data.sessaoId,
            jogadorId,
          ).catch(() => false);
          if (!sessaoValida) {
            this.fecharPorSessaoInvalida(socket);
            return;
          }
        }

        switch (mensagem.type) {
          case 'CRIAR_SALA':
            await this.handleCriarSala(socket, jogadorId);
            return;
          case 'ENTRAR_NA_SALA':
            await this.handleEntrarNaSala(socket, jogadorId, mensagem.codigoDeSala);
            return;
          case 'SAIR_DA_SALA':
            await this.handleSairDaSala(socket, jogadorId);
            return;
          default:
            this.enviarErro(
              socket,
              'DADOS_INVALIDOS',
              'Comando fora do escopo deste servidor.',
            );
        }
      });
    } catch (erro) {
      console.error('[salas] erro inesperado ao processar comando:', erro);
      this.enviarErro(
        socket,
        'DADOS_INVALIDOS',
        'Erro interno ao processar comando de Sala.',
      );
    }
  }

  private enviarErro(
    socket: AuthenticatedWebSocket,
    codigo: CodigoDeErro,
    mensagem: string,
  ): void {
    const erro: ErroDaSalaEvento = {
      type: 'ERRO_DA_SALA',
      codigo: paraCodigoDeErroDaSala(codigo),
      mensagem,
    };
    this.broadcast.enviarParaSocket(socket, erro);
  }

  private async handleCriarSala(
    socket: AuthenticatedWebSocket,
    jogadorId: string,
  ): Promise<void> {
    const salaId = randomUUID();
    const membroId = randomUUID();

    for (let tentativa = 0; tentativa < CODIGO_MAX_TENTATIVAS; tentativa++) {
      const codigo = this.gerarCodigo();
      const resultado = this.estado.aplicar({
        tipo: 'criar_sala',
        salaId,
        codigo,
        membroId,
        jogadorId,
      });

      if (!resultado.sucesso) {
        // A mesma colisão pode ser detectada antes do INSERT pelo estado
        // local, ou pelo UNIQUE do PostgreSQL quando outra instância já a
        // persistiu. Nos dois casos, gerar outro Código é seguro.
        if (resultado.erro.codigo === 'CODIGO_SALA_JA_EXISTE') {
          continue;
        }
        this.enviarErro(socket, resultado.erro.codigo, resultado.erro.mensagem);
        return;
      }

      try {
        await this.repo.criarSalaAtomica(salaId, jogadorId, 1, codigo);
      } catch (erro) {
        if (ehColisaoDeCodigo(erro)) {
          continue;
        }
        throw erro;
      }

      this.estado.substituirEstado(resultado.estado);

    // Garantir que o apelido do criador está no cache para a tradução
    // engine→wire. O handler já recebeu `WsAuthData.apelido` no
    // handshake; aqui atualizamos o cache do SalasState.
      this.atualizarApelidoSeConhecido(jogadorId, socket.data.apelido);

    // Projeção quente: codigo → salaId, salaId → estado, jogadorId → salaId.
      await this.projecao.definirCodigo(codigo, salaId);
      await this.atualizarProjecaoEstado(resultado.estado, salaId);
      await this.projecao.definirAssociacaoJogador(jogadorId, salaId);

    // Registrar o socket no broadcaster ANTES do broadcast para que o
    // originador também receba os eventos.
      this.broadcast.registrarSocket(jogadorId, salaId, socket);

    // Traduzir e enviar.
      const eventos = traduzirEventos(
        resultado.eventos,
        resultado.estado,
        this.estado.apelidoPorJogadorId,
        this.linkBase,
      );
      this.difundir(eventos, salaId);
      return;
    }

    throw new CodigoDeSalaIndisponivelError();
  }

  private async handleEntrarNaSala(
    socket: AuthenticatedWebSocket,
    jogadorId: string,
    codigoDeSala: string,
  ): Promise<void> {
    if (typeof codigoDeSala !== 'string' || codigoDeSala.length === 0) {
      this.enviarErro(
        socket,
        'DADOS_INVALIDOS',
        'Código de Sala é obrigatório.',
      );
      return;
    }

    let salaId = await this.projecao.obterSalaIdPorCodigo(codigoDeSala);
    if (salaId === null) {
      // A projeção é TTL e pode expirar para Salas abertas sem mutações.
      // O write-model (ADR-0002) é a fonte da verdade: consulta o PG e,
      // encontrado, cura a chave de código no Redis.
      const recuperado = await this.repo.obterSalaAbertaPorCodigo(codigoDeSala);
      if (recuperado !== null) {
        salaId = recuperado;
        await this.projecao.definirCodigo(codigoDeSala, recuperado);
      }
    }
    if (salaId === null) {
      this.enviarErro(
        socket,
        'SALA_NAO_ENCONTRADA',
        'A Sala informada não foi encontrada.',
      );
      return;
    }

    const membroId = randomUUID();

    const resultado = this.estado.aplicar({
      tipo: 'entrar_na_sala',
      salaId,
      membroId,
      jogadorId,
    });

    if (!resultado.sucesso) {
      this.enviarErro(socket, resultado.erro.codigo, resultado.erro.mensagem);
      return;
    }

    const eventoAdmissao = resultado.eventos.find(
      (e) => e.tipo === 'membro_admitido',
    );
    if (eventoAdmissao?.tipo === 'membro_admitido') {
      await this.repo.entrarMembro(salaId, jogadorId, eventoAdmissao.ordemDeEntrada);
    }

    this.estado.substituirEstado(resultado.estado);
    this.atualizarApelidoSeConhecido(jogadorId, socket.data.apelido);
    await this.atualizarProjecaoEstado(resultado.estado, salaId);
    await this.projecao.definirAssociacaoJogador(jogadorId, salaId);

    this.broadcast.registrarSocket(jogadorId, salaId, socket);

    const eventos = traduzirEventos(
      resultado.eventos,
      resultado.estado,
      this.estado.apelidoPorJogadorId,
      this.linkBase,
    );
    this.difundir(eventos, salaId);
  }

  private async handleSairDaSala(
    socket: AuthenticatedWebSocket,
    jogadorId: string,
  ): Promise<void> {
    let salaId = await this.projecao.obterAssociacaoJogador(jogadorId);
    if (salaId === null) {
      // Mesmo fallback do ENTRAR_NA_SALA: a associação vive em chave com
      // TTL, mas o vínculo ativo persiste no PG enquanto a Sala estiver
      // aberta. Sem isso, o Jogador ficaria impossibilitado de sair após
      // a expiração da projeção.
      const recuperado = await this.repo.obterSalaAbertaDoJogador(jogadorId);
      if (recuperado !== null) {
        salaId = recuperado;
        await this.projecao.definirAssociacaoJogador(jogadorId, recuperado);
      }
    }
    if (salaId === null) {
      this.enviarErro(
        socket,
        'MEMBRO_NAO_ENCONTRADO',
        'O Jogador não está associado a nenhuma Sala.',
      );
      return;
    }

    // Capturar codigo para limpar a projeção antes do engine (a referência
    // está no SalasState.abertas e também no Redis).
    const infoSala = this.estado.abertas.get(salaId);
    const codigoSala = infoSala?.sala.codigo
      ?? (await this.projecao.obterEstadoSala(salaId))?.codigo
      ?? null;

    const resultado = this.estado.aplicar({
      tipo: 'sair_da_sala',
      salaId,
      jogadorId,
    });

    if (!resultado.sucesso) {
      this.enviarErro(socket, resultado.erro.codigo, resultado.erro.mensagem);
      return;
    }

    const salaEncerrada = resultado.eventos.some(
      (e) => e.tipo === 'sala_encerrada',
    );
    await this.repo.sairMembroAtomico(salaId, jogadorId, 'saida', salaEncerrada);
    this.estado.substituirEstado(resultado.estado);

    // Se a Sala ficou sem membros ativos, a transação já a marcou como
    // encerrada no PG; aqui só removemos a projeção quente.
    if (salaEncerrada) {
      if (codigoSala !== null) {
        await this.projecao.limparSala(salaId, codigoSala);
      }
      this.estado.abertas.delete(salaId);
    } else {
      await this.atualizarProjecaoEstado(resultado.estado, salaId);
    }

    // Limpa a associação jogador→sala (a Sala pode continuar viva com
    // outros membros). Se a Sala foi encerrada, o `limparSala` já removeu
    // o estado e o codigo; ainda assim removemos a chave do jogador.
    await this.projecao.limparAssociacaoJogador(jogadorId);

    // Broadcast para a sala inteira (incluindo o originador) e remoção
    // do socket do broadcaster. O originador continua sabendo que saiu
    // porque o evento `MEMBRO_SAIU` carrega o seu `jogadorId`.
    const eventos = traduzirEventos(
      resultado.eventos,
      resultado.estado,
      this.estado.apelidoPorJogadorId,
      this.linkBase,
    );
    this.difundir(eventos, salaId);

    // Removemos o socket só DEPOIS do broadcast para que o originador
    // também receba o `MEMBRO_SAIU`. A função abaixo trata idem-potência
    // para múltiplas conexões.
    this.broadcast.removerSocket(socket);
  }

  /**
   * Remove o socket do fan-out quando a conexão fecha. Presença e reconexão
   * não fazem parte da #36.
   */
  handleFechamento(socket: AuthenticatedWebSocket): void {
    // Presença e reconexão pertencem à #38. Nesta issue o close apenas
    // remove a conexão do fan-out para evitar referências órfãs.
    this.broadcast.removerSocket(socket);
  }

  private atualizarApelidoSeConhecido(jogadorId: string, apelido: string): void {
    if (typeof apelido === 'string' && apelido.length > 0) {
      this.estado.apelidoPorJogadorId.set(jogadorId, apelido);
    }
  }

  private async atualizarProjecaoEstado(
    estado: import('@flicker/engine').EstadoDoLobby,
    salaId: string,
  ): Promise<void> {
    const sala = estado.salas.find((s) => s.id === salaId);
    if (sala === undefined) {
      return;
    }
    const projecao = {
      id: sala.id,
      codigo: sala.codigo,
      estado: sala.estado,
      anfitriaoId: sala.anfitriaoId,
      proximaOrdemDeEntrada: sala.proximaOrdemDeEntrada,
      consistente: sala.consistente,
      membros: sala.membros
        .filter((m) => m.estado === 'ativo')
        .map((m) => ({
          id: m.id,
          jogadorId: m.jogadorId,
          ordemDeEntrada: m.ordemDeEntrada,
          pronto: m.pronto,
          presenca: m.presenca,
          anfitriao: sala.anfitriaoId === m.id,
        })),
    };
    await this.projecao.definirEstadoSala(salaId, projecao);
  }

  private difundir(eventos: readonly SalaEventoDoServidor[], salaId: string): void {
    for (const evento of eventos) {
      this.broadcast.enviar(salaId, evento);
    }
  }

  private enfileirarMutacao(operacao: () => Promise<void>): Promise<void> {
    const atual = this.cadeiaDeMutacoes.then(operacao, operacao);
    this.cadeiaDeMutacoes = atual.then(
      () => undefined,
      () => undefined,
    );
    return atual;
  }

  private fecharPorSessaoInvalida(socket: AuthenticatedWebSocket): void {
    try {
      socket.close(4401, 'Unauthorized');
    } catch {
      socket.terminate();
    }
  }
}

/** Helper para o `index.ts` montar `linkBase` a partir de `getConfig`. */
export function obterLinkBase(): string {
  const { lobbyPublicUrl } = getConfig();
  return `${lobbyPublicUrl}/convite`;
}

function exigeRevalidacaoDeSessao(comando: SalaComandoDoCliente): boolean {
  return comando.type === 'CRIAR_SALA' || comando.type === 'ENTRAR_NA_SALA';
}
