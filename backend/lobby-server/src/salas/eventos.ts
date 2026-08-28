// Tradução pura engine → wire dos eventos da Sala (issues #36, #38, #39 e #31).
// Função sem side-effects: dado o estado pós-engine e os eventos emitidos,
// devolve os `SalaEventoDoServidor` correspondentes. O cache de apelidos é
// injetado pelo chamador (handler) — esta função não toca DB/Redis.
//
// Mapeamentos (do plano):
//   sala_criada         -> SALA_ATUALIZADA
//   membro_admitido     -> MEMBRO_ENTROU + SALA_ATUALIZADA
//   membro_saiu         -> MEMBRO_SAIU  + SALA_ATUALIZADA
//   membro_expulsado    -> MEMBRO_EXPULSO + SALA_ATUALIZADA
//   retorno_autorizado  -> SALA_ATUALIZADA
//   sala_encerrada      -> SALA_ATUALIZADA (estado='encerrada')
//   anfitriao_sucedido  -> ANFITRIAO_SUBSTITUIDO + SALA_ATUALIZADA
//   prontidao_alterada  -> PRONTIDAO_ATUALIZADA + SALA_ATUALIZADA
//   membro_desconectado -> MEMBRO_DESCONECTADO + SALA_ATUALIZADA
//   membro_reconectado  -> MEMBRO_RECONECTADO + SALA_ATUALIZADA
//   vinculo_expirado    -> MEMBRO_SAIU + SALA_ATUALIZADA
//   sala_expirada       -> SALA_ATUALIZADA (estado='expirada')
//   reinicio_registrado / consistencia_confirmada -> SALA_ATUALIZADA
//
import type {
  EstadoDoLobby,
  EventoDeDominio,
  Sala as SalaDominio,
  Membro as MembroDominio,
} from '@flicker/engine';
import type {
  EstadoDaSala,
  MembroDaSala,
  Presenca,
  Sala,
  SalaAtualizadaEvento,
  SalaEventoDoServidor,
  MembroEntrouEvento,
  MembroSaiuEvento,
  MembroExpulsoEvento,
  MembroDesconectadoEvento,
  MembroReconectadoEvento,
  AnfitriaoSubstituidoEvento,
  ProntidaoAtualizadaEvento,
} from '@flicker/shared';
import type {
  EncaminhamentoEventoDoServidor,
  PartidaPreparandoEvento,
  PartidaDisponivelEvento,
  PartidaRecusadaEvento,
  PartidaFalhouEvento,
} from '@flicker/shared';

export type ApelidoPorJogadorId = ReadonlyMap<string, string>;

function mapearEstado(engine: SalaDominio['estado']): EstadoDaSala {
  return engine as EstadoDaSala;
}

function mapearPresenca(engine: MembroDominio['presenca']): Presenca {
  return engine;
}

function mapearMembro(
  membro: MembroDominio,
  apelido: string,
  anfitriaoId: string | null,
): MembroDaSala {
  return {
    id: membro.id,
    jogadorId: membro.jogadorId,
    apelido,
    ordemDeEntrada: membro.ordemDeEntrada,
    presenca: mapearPresenca(membro.presenca),
    prontidao: membro.pronto,
  };
}

function membrosAtivos(
  sala: SalaDominio,
  apelidoPorJogadorId: ApelidoPorJogadorId,
): MembroDaSala[] {
  return sala.membros
    .filter((membro) => membro.estado === 'ativo')
    .map((membro) =>
      mapearMembro(
        membro,
        apelidoPorJogadorId.get(membro.jogadorId) ?? '',
        sala.anfitriaoId,
      ),
    );
}

export function mapearSala(
  sala: SalaDominio,
  apelidoPorJogadorId: ApelidoPorJogadorId,
  linkBase: string,
  encaminhamento?: { serverId: string; partidaId: string },
): Sala {
  const base: Sala = {
    id: sala.id,
    codigoDeSala: sala.codigo,
    estado: mapearEstado(sala.estado),
    anfitriaoId: sala.anfitriaoId,
    membros: membrosAtivos(sala, apelidoPorJogadorId),
    convite: {
      codigoDeSala: sala.codigo,
      link: `${linkBase}/${sala.codigo}`,
    },
  };
  if (encaminhamento) {
    return { ...base, encaminhamento };
  }
  return base;
}

export function mapearSalaComEncaminhamento(
  sala: SalaDominio,
  apelidoPorJogadorId: ApelidoPorJogadorId,
  linkBase: string,
  encaminhamento?: { serverId: string; partidaId: string },
): Sala {
  return mapearSala(sala, apelidoPorJogadorId, linkBase, encaminhamento);
}

function encontrarSala(
  estado: EstadoDoLobby,
  salaId: string,
): SalaDominio | null {
  return estado.salas.find((sala) => sala.id === salaId) ?? null;
}

function salaAtualizada(
  sala: SalaDominio,
  apelidoPorJogadorId: ApelidoPorJogadorId,
  linkBase: string,
): SalaAtualizadaEvento {
  return { type: 'SALA_ATUALIZADA', sala: mapearSala(sala, apelidoPorJogadorId, linkBase) };
}

