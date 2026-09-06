// Type-guard fechado dos comandos de tabuleiro e de Peões vindo do cliente WS
// (issues #80 e #88).
//
// Apenas os 4 comandos do contrato wire do #80 mais os 6 do ciclo de Peões do
// #88/#249 são aceitos; campos obrigatórios são validados estruturalmente. Qualquer
// coisa fora disso é rejeitada pelo `handlers.ts` com `ERRO_DO_TABULEIRO {
// codigo: 'DADOS_INVALIDOS' }`.

import type {
  PeaoComandoDoCliente,
  TabuleiroComandoDoCliente,
} from '@flicker/shared';

// Comandos aceitos no wire: a forma de escolha de tipo (ST-10) saiu do domínio
// na #138 e teve o tipo removido do shared na limpeza do wire (#140/#143) — a
// união do contrato já a exclui, o guard apenas fecha os `type` aceitos.
export type ComandoDoTabuleiroAceito =
  | TabuleiroComandoDoCliente
  | PeaoComandoDoCliente;

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
 * Type guard puro e fechado sobre `TabuleiroComandoDoCliente` e
 * `PeaoComandoDoCliente`. Valida o `type` e os campos esperados de cada
 * variante; retorna `false` para qualquer mensagem fora do contrato —
 * incluindo o comando legado de escolha de tipo, fora do domínio desde a
 * #138.
 */
export function ehComandoDoTabuleiro(
  value: unknown,
): value is ComandoDoTabuleiroAceito {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !TIPOS_DE_COMANDO.has(type)) {
    return false;
  }

  const mensagem = value as Record<string, unknown>;
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
    default:
      return false;
  }
}
