// Estado em memória dos bots efêmeros (#352, review #365 itens 2+3).
//
// Dois papéis num só módulo (mesmo processo do BotRunner + rota):
//   - Trava de admissão por Sala: conta bots in-flight (202 retornado, WS
//     ainda não entrou) para o teto de 4 Membros — qualquer mix humanos+bots.
//     Sem isso, dois cliques rápidos passam ambos na checagem da projeção.
//   - Status pós-202: `admitindo` → `ativo` | `falhou` | `encerrado`, lido por
//     `GET /api/bots/status/:jogadorId` e pelo polling do frontend. Falha
//     também vira broadcast `BOT_FALHOU` (via callback da rota).
//
// Volátil por desenho nesta fatia: restart limpa o mapa (status vira 404 e o
// frontend trata como desconhecido). A fonte da verdade de Membros continua
// sendo o engine/projeção; aqui é só guarda de corrida + visibilidade.

export type FaseDoBot = 'admitindo' | 'ativo' | 'falhou' | 'encerrado';

export interface EstadoDoBot {
  readonly jogadorId: string;
  readonly apelido: string;
  readonly salaId: string;
  readonly codigoDeSala: string;
  readonly fase: FaseDoBot;
  readonly codigo?: string;
  readonly mensagem?: string;
  readonly atualizadoEm: string;
}

const botsPorJogador = new Map<string, EstadoDoBot>();
const emAdmissaoPorSala = new Map<string, Set<string>>();

function agora(): string {
  return new Date().toISOString();
}

export function registrarBotEmAdmissao(args: {
  jogadorId: string;
  apelido: string;
  salaId: string;
  codigoDeSala: string;
}): void {
  const estado: EstadoDoBot = {
    jogadorId: args.jogadorId,
    apelido: args.apelido,
    salaId: args.salaId,
    codigoDeSala: args.codigoDeSala,
    fase: 'admitindo',
    atualizadoEm: agora(),
  };
  botsPorJogador.set(args.jogadorId, estado);
  let conjunto = emAdmissaoPorSala.get(args.salaId);
  if (conjunto === undefined) {
    conjunto = new Set();
    emAdmissaoPorSala.set(args.salaId, conjunto);
  }
  conjunto.add(args.jogadorId);
}

export function marcarBotAtivo(jogadorId: string): void {
  const atual = botsPorJogador.get(jogadorId);
  if (atual === undefined) return;
  botsPorJogador.set(jogadorId, { ...atual, fase: 'ativo', atualizadoEm: agora() });
  removerEmAdmissao(atual.salaId, jogadorId);
}

export function marcarBotFalhou(jogadorId: string, codigo: string, mensagem: string): void {
  const atual = botsPorJogador.get(jogadorId);
  if (atual === undefined) return;
  botsPorJogador.set(jogadorId, { ...atual, fase: 'falhou', codigo, mensagem, atualizadoEm: agora() });
  removerEmAdmissao(atual.salaId, jogadorId);
}

export function marcarBotEncerrado(jogadorId: string): void {
  const atual = botsPorJogador.get(jogadorId);
  if (atual === undefined) return;
  botsPorJogador.set(jogadorId, { ...atual, fase: 'encerrado', atualizadoEm: agora() });
  removerEmAdmissao(atual.salaId, jogadorId);
}

export function obterEstadoDoBot(jogadorId: string): EstadoDoBot | null {
  return botsPorJogador.get(jogadorId) ?? null;
}

/** Bots com 202 retornado cujo WS ainda não confirmou entrada — ocupam vaga. */
export function contarBotsEmAdmissao(salaId: string): number {
  return emAdmissaoPorSala.get(salaId)?.size ?? 0;
}

/**
 * Apelidos dos bots in-flight da Sala (para o sorteio temático não repetir
 * nome na mesma Sala — ver `nomes-de-bots.ts`). Ordem de registro.
 */
export function listarApelidosDeBotsEmAdmissao(salaId: string): string[] {
  const conjunto = emAdmissaoPorSala.get(salaId);
  if (conjunto === undefined) return [];
  const apelidos: string[] = [];
  for (const jogadorId of conjunto) {
    const estado = botsPorJogador.get(jogadorId);
    if (estado !== undefined) apelidos.push(estado.apelido);
  }
  return apelidos;
}

function removerEmAdmissao(salaId: string, jogadorId: string): void {
  const conjunto = emAdmissaoPorSala.get(salaId);
  if (conjunto === undefined) return;
  conjunto.delete(jogadorId);
  if (conjunto.size === 0) emAdmissaoPorSala.delete(salaId);
}

/** Uso em testes: limpa o estado volátil entre casos. */
export function limparEstadoDeBotsParaTeste(): void {
  botsPorJogador.clear();
  emAdmissaoPorSala.clear();
}
