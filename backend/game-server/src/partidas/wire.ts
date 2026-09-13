// Guarda wire e mapeamento wire→domínio do canal de Partida (issue #117).
//
// O canal de Partida substitui o seam isolado de tabuleiro/Peões (issues #80
// e #88): os 14 comandos agora viajam com o `jogadorId` da mensagem
// (contrato do ST-11). O ator do dispatch, porém, é a sessão autenticada do
// socket (#155): o `jogadorId` do wire é vestigial no dispatch — segue
// obrigatório só pela guarda de forma, e comandos com `jogadorId` alheio são
// aplicados como a sessão, não rejeitados. Comandos legacy de
// tabuleiro/Peões sem `jogadorId` falham a guarda e viram `ERRO_DO_TABULEIRO {
// DADOS_INVALIDOS }`. A saída de erros é um conjunto fechado de códigos
// sincronizado com `@flicker/shared`: os códigos do tabuleiro/Peões mais os 5
// de Turno do ST-11.
//
// O Chat de Partida (issue #390) entra no conjunto de forma do wire, mas NÃO
// no mapeamento de domínio: não é Ação de jogo, tem rota própria no
// `handlers.ts` (recusas MENSAGEM_VAZIA/MENSAGEM_LONGA_DEMAIS/
// LIMITE_DE_MENSAGENS, fora das guardas de turno e de término) — o case de
// `mapearComandoDaPartida` lança como os comandos de debug, inalcançável.

import type {
  CodigoDeErroDoTabuleiro,
  PartidaComandoDoCliente,
} from '@flicker/shared';
import type {
  CodigoDeErroDaPartida,
  ComandoDePartida,
} from '@flicker/engine';

// Comandos aceitos no wire do canal de Partida: a forma legada de escolha de
// tipo (ST-10) saiu do domínio na #138 e foi removida da união wire na limpeza
// da #140 — a união compartilhada já é exatamente o conjunto aceito.
// DESELECIONAR_PEAO entra pela issue #249 (desseleção autoritativa).
export type ComandoDaPartidaAceito = PartidaComandoDoCliente;

const TIPOS_DE_COMANDO: ReadonlySet<string> = new Set([
  'SELECIONAR_PECA',
  'GIRAR_PECA',
  'POSICIONAR_PECA',
  'FINALIZAR_MANIPULACAO',
  'SELECIONAR_PEAO',
  'DESELECIONAR_PEAO',
  'POSICIONAR_PEAO',
  'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
  'MOVER_PEAO',
  'PERMANECER',
  'CONFIRMAR_POSICAO_DO_PEAO',
  'ATRAVESSAR_O_ESCURO',
  'ENCERRAR_TURNO',
  'DESISTIR_DA_PARTIDA',
  // Chat de Partida (issue #390): rota própria no handler, fora do domínio.
  'ENVIAR_MENSAGEM_DE_CHAT',
]);

function ehIdNaoVazio(valor: unknown): boolean {
  return typeof valor === 'string' && valor.length > 0;
}

function ehBordaValida(valor: unknown): boolean {
  return (
    valor === 'norte' ||
    valor === 'leste' ||
    valor === 'sul' ||
    valor === 'oeste'
  );
}

function ehCelulaValida(valor: unknown): boolean {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }
  const celula = valor as Record<string, unknown>;
  if (typeof celula.linha !== 'number' || typeof celula.coluna !== 'number') {
    return false;
  }
  if (!Number.isInteger(celula.linha) || !Number.isInteger(celula.coluna)) {
    return false;
  }
  // Grade fixa 7x7 (ADR-0004): linha/coluna em 0..6.
  return celula.linha >= 0 && celula.linha <= 6 && celula.coluna >= 0 && celula.coluna <= 6;
}

/**
 * Type guard puro e fechado sobre `PartidaComandoDoCliente`. Valida o `type`,
 * o `jogadorId` (obrigatório em todos os comandos) e os campos esperados de
 * cada variante; retorna `false` para qualquer mensagem fora do contrato —
 * incluindo os comandos legacy de tabuleiro/Peões sem `jogadorId` e o comando
 * legado de escolha de tipo, fora do domínio desde a #138 e do wire desde a
 * #140.
 */
