// Comentários de bot no Chat de Partida (issue #390) — tabela de textos
// pré-feitos, avaliação de gatilhos (pura) e fila FIFO de envio.
//
// O bot NÃO lê o chat: `MENSAGEM_DE_CHAT_DA_PARTIDA` é ignorado no driver
// (`bot-runner.ts`) e o fold do espelho nem o conhece. O bot SÓ envia —
// reutiliza o comando `ENVIAR_MENSAGEM_DE_CHAT` do canal da Partida com a
// identidade do bot no roster (o servidor anexa apelido e cor do peão no
// evento), fora da FSM e do `converterComandoParaWire` (o chat não é Ação de
// jogo, então não há comando de domínio a converter — o envio cruza o socket
// direto).
//
// Gatilhos fechados (decisão aprovada da #390): gerador ligado, chave (cartão
// de acesso) obtida, ataque sofrido, Baixa Iluminação, Resgate, vitória e
// derrota — o bot comenta TODOS os gatilhos, inclusive os de aliados (ex.:
// gerador ligado por outro Jogador). A avaliação é pura sobre o espelho do
// estado antes/depois do fold (`aplicarEventoNoEspelho`, jogador-bot.ts) e o
// evento wire — testável sem I/O.
//
// Fila: FIFO com cooldown mínimo entre comentários do MESMO bot (padrão ~4s,
// injetável para testes) e sorteio de texto sem repetição imediata; a rajada
// sai em sequência (uma mensagem por intervalo de cooldown). Os textos
// obedecem ao teto de 300 caracteres do chat por construção; os comentários
// do bot furam o rate-limit de 2s no game-server (isento de bot, julgado
// lá), mas entram na MESMA ordem e janela do chat humano (cadeia por
// Partida).

import type { EstadoDaPartida } from '@flicker/engine';

export type GatilhoDeComentarioDeBot =
  | 'gerador_ligado'
  | 'chave_obtida'
  | 'ataque_sofrido'
  | 'baixa_iluminacao'
  | 'resgate'
  | 'vitoria'
  | 'derrota';

// Textos pré-feitos por gatilho (temática do Sanatório, PT-BR). Cada texto
// cabe no teto de 300 caracteres do chat por construção; o sorteio nunca
// repete o texto imediatamente anterior do MESMO gatilho. Exportada para os
// testes fecharem os invariantes da tabela (teto e cobertura dos gatilhos).
export const TEXTOS_POR_GATILHO: Record<GatilhoDeComentarioDeBot, readonly string[]> = {
  gerador_ligado: [
    'Mais um gerador de pé... cada luz desta vez nos aproxima da saída.',
    'Ouvi a turbina acender daqui. Bom sinal, pessoal.',
    'O corredor ficou um pouco menos escuro. Continuem.',
    'Gerador ligado. Vamos fechar as luzes antes que a caixa acabe.',
  ],
  chave_obtida: [
    'O cartão do Diretor mudou de dono. Ninguém fica preso aqui.',
    'A chave do gabinete foi apanhada. Guardem isso com a vida.',
    'Cartão de acesso em jogo. O portão já não é apenas lenda.',
  ],
  ataque_sofrido: [
    'Algo me pegou no escuro... estou bem, acho. Continuem sem mim por um turno.',
    'Vocês ouviram? Ele veio até mim. Sobrevivi... por pouco.',
    'Peguei um susto brutal, mas ainda consigo andar.',
  ],
  baixa_iluminacao: [
    'Está tudo escuro demais por aqui... não enxergo o chão.',
    'A luz sumiu de vez do meu lado. Fiquem perto, por favor.',
    'Alguém vê o que eu não estou vendo? Aqui está negro.',
  ],
  resgate: [
    'Obrigado por voltar por mim. Não sei o que seria deste sanatório sem vocês.',
    'De novo sob a mesma luz. Valeu, aliado.',
    'Achei que o escuro tinha me levado. Obrigado pela mão.',
  ],
  vitoria: [
    'A porta abriu. Saímos... vivos. É isso, gente.',
    'Fora do sanatório! Ainda estou tremendo, mas saímos.',
    'Correram atrás de nós até o fim — e perdemos o rastro. Vitória.',
  ],
  derrota: [
    'Foi aqui que a luz acabou para nós. Foi bom caminhar com vocês.',
    'O sanatório ficou com todos nós desta vez. Até a próxima partida.',
    'Não deu... mas tentamos até a última ficha.',
  ],
};

/**
 * Sorteia um texto do gatilho sem repetir imediatamente o anterior do MESMO
 * gatilho (`ultimoUsado` = texto da vez anterior; ignorado quando o pool tem
 * um único candidato). O `aleatorio` é injetável para testes determinísticos.
 */
export function sortearTexto(
  gatilho: GatilhoDeComentarioDeBot,
  ultimoUsado?: string,
  aleatorio: () => number = Math.random,
): string {
  const pool = TEXTOS_POR_GATILHO[gatilho];
  const candidatos =
    ultimoUsado === undefined || pool.length <= 1
      ? [...pool]
      : pool.filter((texto) => texto !== ultimoUsado);
  const indice = Math.floor(aleatorio() * candidatos.length);
  return candidatos[indice]!;
}

/**
 * Avaliação PURA dos gatilhos de comentário (issue #390): dados o estado do
 * espelho ANTES e DEPOIS do fold do evento wire, devolve o gatilho disparado
 * ou `null`. Convenção de prioridade: Baixa Iluminação sobre o ataque sofrido
 * (o mais específico) e chave sobre gerador (destinos distintos, nunca os
 * dois no mesmo evento — a ordem é só determinismo).
 */