/**
 * Traduz os eventos de domínio pós-engine para os eventos de wire. Pure:
 * não toca DB/Redis. O `linkBase` é a URL base do convite (ex.:
 * `http://localhost:3001/convite`) — montado pelo chamador a partir de
 * `getConfig()`.
 *
 * Membros encerrados não aparecem em `sala.membros` (filtrados na projeção
 * wire) — quando a Sala fica sem membros ativos e o engine emite
 * `sala_encerrada`, o `SALA_ATUALIZADA` traz `membros: []` e
 * `estado: 'encerrada'`.
 */
export function traduzirEventos(
  eventos: readonly EventoDeDominio[],
  estado: EstadoDoLobby,
  apelidoPorJogadorId: ApelidoPorJogadorId,
  linkBase: string,
): readonly (SalaEventoDoServidor | EncaminhamentoEventoDoServidor)[] {
  const saida: (SalaEventoDoServidor | EncaminhamentoEventoDoServidor)[] = [];

  for (const evento of eventos) {
    const sala = encontrarSala(estado, evento.salaId);
    if (sala === null) {
      // Sala removida (não pode acontecer com o escopo atual, mas defensivo):
      // nada a emitir.
      continue;
    }
    const salaWire = mapearSala(sala, apelidoPorJogadorId, linkBase);

    switch (evento.tipo) {
      case 'sala_criada': {
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'membro_admitido': {
        const membro = sala.membros.find((m) => m.id === evento.membroId);
        if (membro === undefined) {
          break;
        }
        const membroDaSala = mapearMembro(
          membro,
          apelidoPorJogadorId.get(membro.jogadorId) ?? '',
          sala.anfitriaoId,
        );
        const eventoMembro: MembroEntrouEvento = {
          type: 'MEMBRO_ENTROU',
          membro: membroDaSala,
          sala: salaWire,
        };
        saida.push(eventoMembro);
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'membro_saiu': {
        const eventoMembro: MembroSaiuEvento = {
          type: 'MEMBRO_SAIU',
          membroId: evento.membroId,
          jogadorId: evento.jogadorId,
          sala: salaWire,
        };
        saida.push(eventoMembro);
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'sala_encerrada': {
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'anfitriao_sucedido': {
        const eventoAnfitriao: AnfitriaoSubstituidoEvento = {
          type: 'ANFITRIAO_SUBSTITUIDO',
          anfitriaoId: evento.anfitriaoNovoId,
          anfitriaoAnteriorId: evento.anfitriaoAnteriorId,
          sala: salaWire,
        };
        saida.push(eventoAnfitriao);
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'membro_expulsado': {
        const eventoExpulso: MembroExpulsoEvento = {
          type: 'MEMBRO_EXPULSO',
          membroId: evento.membroId,
          jogadorId: evento.jogadorId,
          sala: salaWire,
        };
        saida.push(eventoExpulso);
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'retorno_autorizado': {
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'prontidao_alterada': {
        const eventoProntidao: ProntidaoAtualizadaEvento = {
          type: 'PRONTIDAO_ATUALIZADA',
          membroId: evento.membroId,
          prontidao: evento.pronto,
          sala: salaWire,
        };
        saida.push(eventoProntidao);
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'membro_desconectado': {
        const eventoDesconectado: MembroDesconectadoEvento = {
          type: 'MEMBRO_DESCONECTADO',
          membroId: evento.membroId,
          jogadorId: evento.jogadorId,
          presenca: 'em_reconexao',
          sala: salaWire,
        };
        saida.push(eventoDesconectado);
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'membro_reconectado': {
        const eventoReconectado: MembroReconectadoEvento = {
          type: 'MEMBRO_RECONECTADO',
          membroId: evento.membroId,
          jogadorId: evento.jogadorId,
          presenca: 'conectado',
          sala: salaWire,
        };
        saida.push(eventoReconectado);
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'vinculo_expirado': {
        const eventoExpirado: MembroSaiuEvento = {
          type: 'MEMBRO_SAIU',
          membroId: evento.membroId,
          jogadorId: evento.jogadorId,
          sala: salaWire,
        };
        saida.push(eventoExpirado);
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'sala_expirada': {
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'reinicio_registrado':
      case 'consistencia_confirmada': {
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'encaminhamento_iniciado': {
        const ev: PartidaPreparandoEvento = { type: 'PARTIDA_PREPARANDO' };
        saida.push(ev);
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'sala_encaminhada': {
        // PARTIDA_DISPONIVEL precisa de serverId/partidaId — não há no domínio,
        // será emitido diretamente pelo handler com dados do game-server.
        // Aqui emitimos só SALA_ATUALIZADA para manter compatibilidade se chamado via engine.
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'encaminhamento_recusado': {
        const ev: PartidaRecusadaEvento = {
          type: 'PARTIDA_RECUSADA',
          codigo: 'ENCAMINHAMENTO_RECUSADO',
          motivo: 'Encaminhamento recusado pelo game-server',
        };
        saida.push(ev);
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      case 'encaminhamento_falhou': {
        const ev: PartidaFalhouEvento = {
          type: 'PARTIDA_FALHOU',
          codigo: 'ENCAMINHAMENTO_FALHOU',
          motivo: 'Falha ao encaminhar para o game-server',
        };
        saida.push(ev);
        saida.push(salaAtualizada(sala, apelidoPorJogadorId, linkBase));
        break;
      }

      default:
        break;
    }
  }

  return saida;
}