export function ehComandoDaPartida(value: unknown): value is ComandoDaPartidaAceito {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !TIPOS_DE_COMANDO.has(type)) {
    return false;
  }

  const mensagem = value as Record<string, unknown>;
  if (!ehIdNaoVazio(mensagem.jogadorId)) {
    return false;
  }

  switch (type) {
    case 'SELECIONAR_PECA':
      return ehIdNaoVazio(mensagem.pecaId);
    case 'GIRAR_PECA':
      return (
        ehIdNaoVazio(mensagem.pecaId)
        && (mensagem.sentido === 'horario' || mensagem.sentido === 'anti_horario')
      );
    case 'POSICIONAR_PECA':
      return ehIdNaoVazio(mensagem.pecaId) && ehCelulaValida(mensagem.celula);
    case 'FINALIZAR_MANIPULACAO':
      return true;
    case 'SELECIONAR_PEAO':
      return ehIdNaoVazio(mensagem.peaoId);
    case 'DESELECIONAR_PEAO':
      return ehIdNaoVazio(mensagem.peaoId);
    case 'POSICIONAR_PEAO':
      return ehIdNaoVazio(mensagem.peaoId) && ehCelulaValida(mensagem.celula);
    case 'ESCOLHER_VAGA_DA_PECA_RECEBIDA':
      return ehIdNaoVazio(mensagem.recebidaId) && ehBordaValida(mensagem.borda);
    case 'MOVER_PEAO':
      return ehIdNaoVazio(mensagem.peaoId) && ehCelulaValida(mensagem.celula);
    case 'PERMANECER':
      return ehIdNaoVazio(mensagem.peaoId);
    case 'CONFIRMAR_POSICAO_DO_PEAO':
      return ehIdNaoVazio(mensagem.peaoId);
    case 'ATRAVESSAR_O_ESCURO':
      return ehIdNaoVazio(mensagem.peaoId) && ehCelulaValida(mensagem.celula);
    case 'ENCERRAR_TURNO':
      return true;
    // Desistência (issue #288): rota própria — só o `jogadorId` (vestigial no
    // dispatch, #155); vale no próprio turno ou fora dele, sem FORA_DA_VEZ.
    case 'DESISTIR_DA_PARTIDA':
      return true;
    // Chat de Partida (issue #390): guarda de FORMA apenas — o `jogadorId` é
    // vestigial (#155) e o `conteudo` é validado de verdade no handler
    // (normalização de quebras/trim, vazio, teto de 300), como o lobby faz
    // com o conteúdo real do chat da Sala.
    case 'ENVIAR_MENSAGEM_DE_CHAT':
      return typeof mensagem.conteudo === 'string';
    default:
      return false;
  }
}

/**
 * Mapeia wire (UPPER_SNAKE com `jogadorId`) → domínio (snake). O ator nunca
 * viaja dentro do comando de domínio: o `handlers.ts` usa a sessão
 * autenticada do socket como ator (#155) — o `jogadorId` do wire é vestigial
 * e não participa do mapeamento.
 */
