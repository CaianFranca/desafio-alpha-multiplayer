// Tradução pura engine → wire dos eventos da Sala (issue #36).
// Função sem side-effects: dado o estado pós-engine e os eventos emitidos,
// devolve os `SalaEventoDoServidor` correspondentes. O cache de apelidos é
// injetado pelo chamador (handler) — esta função não toca DB/Redis.
//
// Mapeamentos (do plano):
//   sala_criada         -> SALA_ATUALIZADA
//   membro_admitido     -> MEMBRO_ENTROU + SALA_ATUALIZADA
//   membro_saiu         -> MEMBRO_SAIU  + SALA_ATUALIZADA
//   sala_encerrada      -> SALA_ATUALIZADA (estado='encerrada')
//   anfitriao_sucedido  -> ANFITRIAO_SUBSTITUIDO + SALA_ATUALIZADA
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
  AnfitriaoSubstituidoEvento,
} from '@flicker/shared';

export type ApelidoPorJogadorId = ReadonlyMap<string, string>;

function mapearEstado(engine: SalaDominio['estado']): EstadoDaSala {
  // O wire `EstadoDaSala` é binário: 'aberta' | 'encerrada'. 'encaminhada'
  // continua sendo 'aberta' para o cliente (o estado de encaminhamento é
  // decidido pelo server na transição de aceite, fora do escopo deste
  // handler). 'expirada' mapeia para 'encerrada' — o cliente não distingue.
  return engine === 'aberta' || engine === 'encaminhada' ? 'aberta' : 'encerrada';
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

function mapearSala(
  sala: SalaDominio,
  apelidoPorJogadorId: ApelidoPorJogadorId,
  linkBase: string,
): Sala {
  return {
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
): readonly SalaEventoDoServidor[] {
  const saida: SalaEventoDoServidor[] = [];

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

      // Demais eventos do engine não são emitidos no escopo deste handler
      // (pertence a outros comandos fora do #36). Ignorados explicitamente
      // para não acionar o `default` do switch.
      default:
        break;
    }
  }

  return saida;
}
