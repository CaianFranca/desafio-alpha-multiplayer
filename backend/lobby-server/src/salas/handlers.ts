// Handlers WS de Sala (issues #36, #38, #39, #31).
//
// Roteamento entre o protocolo Sala (`@flicker/shared`) e o engine
// (`@flicker/engine`). Persistência e projeção vivem em `SalasRepo` e
// `SalasProjecao`; a tradução engine→wire vive em `traduzirEventos`.
//
// Comandos no escopo:
//   CRIAR_SALA         -> criarSala(engine)
//   ENTRAR_NA_SALA     -> entrarNaSala(engine), com codigoDeSala → salaId via Redis
//   SAIR_DA_SALA       -> sairDaSala(engine), com salaId via Redis
//   EXPULSAR_MEMBRO    -> expulsarMembro(engine), com membroId via Redis
//   DESBLOQUEAR_JOGADOR -> autorizarRetorno(engine), com jogadorId via Redis
//   ALTERNAR_PRONTIDAO -> alternarProntidao(engine), toggle individual
//   ENCERRAR_SALA      -> encerrarSala(engine), Só Anfitrião, sala aberta
//
// Chat da Sala (issue #34):
//   ENVIAR_MENSAGEM_DE_CHAT -> broadcast MENSAGEM_DE_CHAT + histórico em Redis
//
// Os comandos ainda fora do escopo deste servidor
// (`INICIAR_PARTIDA`) respondem
// `ERRO_DA_SALA` com `codigo: 'DADOS_INVALIDOS'` ao originador.
//
// Erros do engine são roteados ao originador (não broadcast) com o mesmo
// `codigo` do domínio.

import { randomUUID } from 'node:crypto';
import {
  type CodigoDeErro,
  type Comando,
  type EstadoDoLobby,
  type Sala as SalaDominio,
} from '@flicker/engine';
import type {
  SalaComandoDoCliente,
  SalaEventoDoServidor,
  SalaServerMessage,
  ErroDaSalaEvento,
  CodigoDeErroDaSala,
  MensagemDeChatEvento,
  OfertaDeEncaminhamento,
  AceiteDoEncaminhamento,
  PartidaPreparandoEvento,
  PartidaDisponivelEvento,
  PartidaRecusadaEvento,
  PartidaFalhouEvento,
  MembroDaSala,
  EncaminhamentoDaSala,
  CodigoDeErroDoEncaminhamento,
} from '@flicker/shared';
import {
  CodigoDeSalaIndisponivelError,
  CODIGO_MAX_TENTATIVAS,
  ehColisaoDeCodigo,
  gerarCodigoDeSala,
} from './codigo.ts';
import { SalasRepo } from './repositorio.ts';
import { SalasProjecao, serializarSala } from './projecao.ts';
import { SalasBroadcaster } from './broadcast.ts';
import { SalasState } from './estado.ts';
import {
  mapearSala,
  traduzirEventos,
  type ApelidoPorJogadorId,
} from './eventos.ts';
import { SalasReconexao, JANELA_RECONEXAO_SEGUNDOS } from './reconexao.ts';
import { getConfig } from '@flicker/config';
import type { AuthenticatedWebSocket } from '../ws/ws.ts';
import { listarGameServersDisponiveis as listarGameServersShared } from '@flicker/shared';
import type { Redis } from 'ioredis';
import { redisClient as defaultRedis } from '../config/redis.ts';

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
  'APENAS_ANFITRIAO',
  'JOGADOR_EXPULSO',
  'JOGADOR_NAO_BLOQUEADO',
  'SALA_INCONSISTENTE',
  'SALA_ENCAMINHADA',
  'ENCAMINHAMENTO_INVALIDO',
]);

/** Tamanho máximo de uma mensagem de chat (issue #34). Sem trim. */
const TAMANHO_MAXIMO_MENSAGEM = 500;

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
 * no wire (ex.: `MEMBRO_NAO_EM_RECONEXAO`, `SALA_INCONSISTENTE`) são
 * inalcançáveis a partir dos 5 comandos no escopo — caem em
 * `DADOS_INVALIDOS` defensivo.
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
  readonly reconexao: SalasReconexao;
  /** URL base para montar o link do convite (ex.: `http://localhost:3001/convite`). */
  readonly linkBase: string;
  /** Confere no Redis que a Sessão ainda pertence ao Jogador. */
  readonly revalidarSessao: (sessaoId: string, jogadorId: string) => Promise<boolean>;
  /** Injetável para tornar o retry de colisão determinístico nos testes. */
  readonly gerarCodigo?: () => string;
  /** Janela de reconexão em ms — injetável para testes (default 60000). */
  readonly janelaReconexaoMs?: number;
  /** Injetável para encaminhamento — nos testes substitui o fetch real. */
  readonly ofertarEncaminhamento?: (oferta: OfertaDeEncaminhamento) => Promise<AceiteDoEncaminhamento>;
  readonly cancelarPartida?: (serverId: string, partidaId: string, motivo: string, serverUrl?: string) => Promise<void>;
  readonly redis?: Redis;
  readonly timeoutMs?: number;
}

export class SalasHandlers {
  private readonly repo: SalasRepo;
  private readonly projecao: SalasProjecao;
  private readonly broadcast: SalasBroadcaster;
  private readonly estado: SalasState;
  private readonly reconexao: SalasReconexao;
  private readonly linkBase: string;
  private readonly revalidarSessao: (sessaoId: string, jogadorId: string) => Promise<boolean>;
  private readonly gerarCodigo: () => string;
  private readonly janelaReconexaoMs: number;
  private readonly ofertarEncaminhamentoInjetado?: (oferta: OfertaDeEncaminhamento) => Promise<AceiteDoEncaminhamento>;
  private readonly cancelarPartidaInjetado?: (serverId: string, partidaId: string, motivo: string, serverUrl?: string) => Promise<void>;
  private readonly redis: Redis;
  private readonly timeoutMs: number;
  private readonly encaminhamentosEmVoo: Set<string> = new Set();
  // O lobby da #36 é mononodo. Serializar as mutações evita que dois awaits
  // de persistência confirmem candidatos calculados sobre o mesmo estado.
  private cadeiaDeMutacoes: Promise<void> = Promise.resolve();
  private readonly timersDeReconexao: Map<string, NodeJS.Timeout> = new Map();