export function mapearComandoDaPartida(
  comando: ComandoDaPartidaAceito,
): ComandoDePartida {
  switch (comando.type) {
    case 'SELECIONAR_PECA':
      return { tipo: 'selecionar_peca', pecaId: comando.pecaId };
    case 'GIRAR_PECA':
      return { tipo: 'girar_peca', pecaId: comando.pecaId, sentido: comando.sentido };
    case 'POSICIONAR_PECA':
      return { tipo: 'posicionar_peca', pecaId: comando.pecaId, celula: comando.celula };
    case 'FINALIZAR_MANIPULACAO':
      return { tipo: 'finalizar_manipulacao' };
    case 'SELECIONAR_PEAO':
      return { tipo: 'selecionar_peao', peaoId: comando.peaoId };
    case 'DESELECIONAR_PEAO':
      return { tipo: 'desselecionar_peao', peaoId: comando.peaoId };
    case 'POSICIONAR_PEAO':
      return { tipo: 'posicionar_peao', peaoId: comando.peaoId, celula: comando.celula };
    case 'ESCOLHER_VAGA_DA_PECA_RECEBIDA':
      return {
        tipo: 'escolher_vaga_da_peca_recebida',
        recebidaId: comando.recebidaId,
        borda: comando.borda,
      };
    case 'MOVER_PEAO':
      return { tipo: 'mover_peao', peaoId: comando.peaoId, celula: comando.celula };
    case 'PERMANECER':
      return { tipo: 'permanecer', peaoId: comando.peaoId };
    case 'CONFIRMAR_POSICAO_DO_PEAO':
      return { tipo: 'confirmar_posicao_do_peao', peaoId: comando.peaoId };
    case 'ATRAVESSAR_O_ESCURO':
      return {
        tipo: 'atravessar_o_escuro',
        peaoId: comando.peaoId,
        celula: comando.celula,
      };
    case 'ENCERRAR_TURNO':
      return { tipo: 'encerrar_turno' };
    case 'DESISTIR_DA_PARTIDA':
      return { tipo: 'desistir_da_partida' };
    case 'ENVIAR_MENSAGEM_DE_CHAT':
      // Inalcançável: o Chat de Partida (issue #390) tem rota própria no
      // `handlers.ts`, ANTES de enfileirar a mutação do engine — não é Ação de
      // jogo e não atravessa o mapeamento. O case existe só para a
      // exaustividade da união wire (mesmo padrão dos comandos de debug).
      throw new Error('Chat de Partida não atravessa o mapeamento de domínio.');
    case 'ATIVAR_DEBUG':
    case 'DESATIVAR_DEBUG':
      // Inalcançável: `ehComandoDaPartida` recusa os comandos de controle de
      // debug (issue #340) — eles são interceptados no `ws.ts` e nunca chegam
      // ao mapeamento. O case existe só para a exaustividade da união wire.
      throw new Error('Comando de controle de debug não atravessa o mapeamento de Partida.');
    default: {
      // Exaustividade: um novo `type` sem case falha a compilação; em runtime
      // a entrada já foi validada por `ehComandoDaPartida`.
      const _exaustivo: never = comando;
      return _exaustivo;
    }
  }
}

// Conjunto fechado dos códigos do domínio que pertencem ao contrato wire do
// canal de Partida (issue #117): os códigos de Tabuleiro/Peões das issues #80
// e #88, o da Caixa da ST-12 (#144) e os 5 códigos de Turno do ST-11. O
// PARTIDA_TERMINADA entra pela issue #179 (recusa pós-término) e o
// JOGADOR_NAO_NA_PARTIDA pela issue #288 (recusa de não-membro/desistente).
// Os 3 códigos do Chat de Partida entram pela issue #390 (recusas do
// julgamento do chat, só ao autor). Qualquer
// código fora deste conjunto é normalizado para DADOS_INVALIDOS para nunca
// vazar um código fora do contrato.
const CODIGOS_DA_PARTIDA_WIRE: ReadonlySet<string> = new Set([
  'DADOS_INVALIDOS',
  'ESTADO_INDISPONIVEL',
  'PECA_NAO_ENCONTRADA',
  'PECA_NAO_SELECIONADA',
  'CAIXA_ESGOTADA',
  'CELULA_NAO_ENCONTRADA',
  'CELULA_JA_OCUPADA',
  'PECA_JA_POSICIONADA',
  'MANIPULACAO_ENCERRADA',
  'PEAO_NAO_ENCONTRADO',
  'PEAO_JA_POSICIONADO',
  'PEAO_NAO_SELECIONADO',
  'PECA_INICIAL_EXIGIDA',
  'CELULA_SEM_PECA',
  'PECA_JA_TEM_PEAO',
  'PENDENCIA_NAO_RESOLVIDA',
  'MOVIMENTO_NAO_CONECTADO',
  'PECA_NAO_RECEBIDA',
  'PECA_FORA_DO_ALVO',
  'RECEBIDA_NAO_ENCONTRADA',
  'FORA_DA_VEZ',
  'PECA_INICIAL_INDISPONIVEL',
  'POSICAO_CONFIRMADA',
  'ENCERRAMENTO_INVALIDO',
  'MOVIMENTO_INDISPONIVEL',
  'PARTIDA_TERMINADA',
  'JOGADOR_NAO_NA_PARTIDA',
  'MENSAGEM_VAZIA',
  'MENSAGEM_LONGA_DEMAIS',
  'LIMITE_DE_MENSAGENS',
]);

export function paraCodigoDaPartidaWire(
  codigo: CodigoDeErroDaPartida,
): CodigoDeErroDoTabuleiro {
  return CODIGOS_DA_PARTIDA_WIRE.has(codigo)
    ? (codigo as CodigoDeErroDoTabuleiro)
    : 'DADOS_INVALIDOS';
}
