import type {
  CancelamentoDoEncaminhamento,
  MembroDaSala,
  Presenca,
  RecusaDoEncaminhamento,
} from '@flicker/shared';

const PRESENCAS = ['conectado', 'em_reconexao'] as const satisfies readonly Presenca[];

export function validarOfertaDeEncaminhamento(value: unknown): RecusaDoEncaminhamento | null {
  const recusa = (motivo: string): RecusaDoEncaminhamento => ({ codigo: 'ROSTER_INVALIDO', motivo });

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return recusa('oferta deve ser um objeto');
  }

  const oferta = value as Record<string, unknown>;

  if (!ehStringNaoVazia(oferta.salaId)) {
    return recusa('salaId é obrigatório');
  }

  if (!ehStringNaoVazia(oferta.codigoDeSala)) {
    return recusa('codigoDeSala é obrigatório');
  }

  if (!Array.isArray(oferta.roster) || oferta.roster.length !== 4) {
    return recusa('roster deve conter exatamente 4 membros');
  }

  for (const membro of oferta.roster) {
    const problema = problemaNoMembro(membro);
    if (problema !== null) {
      return recusa(problema);
    }
  }

  const ids = new Set<string>();
  const jogadorIds = new Set<string>();
  for (const membro of oferta.roster as MembroDaSala[]) {
    if (ids.has(membro.id)) {
      return recusa(`id de membro duplicado: ${membro.id}`);
    }
    ids.add(membro.id);
    if (jogadorIds.has(membro.jogadorId)) {
      return recusa(`jogadorId duplicado: ${membro.jogadorId}`);
    }
    jogadorIds.add(membro.jogadorId);
  }

  return null;
}

export function validarCancelamentoDeEncaminhamento(
  value: unknown,
  partidaIdDaUrl: unknown,
): CancelamentoDoEncaminhamento | RecusaDoEncaminhamento {
  const recusa = (motivo: string): RecusaDoEncaminhamento => ({ codigo: 'DADOS_INVALIDOS', motivo });

  if (!ehStringNaoVazia(partidaIdDaUrl)) {
    return recusa('partidaId da URL é obrigatório');
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return recusa('cancelamento deve ser um objeto');
  }

  const cancelamento = value as Record<string, unknown>;
  if (!ehStringNaoVazia(cancelamento.partidaId)) {
    return recusa('partidaId é obrigatório');
  }

  if (cancelamento.partidaId !== partidaIdDaUrl) {
    return recusa('partidaId do corpo deve ser igual ao da URL');
  }

  if (!ehStringNaoVazia(cancelamento.motivo) || cancelamento.motivo.trim().length === 0) {
    return recusa('motivo é obrigatório');
  }

  return {
    partidaId: cancelamento.partidaId,
    motivo: cancelamento.motivo,
  };
}

function problemaNoMembro(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return 'membro do roster deve ser um objeto';
  }

  const membro = value as Record<string, unknown>;

  if (!ehStringNaoVazia(membro.id)) {
    return 'membro do roster com id obrigatório';
  }
  if (!ehStringNaoVazia(membro.jogadorId)) {
    return 'membro do roster com jogadorId obrigatório';
  }
  if (!ehStringNaoVazia(membro.apelido)) {
    return 'membro do roster com apelido obrigatório';
  }
  if (typeof membro.ordemDeEntrada !== 'number' || !Number.isInteger(membro.ordemDeEntrada)) {
    return 'membro do roster com ordemDeEntrada inválida';
  }
  if (typeof membro.presenca !== 'string' || !PRESENCAS.includes(membro.presenca as Presenca)) {
    return 'membro do roster com presenca inválida';
  }
  if (typeof membro.prontidao !== 'boolean') {
    return 'membro do roster com prontidao inválida';
  }

  return null;
}

function ehStringNaoVazia(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
