// Guarda wire e mapeamento wire→domínio do canal de Partida (issue #117).
//
// O canal de Partida substitui o seam isolado de tabuleiro/Peões (issues #80
// e #88): os mesmos 11 comandos agora viajam com o `jogadorId` da mensagem
// (contrato do ST-11). O ator do dispatch, porém, é a sessão autenticada do
// socket (#135) — o `handlers.ts` rejeita como impersonation qualquer comando
// cujo `jogadorId` divirja da sessão, então o cliente não se autodeclara como
// outrem. Comandos legacy de tabuleiro/Peões
// sem `jogadorId` falham a guarda e viram `ERRO_DO_TABULEIRO {
// DADOS_INVALIDOS }`. A saída de erros é um conjunto fechado de códigos
// sincronizado com `@flicker/shared`: os códigos do tabuleiro/Peões mais os 5
// de Turno do ST-11.

import type {
  CodigoDeErroDoTabuleiro,
  EscolherTipoDaPecaRecebidaPartidaComando,
  PartidaComandoDoCliente,
} from '@flicker/shared';
import type {
  CodigoDeErroDaPartida,
  ComandoDePartida,
} from '@flicker/engine';

// Comandos aceitos no wire do canal de Partida: a forma legada de escolha de
// tipo (ST-10) saiu do domínio na #138 e não é mais aceita — o tipo shared
// permanece na união só até a limpeza do wire (#140/#143), então o guard
// estreita a união ao devolver o tipo aceito.
export type ComandoDaPartidaAceito = Exclude<
  PartidaComandoDoCliente,
  EscolherTipoDaPecaRecebidaPartidaComando
>;

const TIPOS_DE_COMANDO: ReadonlySet<string> = new Set([
  'SELECIONAR_PECA',
  'GIRAR_PECA',
  'POSICIONAR_PECA',
  'FINALIZAR_MANIPULACAO',
  'SELECIONAR_PEAO',
  'POSICIONAR_PEAO',
  'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
  'MOVER_PEAO',
  'PERMANECER',
  'CONFIRMAR_POSICAO_DO_PEAO',
  'ENCERRAR_TURNO',
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
 * legado de escolha de tipo, fora do domínio desde a #138.
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
    case 'ENCERRAR_TURNO':
      return true;
    default:
      return false;
  }
}

/**
 * Mapeia wire (UPPER_SNAKE com `jogadorId`) → domínio (snake). O ator nunca
 * viaja dentro do comando de domínio: o `handlers.ts` usa o `jogadorId` da
 * mensagem como ator (contrato do ST-11), que já foi validado como igual à
 * sessão autenticada na guarda de impersonation (#135).
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
    case 'ENCERRAR_TURNO':
      return { tipo: 'encerrar_turno' };
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
// e #88, o da Caixa da ST-12 (#144) e os 5 códigos de Turno do ST-11. Qualquer
// código fora deste conjunto é normalizado para DADOS_INVALIDOS para nunca
// vazar um código fora do contrato.
const CODIGOS_DA_PARTIDA_WIRE: ReadonlySet<string> = new Set([
  'DADOS_INVALIDOS',
  'ESTADO_INDISPONIVEL',
  'PECA_NAO_ENCONTRADA',
  'PECA_NAO_SELECIONADA',
  'RESERVA_ESGOTADA',
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
]);

export function paraCodigoDaPartidaWire(
  codigo: CodigoDeErroDaPartida,
): CodigoDeErroDoTabuleiro {
  return CODIGOS_DA_PARTIDA_WIRE.has(codigo)
    ? (codigo as CodigoDeErroDoTabuleiro)
    : 'DADOS_INVALIDOS';
}