export function avaliarGatilhoDeComentario(
  antes: EstadoDaPartida,
  depois: EstadoDaPartida,
  evento: unknown,
  jogadorIdDoBot: string,
): GatilhoDeComentarioDeBot | null {
  if (typeof evento !== 'object' || evento === null) {
    return null;
  }
  const tipo = (evento as { type?: unknown }).type;
  switch (tipo) {
    case 'POSICAO_CONFIRMADA': {
      // Chave (cartão) obtida: monotônico no espelho (Limpeza não revoga).
      if (!antes.cartaoDeAcessoObtido && depois.cartaoDeAcessoObtido) {
        return 'chave_obtida';
      }
      // Gerador ligado: qualquer Jogador ligando conta (aliados incluídos).
      if (depois.geradoresLigados.length > antes.geradoresLigados.length) {
        return 'gerador_ligado';
      }
      return null;
    }
    case 'ATAQUE_RESOLVIDO': {
      const { peoesAtingidos, estadosAplicados } = evento as {
        peoesAtingidos?: readonly string[];
        estadosAplicados?: readonly { jogadorId: string; emBaixaIluminacao: boolean }[];
      };
      const emBaixa =
        estadosAplicados?.some(
          (estado) => estado.jogadorId === jogadorIdDoBot && estado.emBaixaIluminacao,
        ) ?? false;
      if (emBaixa) {
        return 'baixa_iluminacao';
      }
      const peaoDoBot =
        depois.jogadores.find((jogador) => jogador.jogadorId === jogadorIdDoBot)?.peaoId
        ?? antes.jogadores.find((jogador) => jogador.jogadorId === jogadorIdDoBot)?.peaoId;
      if (peaoDoBot !== undefined && peoesAtingidos?.includes(peaoDoBot)) {
        return 'ataque_sofrido';
      }
      return null;
    }
    case 'RESGATE_REALIZADO':
      return 'resgate';
    case 'PARTIDA_TERMINADA': {
      const { resultado } = evento as { resultado?: unknown };
      if (resultado === 'vitoria') return 'vitoria';
      if (resultado === 'derrota') return 'derrota';
      return null;
    }
    default:
      return null;
  }
}

export interface OpcoesDoComentaristaDeBot {
  /**
   * Consumo do texto quando o timer vence: o wiring (`bot-runner.ts`) injeta
   * o envio direto no socket como `{ type: 'ENVIAR_MENSAGEM_DE_CHAT',
   * jogadorId, conteudo }`, sem `converterComandoParaWire` e fora da FSM.
   */
  readonly enviar: (conteudo: string) => void;
  /** Cooldown mínimo entre comentários do mesmo bot (padrão 4s; injetável p/ testes). */
  readonly cooldownMinimoMs?: number;
  /** Relógio injetável (epoch ms) para testes determinísticos. */
  readonly agora?: () => number;
  readonly log?: (...args: unknown[]) => void;
}

/**
 * Fila FIFO de comentários do bot (issue #390): um texto por intervalo de
 * cooldown, na ordem de enfileiramento — a rajada sai em sequência. O primeiro
 * texto sai imediatamente se o bot está dentro do cooldown (nunca comentou) e
 * os seguintes escalam pelo cooldown a partir de cada envio.
 */
export class ComentaristaDeBot {
  private readonly enviar: (conteudo: string) => void;
  private readonly cooldownMs: number;
  private readonly agora: () => number;
  private readonly log: (...args: unknown[]) => void;
  private readonly ultimoTextoPorGatilho: Map<GatilhoDeComentarioDeBot, string> = new Map();
  private fila: string[] = [];
  private ultimoEnvioEm: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opcoes: OpcoesDoComentaristaDeBot) {
    this.enviar = opcoes.enviar;
    this.cooldownMs = opcoes.cooldownMinimoMs ?? 4000;
    this.agora = opcoes.agora ?? (() => Date.now());
    this.log = opcoes.log ?? (() => undefined);
  }

  /**
   * Recebe o gatilho avaliado (`null` = nada a comentar) e enfileira o texto
   * sorteado. O drain continua pelo timer já em voo; sem timer, agenda.
   */
  observarGatilho(gatilho: GatilhoDeComentarioDeBot | null): void {
    if (gatilho === null) {
      return;
    }
    const texto = sortearTexto(gatilho, this.ultimoTextoPorGatilho.get(gatilho));
    this.ultimoTextoPorGatilho.set(gatilho, texto);
    this.fila.push(texto);
    if (this.timer === null) {
      this.agendarProximo();
    }
  }

  /** Encerra (close da conexão do bot): limpa a fila e o timer pendente. */
  encerrar(): void {
    this.fila = [];
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Textos aguardando envio — diagnóstico e testes. */
  get tamanhoDaFila(): number {
    return this.fila.length;
  }

  private agendarProximo(): void {
    const agora = this.agora();
    const faltam =
      this.ultimoEnvioEm === null
        ? 0
        : Math.max(0, this.cooldownMs - (agora - this.ultimoEnvioEm));
    this.timer = setTimeout(() => {
      this.timer = null;
      const texto = this.fila.shift();
      if (texto === undefined) {
        return;
      }
      this.ultimoEnvioEm = this.agora();
      this.enviar(texto);
      this.log(`comentário enviado (${this.fila.length} na fila)`);
      if (this.fila.length > 0) {
        this.agendarProximo();
      }
    }, faltam);
    // Nunca segura o processo vivo só por um comentário pendente.
    this.timer.unref?.();
  }
}