  constructor(deps: SalasHandlersDeps) {
    this.repo = deps.repo;
    this.projecao = deps.projecao;
    this.broadcast = deps.broadcast;
    this.estado = deps.estado;
    this.reconexao = deps.reconexao;
    this.linkBase = deps.linkBase;
    this.revalidarSessao = deps.revalidarSessao;
    this.gerarCodigo = deps.gerarCodigo ?? gerarCodigoDeSala;
    this.janelaReconexaoMs = deps.janelaReconexaoMs ?? JANELA_RECONEXAO_SEGUNDOS * 1000;
    this.ofertarEncaminhamentoInjetado = deps.ofertarEncaminhamento;
    this.cancelarPartidaInjetado = deps.cancelarPartida;
    this.redis = deps.redis ?? defaultRedis;
    this.timeoutMs = deps.timeoutMs ?? 5000;
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
          case 'ENVIAR_MENSAGEM_DE_CHAT':
            await this.handleEnviarMensagemDeChat(socket, jogadorId, mensagem.conteudo);
            return;
          case 'EXPULSAR_MEMBRO':
            await this.handleExpulsarMembro(socket, jogadorId, mensagem.membroId);
            return;
          case 'DESBLOQUEAR_JOGADOR':
            await this.handleDesbloquearJogador(socket, jogadorId, mensagem.jogadorId);
            return;
          case 'ALTERNAR_PRONTIDAO':
            await this.handleAlternarProntidao(socket, jogadorId);
            return;
          case 'ENCERRAR_SALA':
            await this.handleEncerrarSala(socket, jogadorId);
            return;
          case 'INICIAR_PARTIDA':
            await this.handleIniciarPartida(socket, jogadorId);
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

    if (this.salaEstaEncaminhada(salaId)) {
      this.enviarErro(socket, 'SALA_ENCAMINHADA', 'A Sala está encaminhada e não aceita novos membros.');
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

    // Replay do histórico de chat (issue #34): só na entrada nova
    // (`membro_admitido`). Quem já estava na sala (reenvio idempotente)
    // não recebe o histórico de novo.
    if (eventoAdmissao?.tipo === 'membro_admitido') {
      const historico = await this.projecao.obterHistoricoDeChat(salaId);
      for (const item of historico) {
        this.broadcast.enviarParaSocket(socket, item);
      }
    }
  }

  private async handleSairDaSala(
    socket: AuthenticatedWebSocket,
    jogadorId: string,
  ): Promise<void> {
    let salaId = await this.projecao.obterAssociacaoJogador(jogadorId);
    if (salaId === null) {
      // Fallback inclui 'encaminhada' para retornar SALA_ENCAMINHADA correto (A3)
      const recuperado = await this.repo.obterSalaAtivaDoJogador(jogadorId);
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
    if (this.salaEstaEncaminhada(salaId)) {
      this.enviarErro(socket, 'SALA_ENCAMINHADA', 'A Sala está encaminhada e sua composição está congelada.');
      return;
    }
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
    // A sucessão do Anfitrião é gravada no mesmo commit da saída para que a
    // reconstrução do boot (ADR-0002) não restaure um Anfitrião já sucedido.
    let novoAnfitriaoJogadorId: string | undefined;
    const sucessao = resultado.eventos.find(
      (e) => e.tipo === 'anfitriao_sucedido',
    );
    if (sucessao?.tipo === 'anfitriao_sucedido') {
      const salaNova = resultado.estado.salas.find((s) => s.id === salaId);
      const membroNovo = salaNova?.membros.find(
        (m) => m.id === sucessao.anfitriaoNovoId,
      );
      if (membroNovo !== undefined) {
        novoAnfitriaoJogadorId = membroNovo.jogadorId;
      }
    }
    await this.repo.sairMembroAtomico(
      salaId,
      jogadorId,
      'saida',
      salaEncerrada,
      novoAnfitriaoJogadorId,
    );
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

  private async handleExpulsarMembro(
    socket: AuthenticatedWebSocket,
    jogadorId: string,
    membroId: string,
  ): Promise<void> {
    if (typeof membroId !== 'string' || membroId.length === 0) {
      this.enviarErro(
        socket,
        'DADOS_INVALIDOS',
        'membroId é obrigatório.',
      );
      return;
    }

    let salaId = await this.projecao.obterAssociacaoJogador(jogadorId);
    if (salaId === null) {
      const recuperado = await this.repo.obterSalaAtivaDoJogador(jogadorId);
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

    // Resolver o membroId do anfitrião no estado do engine.
    const salaInfo = this.estado.abertas.get(salaId);
    if (salaInfo === undefined) {
      this.enviarErro(
        socket,
        'SALA_NAO_ENCONTRADA',
        'Sala não encontrada no servidor.',
      );
      return;
    }
    const anfitriaoMembroId = salaInfo.sala.anfitriaoId;
    if (anfitriaoMembroId === null) {
      this.enviarErro(
        socket,
        'DADOS_INVALIDOS',
        'Sala sem Anfitrião definido.',
      );
      return;
    }

    if (this.salaEstaEncaminhada(salaId)) {
      this.enviarErro(socket, 'SALA_ENCAMINHADA', 'A Sala está encaminhada e não aceita expulsões.');
      return;
    }

    // Autorização: o emissor no WebSocket deve ser o Anfitrião atual. O
    // engine só valida que o `anfitriaoMembroId` recebido é o host — quem
    // fala é responsabilidade deste handler (edge).
    if (!this.anfitriaoEstaAutorizando(socket, jogadorId, salaInfo.sala)) {
      return;
    }

    const resultado = this.estado.aplicar({
      tipo: 'expulsar_membro',
      salaId,
      anfitriaoMembroId,
      membroAlvoId: membroId,
    });

    if (!resultado.sucesso) {
      this.enviarErro(socket, resultado.erro.codigo, resultado.erro.mensagem);
      return;
    }

    // Extrair jogadorId alvo do evento de domínio para persistir a expulsão.
    const eventoExpulsao = resultado.eventos.find(
      (e) => e.tipo === 'membro_expulsado',
    );
    if (eventoExpulsao?.tipo === 'membro_expulsado') {
      await this.repo.expulsarMembroAtomico(salaId, eventoExpulsao.jogadorId);
    }

    this.estado.substituirEstado(resultado.estado);

    // Atualiza a projeção quente: o expulso não pode continuar listado como
    // membro ativo nem manter a associação jogador→sala no Redis.
    await this.atualizarProjecaoEstado(resultado.estado, salaId);
    if (eventoExpulsao?.tipo === 'membro_expulsado') {
      await this.projecao.limparAssociacaoJogador(eventoExpulsao.jogadorId);
      // Se o alvo estava em janela de reconexão, cancelar o timer e a chave Redis.
      await this.reconexao.limparJanela(salaId, eventoExpulsao.jogadorId).catch(() => undefined);
      this.limparTimer(salaId, membroId);
    }

    const eventos = traduzirEventos(
      resultado.eventos,
      resultado.estado,
      this.estado.apelidoPorJogadorId,
      this.linkBase,
    );
    this.difundir(eventos, salaId);
  }

  private async handleDesbloquearJogador(
    socket: AuthenticatedWebSocket,
    jogadorId: string,
    jogadorAlvoId: string,
  ): Promise<void> {
    if (typeof jogadorAlvoId !== 'string' || jogadorAlvoId.length === 0) {
      this.enviarErro(
        socket,
        'DADOS_INVALIDOS',
        'jogadorId é obrigatório.',
      );
      return;
    }

    let salaId = await this.projecao.obterAssociacaoJogador(jogadorId);
    if (salaId === null) {
      const recuperado = await this.repo.obterSalaAtivaDoJogador(jogadorId);
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

    const salaInfo = this.estado.abertas.get(salaId);
    if (salaInfo === undefined) {
      this.enviarErro(
        socket,
        'SALA_NAO_ENCONTRADA',
        'Sala não encontrada no servidor.',
      );
      return;
    }
    const anfitriaoMembroId = salaInfo.sala.anfitriaoId;
    if (anfitriaoMembroId === null) {
      this.enviarErro(
        socket,
        'DADOS_INVALIDOS',
        'Sala sem Anfitrião definido.',
      );
      return;
    }

    if (this.salaEstaEncaminhada(salaId)) {
      this.enviarErro(socket, 'SALA_ENCAMINHADA', 'A Sala está encaminhada e não aceita desbloqueios.');
      return;
    }

    // Autorização: o emissor no WebSocket deve ser o Anfitrião atual. O
    // engine só valida que o `anfitriaoMembroId` recebido é o host — quem
    // fala é responsabilidade deste handler (edge).
    if (!this.anfitriaoEstaAutorizando(socket, jogadorId, salaInfo.sala)) {
      return;
    }

    const resultado = this.estado.aplicar({
      tipo: 'autorizar_retorno',
      salaId,
      anfitriaoMembroId,
      jogadorId: jogadorAlvoId,
    });

    if (!resultado.sucesso) {
      this.enviarErro(socket, resultado.erro.codigo, resultado.erro.mensagem);
      return;
    }

    await this.repo.desbloquearMembro(salaId, jogadorAlvoId);

    this.estado.substituirEstado(resultado.estado);

    // Atualiza a projeção quente para refletir a remoção do bloqueio.
    await this.atualizarProjecaoEstado(resultado.estado, salaId);

    const eventos = traduzirEventos(
      resultado.eventos,
      resultado.estado,
      this.estado.apelidoPorJogadorId,
      this.linkBase,
    );
    this.difundir(eventos, salaId);
  }

  private agendarExpiracao(salaId: string, membroId: string, delayMs: number): void {
    const chave = this.chaveTimer(salaId, membroId);
    const existente = this.timersDeReconexao.get(chave);
    if (existente !== undefined) {
      clearTimeout(existente);
    }
    const timer = setTimeout(() => {
      void this.handleExpirar(salaId, membroId);
    }, delayMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.timersDeReconexao.set(chave, timer);
  }

  private async handleAlternarProntidao(
    socket: AuthenticatedWebSocket,
    jogadorId: string,
  ): Promise<void> {
    let salaId = await this.projecao.obterAssociacaoJogador(jogadorId);
    if (salaId === null) {
      const recuperado = await this.repo.obterSalaAtivaDoJogador(jogadorId);
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
    if (this.salaEstaEncaminhada(salaId)) {
      this.enviarErro(socket, 'SALA_ENCAMINHADA', 'A Sala está encaminhada e sua composição está congelada.');
      return;
    }

    const resultado = this.estado.aplicar({
      tipo: 'alternar_prontidao',
      salaId,
      jogadorId,
    });

    if (!resultado.sucesso) {
      this.enviarErro(socket, resultado.erro.codigo, resultado.erro.mensagem);
      return;
    }

    // Prontidão vive só na projeção Redis (ADR-0002) via estado serializado.
    this.estado.substituirEstado(resultado.estado);
    await this.atualizarProjecaoEstado(resultado.estado, salaId);

    const eventos = traduzirEventos(
      resultado.eventos,
      resultado.estado,
      this.estado.apelidoPorJogadorId,
      this.linkBase,
    );
    this.difundir(eventos, salaId);
  }

  private async handleEncerrarSala(
    socket: AuthenticatedWebSocket,
    jogadorId: string,
  ): Promise<void> {
    let salaId = await this.projecao.obterAssociacaoJogador(jogadorId);
    if (salaId === null) {
      const recuperado = await this.repo.obterSalaAtivaDoJogador(jogadorId);
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

    const salaInfo = this.estado.abertas.get(salaId);
    if (salaInfo === undefined) {
      this.enviarErro(
        socket,
        'SALA_NAO_ENCONTRADA',
        'Sala não encontrada no servidor.',
      );
      return;
    }
    const anfitriaoMembroId = salaInfo.sala.anfitriaoId;
    if (anfitriaoMembroId === null) {
      this.enviarErro(
        socket,
        'DADOS_INVALIDOS',
        'Sala sem Anfitrião definido.',
      );
      return;
    }

    if (!this.anfitriaoEstaAutorizando(socket, jogadorId, salaInfo.sala)) {
      return;
    }

    if (this.salaEstaEncaminhada(salaId)) {
      this.enviarErro(socket, 'SALA_ENCAMINHADA', 'A Sala está encaminhada e não pode ser encerrada.');
      return;
    }

    // Captura dados antes do engine para limpar projeção após broadcast.
    const codigoSala = salaInfo.sala.codigo;
    const jogadoresDaSala = salaInfo.sala.membros
      .filter((m) => m.estado === 'ativo')
      .map((m) => m.jogadorId);

    const resultado = this.estado.aplicar({
      tipo: 'encerrar_sala',
      salaId,
      anfitriaoMembroId,
    });

    if (!resultado.sucesso) {
      this.enviarErro(socket, resultado.erro.codigo, resultado.erro.mensagem);
      return;
    }

    await this.repo.encerrarSalaAtomico(salaId);

    this.estado.substituirEstado(resultado.estado);

    // Broadcast ANTES de limpar — todos os sockets ainda estão registrados.
    const eventos = traduzirEventos(
      resultado.eventos,
      resultado.estado,
      this.estado.apelidoPorJogadorId,
      this.linkBase,
    );
    this.difundir(eventos, salaId);

    // Limpeza da projeção quente: estado + codigo + cada jogador→sala.
    await this.projecao.limparSala(salaId, codigoSala);
    for (const jid of jogadoresDaSala) {
      await this.projecao.limparAssociacaoJogador(jid);
    }
    this.estado.abertas.delete(salaId);

    // Remover sockets do fan-out da sala encerrada (evita vazamento).
    this.broadcast.removerPorSala(salaId);
  }

  // --- Encaminhamento (issue #48) ---

  private async handleIniciarPartida(
    socket: AuthenticatedWebSocket,
    jogadorId: string,
  ): Promise<void> {
    // Resolver sala do anfitrião
    let salaId = await this.projecao.obterAssociacaoJogador(jogadorId);
    if (salaId === null) {
      salaId = await this.repo.obterSalaAbertaDoJogador(jogadorId);
      if (salaId !== null) await this.projecao.definirAssociacaoJogador(jogadorId, salaId);
      // fallback para ativa (encaminhada) para mensagem de erro correta
      if (salaId === null) {
        salaId = await this.repo.obterSalaAtivaDoJogador(jogadorId);
        if (salaId !== null) await this.projecao.definirAssociacaoJogador(jogadorId, salaId);
      }
    }
    if (salaId === null) {
      this.enviarErro(socket, 'MEMBRO_NAO_ENCONTRADO', 'O Jogador não está associado a nenhuma Sala.');
      return;
    }

    const salaInfo = this.estado.abertas.get(salaId);
    if (salaInfo === undefined) {
      this.enviarErro(socket, 'SALA_NAO_ENCONTRADA', 'Sala não encontrada no servidor.');
      return;
    }

    // Trava em voo
    if (this.encaminhamentosEmVoo.has(salaId)) {
      this.enviarErro(socket, 'DADOS_INVALIDOS', 'Já existe um encaminhamento em andamento para esta Sala.');
      return;
    }

    // Bloqueio se já encaminhada
    if (this.salaEstaEncaminhada(salaId)) {
      this.enviarErro(socket, 'SALA_ENCAMINHADA', 'A Sala já foi encaminhada.');
      return;
    }

    const anfitriaoMembroId = salaInfo.sala.anfitriaoId;
    if (anfitriaoMembroId === null) {
      this.enviarErro(socket, 'DADOS_INVALIDOS', 'Sala sem Anfitrião definido.');
      return;
    }
    if (!this.anfitriaoEstaAutorizando(socket, jogadorId, salaInfo.sala)) {
      return;
    }

    const resultado = this.estado.aplicar({
      tipo: 'encaminhar_sala',
      salaId,
      anfitriaoMembroId,
    } satisfies Comando);

    if (!resultado.sucesso) {
      this.enviarErro(socket, resultado.erro.codigo, resultado.erro.mensagem);
      return;
    }

    // engine encaminhar_sala não altera estado, apenas emite encaminhamento_iniciado
    this.estado.substituirEstado(resultado.estado);
    await this.atualizarProjecaoEstado(resultado.estado, salaId);

    // Broadcast via tradutor (PARTIDA_PREPARANDO + SALA_ATUALIZADA)
    const evs = traduzirEventos(resultado.eventos, resultado.estado, this.estado.apelidoPorJogadorId, this.linkBase);
    this.difundir(evs, salaId);

    this.encaminhamentosEmVoo.add(salaId);

    // Construir roster para encaminhamento — ordenar por ordemDeEntrada (A1: valida 4)
    const sala = this.estado.abertas.get(salaId)?.sala ?? salaInfo.sala;
    const membrosAtivosOrdenados = [...sala.membros]
      .filter((m) => m.estado === 'ativo')
      .sort((a, b) => a.ordemDeEntrada - b.ordemDeEntrada);
    if (membrosAtivosOrdenados.length !== 4) {
      this.encaminhamentosEmVoo.delete(salaId);
      this.enviarErro(socket, 'ENCAMINHAMENTO_INVALIDO', 'Composição inválida para encaminhamento — esperado 4 membros ativos.');
      return;
    }
    const membrosRoster = membrosAtivosOrdenados.slice(0, 4).map((m) => ({
      id: m.id,
      jogadorId: m.jogadorId,
      apelido: this.estado.apelidoPorJogadorId.get(m.jogadorId) ?? '',
      ordemDeEntrada: m.ordemDeEntrada,
      presenca: m.presenca,
      prontidao: m.pronto,
    }));
    const roster = membrosRoster as [MembroDaSala, MembroDaSala, MembroDaSala, MembroDaSala];

    const oferta: OfertaDeEncaminhamento = {
      salaId,
      codigoDeSala: sala.codigo,
      roster,
    };

    // Encaminhamento assíncrono fora da cadeiaDeMutacoes (protegido pela trava em voo)
    void this.executarEncaminhamento(salaId, oferta);
  }

  private async executarEncaminhamento(salaId: string, oferta: OfertaDeEncaminhamento): Promise<void> {
    let aceite: AceiteDoEncaminhamento | null = null;
    let gameServerUrl: string | undefined;
    let gameServerId: string | undefined;
    let erroKind: 'recusa' | 'falhou' | null = null;
    let erroMotivo = '';
    let erroCodigo: CodigoDeErroDoEncaminhamento = 'ENCAMINHAMENTO_RECUSADO';
    try {
      if (this.ofertarEncaminhamentoInjetado) {
        aceite = await this.ofertarEncaminhamentoInjetado(oferta);
        gameServerId = aceite.serverId;
      } else {
        const disponiveis = await listarGameServersShared(this.redis);
        if (disponiveis.length === 0) {
          erroKind = 'recusa';
          erroMotivo = 'Nenhum game-server disponível';
          erroCodigo = 'ENCAMINHAMENTO_RECUSADO';
        } else {
          // TODO: multi-nó precisa SETNX em Redis para trava em voo e escolha consistente.
          // Por ora, mononodo: escolha determinística (primeiro por serverId) para facilitar testes.
          const disponiveisOrdenados = [...disponiveis].sort((a, b) => a.serverId.localeCompare(b.serverId));
          const escolhido = disponiveisOrdenados[0]!;
          gameServerId = escolhido.serverId;
          const baseUrl = (escolhido.url as string | undefined) ?? (escolhido.host && escolhido.port ? `http://${escolhido.host}:${escolhido.port}` : undefined);
          if (!baseUrl) {
            erroKind = 'recusa';
            erroMotivo = 'Game-server sem URL';
          } else {
            gameServerUrl = baseUrl;
            const url = `${baseUrl.replace(/\/$/, '')}/api/encaminhamento`;
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
              const resp = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(oferta),
                signal: controller.signal,
              });
              if (resp.ok) {
                const body = (await resp.json()) as { partidaId: string; serverId: string };
                aceite = { partidaId: body.partidaId, serverId: body.serverId };
                gameServerId = body.serverId;
                gameServerUrl = baseUrl;
              } else if (resp.status === 409 || resp.status === 400) {
                erroKind = 'recusa';
                try {
                  const body = (await resp.json()) as { codigo?: CodigoDeErroDoEncaminhamento; motivo?: string };
                  erroMotivo = body.motivo ?? `recusa ${resp.status}`;
                  erroCodigo = (body.codigo as CodigoDeErroDoEncaminhamento) ?? 'ENCAMINHAMENTO_RECUSADO';
                } catch {
                  erroMotivo = `recusa ${resp.status}`;
                }
              } else {
                erroKind = 'falhou';
                erroMotivo = `game-server respondeu ${resp.status}`;
                erroCodigo = 'ENCAMINHAMENTO_FALHOU';
              }
            } catch (e) {
              const isAbort = (e as Error).name === 'AbortError';
              erroKind = 'falhou';
              erroMotivo = isAbort ? 'timeout ao contatar game-server' : (e as Error).message;
              erroCodigo = 'ENCAMINHAMENTO_FALHOU';
            } finally {
              clearTimeout(t);
            }
          }
        }
      }
    } catch (e) {
      const rec = e as { codigo?: CodigoDeErroDoEncaminhamento; motivo?: string; message?: string };
      if (rec?.codigo === 'ENCAMINHAMENTO_RECUSADO' || rec?.codigo === 'ROSTER_INVALIDO') {
        erroKind = 'recusa';
        erroMotivo = rec.motivo ?? rec.message ?? 'encaminhamento recusado';
        erroCodigo = rec.codigo as CodigoDeErroDoEncaminhamento;
      } else {
        erroKind = 'falhou';
        erroMotivo = (e as Error).message;
        erroCodigo = 'ENCAMINHAMENTO_FALHOU';
      }
    }

    // Finalizar dentro da cadeiaDeMutacoes
    await this.enfileirarMutacao(async () => {
      try {
        if (aceite) {
          const resAceite = this.estado.aplicar({ tipo: 'aceitar_encaminhamento', salaId } satisfies Comando);
          if (resAceite.sucesso) {
            try {
              await this.repo.persistirEncaminhamento(salaId, aceite.serverId, aceite.partidaId);
              this.estado.substituirEstado(resAceite.estado);
              // atualizar projeção com encaminhamento
              const salaDomain = resAceite.estado.salas.find((s) => s.id === salaId);
              if (salaDomain) {
                await this.projecao.definirEstadoSala(salaId, serializarSala(salaDomain, { serverId: aceite.serverId, partidaId: aceite.partidaId }));
              }
              const disponivel: PartidaDisponivelEvento = { type: 'PARTIDA_DISPONIVEL', partidaId: aceite.partidaId, serverId: aceite.serverId };
              this.broadcast.enviar(salaId, disponivel);
              // SALA_ATUALIZADA com snapshot encaminhada
              const salaAtual = this.estado.abertas.get(salaId)?.sala;
              if (salaAtual) {
                const salaWire = mapearSala(salaAtual, this.estado.apelidoPorJogadorId, this.linkBase, { serverId: aceite.serverId, partidaId: aceite.partidaId });
                this.broadcast.enviar(salaId, { type: 'SALA_ATUALIZADA', sala: salaWire });
              } else {
                const evs2 = traduzirEventos(resAceite.eventos, resAceite.estado, this.estado.apelidoPorJogadorId, this.linkBase);
                this.difundir(evs2, salaId);
              }
            } catch (e) {
              console.error(`[salas] falha ao persistir encaminhamento sala=${salaId} partida=${aceite.partidaId}`, e);
              // Rollback: cancelar partida órfã e manter sala aberta (A2)
              try {
                if (this.cancelarPartidaInjetado) {
                  await this.cancelarPartidaInjetado(aceite.serverId, aceite.partidaId, 'falha ao persistir', gameServerUrl);
                } else if (gameServerUrl) {
                  const url = `${gameServerUrl.replace(/\/$/, '')}/api/encaminhamento/${aceite.partidaId}`;
                  await fetch(url, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partidaId: aceite.partidaId, motivo: 'falha ao persistir' }) }).catch(() => undefined);
                }
              } catch (cancelErr) {
                console.error(`[salas] falha ao cancelar partida órfã ${aceite.partidaId}`, cancelErr);
              }
              const resFalhaPersist = this.estado.aplicar({ tipo: 'registrar_falha_do_encaminhamento', salaId } satisfies Comando);
              if (resFalhaPersist.sucesso) {
                this.estado.substituirEstado(resFalhaPersist.estado);
                await this.atualizarProjecaoEstado(resFalhaPersist.estado, salaId);
              }
              const falhouPersist: PartidaFalhouEvento = { type: 'PARTIDA_FALHOU', codigo: 'ENCAMINHAMENTO_FALHOU', motivo: 'falha ao persistir encaminhamento — partida cancelada' };
              this.broadcast.enviar(salaId, falhouPersist);
            }
            } else {
            // Revalidação falhou — composição mudou, cancelar partida
            try {
              if (this.cancelarPartidaInjetado) {
                await this.cancelarPartidaInjetado(aceite.serverId, aceite.partidaId, 'composicao alterada', gameServerUrl);
              } else if (gameServerUrl) {
                const url = `${gameServerUrl.replace(/\/$/, '')}/api/encaminhamento/${aceite.partidaId}`;
                await fetch(url, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partidaId: aceite.partidaId, motivo: 'composicao alterada' }) }).catch(() => undefined);
              }
            } catch (e) {
              console.error(`[salas] falha ao cancelar partida ${aceite.partidaId}`, e);
            }
            // registrar falha no engine para emitir evento correspondente? mantemos aberta com PARTIDA_FALHOU
            const resFalha = this.estado.aplicar({ tipo: 'registrar_falha_do_encaminhamento', salaId } satisfies Comando);
            if (resFalha.sucesso) {
              this.estado.substituirEstado(resFalha.estado);
              await this.atualizarProjecaoEstado(resFalha.estado, salaId);
            }
            const falhou: PartidaFalhouEvento = { type: 'PARTIDA_FALHOU', codigo: 'ENCAMINHAMENTO_FALHOU', motivo: resAceite.erro?.mensagem ?? 'composicao alterada — partida cancelada' };
            this.broadcast.enviar(salaId, falhou);
            const evs3 = traduzirEventos(resFalha.sucesso ? resFalha.eventos : [], resFalha.sucesso ? resFalha.estado : this.estado.estado, this.estado.apelidoPorJogadorId, this.linkBase);
            // Filtrar duplicado de PARTIDA_FALHOU já enviado
            this.difundir(
              evs3.filter((ev) => (ev as { type: string }).type !== 'PARTIDA_FALHOU'),
              salaId,
            );
          }
        } else if (erroKind === 'recusa') {
          const resRecusa = this.estado.aplicar({ tipo: 'recusar_encaminhamento', salaId } satisfies Comando);
          if (resRecusa.sucesso) {
            this.estado.substituirEstado(resRecusa.estado);
            await this.atualizarProjecaoEstado(resRecusa.estado, salaId);
          }
          const recusada: PartidaRecusadaEvento = { type: 'PARTIDA_RECUSADA', codigo: erroCodigo, motivo: erroMotivo || 'encaminhamento recusado' };
          this.broadcast.enviar(salaId, recusada);
        } else {
          const resFalha = this.estado.aplicar({ tipo: 'registrar_falha_do_encaminhamento', salaId } satisfies Comando);
          if (resFalha.sucesso) {
            this.estado.substituirEstado(resFalha.estado);
            await this.atualizarProjecaoEstado(resFalha.estado, salaId);
          }
          // R1: timeout (AbortError) mantém aberta com PARTIDA_FALHOU (infra), recusa 409/400 com PARTIDA_RECUSADA
          const falhou: PartidaFalhouEvento = { type: 'PARTIDA_FALHOU', codigo: erroCodigo, motivo: erroMotivo || 'falha ao encaminhar' };
          this.broadcast.enviar(salaId, falhou);
        }
      } finally {
        this.encaminhamentosEmVoo.delete(salaId);
      }
    });
  }

  private salaEstaEncaminhada(salaId: string): boolean {
    const info = this.estado.abertas.get(salaId);
    return info?.sala.estado === 'encaminhada';
  }

  /**
   * Chat da Sala (issue #34). Roteia pela `cadeiaDeMutacoes` como os demais
   * comandos (serialização mononodo), mas não toca o engine — o chat é
   * exclusivo do lobby-server. Persiste o histórico na projeção Redis e faz
   * broadcast a todos os Membros. Mensagens vazias (incluindo só-espaços, com
   * trim) ou acima de 500 chars são recusadas com `ERRO_DA_SALA { DADOS_INVALIDOS }`
   * ao originador, sem broadcast. Remetente sem Sala associada recebe
   * `MEMBRO_NAO_ENCONTRADO`.
   */
  private async handleEnviarMensagemDeChat(
    socket: AuthenticatedWebSocket,
    jogadorId: string,
    conteudo: unknown,
  ): Promise<void> {
    // Resolver a Sala do jogador: projeção primeiro, fallback ao PG (A3: inclui encaminhada)
    let salaId = await this.projecao.obterAssociacaoJogador(jogadorId);
    if (salaId === null) {
      salaId = await this.repo.obterSalaAtivaDoJogador(jogadorId);
      if (salaId !== null) {
        await this.projecao.definirAssociacaoJogador(jogadorId, salaId);
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

    // Validação: string crua, 1..500 caracteres; só-espaços recusadas (trim).
    if (
      typeof conteudo !== 'string'
      || conteudo.trim().length < 1
      || conteudo.length > TAMANHO_MAXIMO_MENSAGEM
    ) {
      this.enviarErro(
        socket,
        'DADOS_INVALIDOS',
        'Mensagem de chat inválida (vazia, só-espaços ou acima de 500 caracteres).',
      );
      return;
    }

    const infoSala = this.estado.abertas.get(salaId);
    if (this.salaEstaEncaminhada(salaId)) {
      this.enviarErro(socket, 'SALA_ENCAMINHADA', 'A Sala está encaminhada e não aceita mais mensagens.');
      return;
    }
    const membro = infoSala?.sala.membros.find((m) => m.jogadorId === jogadorId);
    if (membro === undefined) {
      this.enviarErro(
        socket,
        'MEMBRO_NAO_ENCONTRADO',
        'Membro não encontrado na Sala.',
      );
      return;
    }

    const evento: MensagemDeChatEvento = {
      type: 'MENSAGEM_DE_CHAT',
      membroId: membro.id,
      apelido: socket.data.apelido,
      conteudo,
      enviadoEm: new Date().toISOString(),
    };

    await this.projecao.adicionarMensagemDeChat(salaId, evento);
    this.broadcast.enviar(salaId, evento);
  }

  /**
   * Rearma timers de reconexão após restart, lendo TTL do Redis (B2).
   * Para cada sala inconsistente e membro em_reconexao:
   *   ttl>=0 → agenda com ttl*1000
   *   ttl==-2 → enfileira expiração imediata
   *   ttl==-1 → define janela nova e agenda
   * Ao final confirma todas as salas idempotente (B1).
   */
  async rearmarAposRestart(): Promise<void> {
    const expiracoesImediatas: Array<{ salaId: string; membroId: string }> = [];
    for (const [salaId, info] of this.estado.abertas) {
      if (info.sala.consistente) {
        continue;
      }
      for (const membro of info.sala.membros) {
        if (membro.estado !== 'ativo' || membro.presenca !== 'em_reconexao') {
          continue;
        }
        const ttl = await this.reconexao.obterJanela(salaId, membro.jogadorId);
        if (ttl >= 0) {
          this.agendarExpiracao(salaId, membro.id, ttl * 1000);
        } else if (ttl === -2) {
          expiracoesImediatas.push({ salaId, membroId: membro.id });
        } else if (ttl === -1) {
          await this.reconexao.definirJanela(salaId, membro.jogadorId);
          this.agendarExpiracao(salaId, membro.id, this.janelaReconexaoMs);
        }
      }
    }
    this.estado.confirmarTodasSalas();
    for (const [salaId, info] of this.estado.abertas) {
      await this.atualizarProjecaoEstado(this.estado.estado, salaId);
    }
    // Expirações imediatas somente após a confirmação de consistência: o engine
    // rejeita `expirar_reconexao` em Sala inconsistente (SALA_INCONSISTENTE) e o
    // caminho de falha limparia a janela sem encerrar o vínculo.
    for (const { salaId, membroId } of expiracoesImediatas) {
      void this.handleExpirar(salaId, membroId);
    }
  }

  /**
   * Remove o socket do fan-out quando a conexão fecha. Presença por Jogador:
   * só inicia a janela de reconexão quando o último socket do Jogador fecha.
   */
  handleFechamento(socket: AuthenticatedWebSocket): void {
    const { salaId, jogadorId, restantes } = this.broadcast.removerSocket(socket);
    if (salaId === null || jogadorId === null) {
      return;
    }
    // Múltiplas conexões do mesmo Jogador contam como uma única presença.
    if (restantes !== 0) {
      return;
    }
    void this.enfileirarMutacao(async () => {
      const salaInfo = this.estado.abertas.get(salaId);
      if (salaInfo === undefined) {
        // Fallback: tentar via projeção ou PG já removida? Nada a fazer.
        return;
      }
      const membro = salaInfo.sala.membros.find(
        (m) => m.jogadorId === jogadorId && m.estado === 'ativo',
      );
      if (membro === undefined) {
        return;
      }
      if (membro.presenca === 'em_reconexao') {
        return;
      }
      const resultado = this.estado.aplicar({
        tipo: 'desconectar_jogador',
        salaId,
        jogadorId,
      });
      if (!resultado.sucesso) {
        return;
      }
      this.estado.substituirEstado(resultado.estado);
      await this.atualizarProjecaoEstado(resultado.estado, salaId);
      // A associação jogador→sala permanece durante a janela para permitir
      // a reconexão automática; a janela expira via timer.
      await this.reconexao.definirJanela(salaId, jogadorId);
      this.agendarExpiracao(salaId, membro.id, this.janelaReconexaoMs);
      const eventos = traduzirEventos(
        resultado.eventos,
        resultado.estado,
        this.estado.apelidoPorJogadorId,
        this.linkBase,
      );
      this.difundir(eventos, salaId);
    });
  }

  /**
   * Tenta a reconexão automática quando um novo WS autentica. Chamado por
   * `ws.ts` após preencher `socket.data`. Verifica se o Jogador tem vínculo
   * ativo em `em_reconexao` (via projeção + estado + PG fallback) e, em caso
   * positivo, aplica `reconectar_jogador`, limpa a janela/timer e reassocia
   * o socket ao broadcast.
   *
   * Segunda conexão simultânea: se já há um socket ativo (presença
   * `conectado`), não dispara `reconectar_jogador`, apenas registra o novo
   * socket.
   */
  async tratarReconexaoSeNecessario(socket: AuthenticatedWebSocket): Promise<void> {
    const jogadorId = socket.data.jogadorId;
    // Resolver salaId via projeção quente, com fallback ao PG (inclui encaminhada para B1)
    let salaId = await this.projecao.obterAssociacaoJogador(jogadorId);
    if (salaId === null) {
      const recuperado = await this.repo.obterSalaAtivaDoJogador(jogadorId);
      if (recuperado !== null) {
        salaId = recuperado;
        await this.projecao.definirAssociacaoJogador(jogadorId, recuperado);
      }
    }
    if (salaId === null) {
      return;
    }
    const salaInfo = this.estado.abertas.get(salaId);
    if (salaInfo === undefined) {
      return;
    }
    const membro = salaInfo.sala.membros.find(
      (m) => m.jogadorId === jogadorId && m.estado === 'ativo',
    );
    if (membro === undefined) {
      return;
    }
    // Atualizar cache de apelido antes do broadcast.
    this.atualizarApelidoSeConhecido(jogadorId, socket.data.apelido);
    // Se já está conectado, apenas registrar o novo socket (segunda aba).
    if (membro.presenca === 'conectado') {
      this.broadcast.registrarSocket(jogadorId, salaId, socket);
      return;
    }
    // Está em reconexão — tentar reconectar via engine.
    await this.enfileirarMutacao(async () => {
      // Revalidar dentro da cadeia (evitar condição de corrida com expiração).
      const salaAtual = this.estado.abertas.get(salaId!);
      const membroAtual = salaAtual?.sala.membros.find(
        (m) => m.jogadorId === jogadorId && m.estado === 'ativo',
      );
      if (membroAtual === undefined || membroAtual.presenca !== 'em_reconexao') {
        // Já reconectado/expirado entre o check e a mutação — apenas registrar.
        this.broadcast.registrarSocket(jogadorId, salaId!, socket);
        return;
      }
      // B3: reconexão só dentro da janela Redis; fora dela, expirar (pós-restart).
      const janelaExiste = await this.reconexao.existeJanela(salaId!, membroAtual.jogadorId);
      if (!janelaExiste) {
        void this.handleExpirar(salaId!, membroAtual.id);
        this.broadcast.registrarSocket(jogadorId, salaId!, socket);
        return;
      }
      const resultado = this.estado.aplicar({
        tipo: 'reconectar_jogador',
        salaId: salaId!,
        jogadorId,
      });
      if (!resultado.sucesso) {
        // Se a sala está inconsistente ou outro erro, ainda registrar o socket
        // para não perder a conexão, mas não limpar a janela.
        this.broadcast.registrarSocket(jogadorId, salaId!, socket);
        return;
      }
      this.estado.substituirEstado(resultado.estado);
      await this.atualizarProjecaoEstado(resultado.estado, salaId!);
      await this.projecao.definirAssociacaoJogador(jogadorId, salaId!);
      await this.reconexao.limparJanela(salaId!, membroAtual.jogadorId).catch(() => undefined);
      this.limparTimer(salaId!, membroAtual.id);
      this.broadcast.registrarSocket(jogadorId, salaId!, socket);
      // B1: snapshot de reconexão deve incluir redirect se sala está encaminhada
      let encMap: Map<string, EncaminhamentoDaSala> | undefined;
      const salaApos = resultado.estado.salas.find((s) => s.id === salaId!);
      if (salaApos?.estado === 'encaminhada') {
        const proj = await this.projecao.obterEstadoSala(salaId!).catch(() => null);
        if (proj?.encaminhamento) {
          encMap = new Map([[salaId!, proj.encaminhamento]]);
        } else {
          const rep = await this.repo.obterEncaminhamento(salaId!).catch(() => null);
          if (rep) encMap = new Map([[salaId!, rep]]);
          else console.warn(`[salas] sala encaminhada ${salaId} sem encaminhamento na projeção/PG`);
        }
      }
      const eventos = traduzirEventos(
        resultado.eventos,
        resultado.estado,
        this.estado.apelidoPorJogadorId,
        this.linkBase,
        encMap,
      );
      this.difundir(eventos, salaId!);
    });
  }

  private async handleExpirar(salaId: string, membroId: string): Promise<void> {
    await this.enfileirarMutacao(async () => {
      const salaPre = this.estado.abertas.get(salaId);
      const membroPre = salaPre?.sala.membros.find((m) => m.id === membroId);
      const jogadorIdPre = membroPre?.jogadorId ?? null;
      const resultado = this.estado.aplicar({
        tipo: 'expirar_reconexao',
        salaId,
        membroId,
      });
      if (!resultado.sucesso) {
        const alvo = jogadorIdPre ?? membroId;
        await this.reconexao.limparJanela(salaId, alvo).catch(() => undefined);
        if (alvo !== membroId) {
          await this.reconexao.limparJanela(salaId, membroId).catch(() => undefined);
        }
        this.limparTimer(salaId, membroId);
        return;
      }
      const expirado = resultado.eventos.find((e) => e.tipo === 'vinculo_expirado');
      const jogadorId = expirado !== undefined && 'jogadorId' in expirado
        ? (expirado as { jogadorId: string }).jogadorId
        : null;
      const salaExpirada = resultado.eventos.some((e) => e.tipo === 'sala_expirada');
      const sucessao = resultado.eventos.find((e) => e.tipo === 'anfitriao_sucedido');
      let novoAnfitriaoJogadorId: string | undefined;
      if (sucessao !== undefined && 'anfitriaoNovoId' in sucessao) {
        const salaNova = resultado.estado.salas.find((s) => s.id === salaId);
        const membroNovo = salaNova?.membros.find(
          (m) => m.id === (sucessao as { anfitriaoNovoId: string }).anfitriaoNovoId,
        );
        if (membroNovo !== undefined) {
          novoAnfitriaoJogadorId = membroNovo.jogadorId;
        }
      }
      if (jogadorId !== null) {
        try {
          await this.repo.expirarMembroAtomico(
            salaId,
            jogadorId,
            salaExpirada,
            novoAnfitriaoJogadorId,
          );
        } catch (erro) {
          // R1b: persistir antes de `substituirEstado` — na falha do write-model,
          // engine, PG e projeção permanecem coerentes em `em_reconexao` (a janela
          // Redis e a associação ficam preservadas; o restart cura para o PG).
          console.error('[salas] falha ao persistir expiracao:', erro);
          return;
        }
      }
      this.estado.substituirEstado(resultado.estado);
      if (jogadorId !== null) {
        await this.reconexao.limparJanela(salaId, jogadorId).catch(() => undefined);
      } else {
        await this.reconexao.limparJanela(salaId, membroId).catch(() => undefined);
      }
      this.limparTimer(salaId, membroId);
      if (jogadorId !== null) {
        await this.projecao.limparAssociacaoJogador(jogadorId);
      }
      if (salaExpirada) {
        const info = this.estado.abertas.get(salaId);
        const codigo = info?.codigo
          ?? (await this.projecao.obterEstadoSala(salaId))?.codigo
          ?? null;
        if (codigo !== null) {
          await this.projecao.limparSala(salaId, codigo);
        }
        this.estado.abertas.delete(salaId);
      } else {
        await this.atualizarProjecaoEstado(resultado.estado, salaId);
      }
      const eventos = traduzirEventos(
        resultado.eventos,
        resultado.estado,
        this.estado.apelidoPorJogadorId,
        this.linkBase,
      );
      this.difundir(eventos, salaId);
    });
  }

  private chaveTimer(salaId: string, membroId: string): string {
    return `${salaId}:${membroId}`;
  }

  private limparTimer(salaId: string, membroId: string): void {
    const chave = this.chaveTimer(salaId, membroId);
    const t = this.timersDeReconexao.get(chave);
    if (t !== undefined) {
      clearTimeout(t);
      this.timersDeReconexao.delete(chave);
    }
  }

  /** Limpa todos os timers pendentes — usado nos testes para evitar vazamento de 60s. */
  limparTodosTimers(): void {
    for (const t of this.timersDeReconexao.values()) {
      clearTimeout(t);
    }
    this.timersDeReconexao.clear();
  }

  /** Aguarda a cadeia de mutações pendentes — usado nos testes para evitar corrida com TRUNCATE. */
  async aguardarMutacoesPendentes(): Promise<void> {
    await this.cadeiaDeMutacoes;
  }

  /**
   * Garante que o Jogador por trás do WebSocket é o Anfitrião atual da Sala.
   * O engine valida que o `anfitriaoMembroId` do comando é o host, mas não
   * sabe quem enviou o WS — a autorização de "quem fala" é do handler (edge).
   */
  private anfitriaoEstaAutorizando(
    socket: AuthenticatedWebSocket,
    jogadorId: string,
    sala: SalaDominio,
  ): boolean {
    const membroDoChamador = sala.membros.find(
      (m) => m.jogadorId === jogadorId && m.estado === 'ativo',
    );
    if (
      membroDoChamador === undefined ||
      membroDoChamador.id !== sala.anfitriaoId
    ) {
      this.enviarErro(
        socket,
        'APENAS_ANFITRIAO',
        'Apenas o Anfitrião atual da Sala pode fazer isso.',
      );
      return false;
    }
    return true;
  }

  private atualizarApelidoSeConhecido(jogadorId: string, apelido: string): void {
    if (typeof apelido === 'string' && apelido.length > 0) {
      this.estado.apelidoPorJogadorId.set(jogadorId, apelido);
    }
  }

  private async atualizarProjecaoEstado(
    estado: EstadoDoLobby,
    salaId: string,
    encaminhamentoOverride?: EncaminhamentoDaSala,
  ): Promise<void> {
    const sala = estado.salas.find((s) => s.id === salaId);
    if (sala === undefined) {
      return;
    }
    if (encaminhamentoOverride) {
      await this.projecao.definirEstadoSala(salaId, serializarSala(sala, encaminhamentoOverride));
      return;
    }
    // Preservar encaminhamento já armazenado na projeção quando a sala está encaminhada.
    // Como estamos dentro de cadeiaDeMutacoes, a leitura é serializada e o race é baixo;
    // em futuro multi-nó, mover para transação ou cache em memória.
    const atual = await this.projecao.obterEstadoSala(salaId);
    if (atual?.encaminhamento && sala.estado === 'encaminhada') {
      await this.projecao.definirEstadoSala(salaId, serializarSala(sala, atual.encaminhamento));
    } else {
      await this.projecao.definirEstadoSala(salaId, serializarSala(sala));
    }
  }

  private difundir(eventos: readonly SalaServerMessage[], salaId: string): void {
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
