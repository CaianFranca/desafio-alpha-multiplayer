import { chaveCelula } from '../../game/tabuleiro/contrato'
import type {
  Celula,
  PeaoDaExibicao,
  PeaoId,
  PecaDaReserva,
  PecaId,
  PecaPosicionada,
} from '../../game/tabuleiro/contrato'

interface TabuleiroMirrorDOMProps {
  todasCelulas: readonly Celula[]
  ocupadasSet: ReadonlySet<string>
  reserva: readonly PecaDaReserva[]
  posicionadas: readonly PecaPosicionada[]
  peoes: readonly PeaoDaExibicao[]
  /** Peão selecionado (estado visual local espelhado da cena, issue #90). */
  peaoSelecionadoId: PeaoId | null
  /** PecaIds destinos válidos do peão selecionado (mesma fonte do destaque). */
  destinosSet: ReadonlySet<PecaId>
  aoSelecionarPeao?: (peaoId: PeaoId) => void
  aoDesselecionar?: () => void
}

/**
 * Espelho DOM do tabuleiro — seam de testes (a cena WebGL é caixa-preta no
 * jsdom). Deriva do MESMO estado que a cena: peões, seleção e conexões.
 *
 * Os handlers de clique aqui só têm efeito em testes: em browser real o
 * overlay é `pointer-events-none` (os cliques passam para a cena, onde os
 * mesmos callbacks são disparados via raycast). Clicar um peão seleciona;
 * clicar qualquer outra área do espelho desseleciona — espelhando o
 * comportamento da cena.
 */
export function TabuleiroMirrorDOM({
  todasCelulas,
  ocupadasSet,
  reserva,
  posicionadas,
  peoes,
  peaoSelecionadoId,
  destinosSet,
  aoSelecionarPeao,
  aoDesselecionar,
}: TabuleiroMirrorDOMProps) {
  const peaoSelecionado =
    peaoSelecionadoId !== null
      ? peoes.find((peao) => peao.peaoId === peaoSelecionadoId) ?? null
      : null
  // A seleção só produz conexões/destaque quando o peão está posicionado
  // sobre uma peça da grade.
  const selecaoPosicionada = Boolean(
    peaoSelecionado &&
      peaoSelecionado.celula !== null &&
      posicionadas.some((p) => chaveCelula(p.celula) === chaveCelula(peaoSelecionado.celula!)),
  )
  const pecaDoPeaoSelecionado =
    selecaoPosicionada && peaoSelecionado?.celula
      ? posicionadas.find((p) => chaveCelula(p.celula) === chaveCelula(peaoSelecionado.celula!))?.pecaId ?? null
      : null

  return (
    <div
      data-testid="tabuleiro"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      onClick={aoDesselecionar}
    >
      {todasCelulas.map((celula) => {
        const ocupada = ocupadasSet.has(chaveCelula(celula))
        return (
          <div
            key={chaveCelula(celula)}
            data-testid="tabuleiro-celula"
            data-ocupada={ocupada ? 'true' : 'false'}
            data-linha={celula.linha}
            data-coluna={celula.coluna}
          />
        )
      })}
      <div data-testid="reserva">
        {reserva.map((peca) => (
          <div
            key={peca.pecaId}
            data-testid="reserva-peca"
            data-tipo={peca.tipo}
            data-peca-id={peca.pecaId}
          />
        ))}
      </div>
      {posicionadas.map((p) => (
        <div
          key={p.pecaId}
          data-testid="peca-posicionada"
          data-peca-id={p.pecaId}
          data-conectada={
            selecaoPosicionada ? (destinosSet.has(p.pecaId) ? 'true' : 'false') : undefined
          }
          data-selecionada={
            selecaoPosicionada
              ? (pecaDoPeaoSelecionado === p.pecaId ? 'true' : 'false')
              : undefined
          }
        />
      ))}
      <div data-testid="peoes">
        {peoes.map((peao) => (
          <div
            key={peao.peaoId}
            data-testid="peao"
            data-peao-id={peao.peaoId}
            data-cor={peao.cor}
            data-posicionado={peao.celula !== null ? 'true' : 'false'}
            data-selecionado={peao.peaoId === peaoSelecionadoId ? 'true' : 'false'}
            onClick={(e) => {
              // stopPropagation: não deixar o clique chegar ao "clique fora"
              // da raiz, que desselecionaria na sequência.
              e.stopPropagation()
              aoSelecionarPeao?.(peao.peaoId)
            }}
          />
        ))}
      </div>
    </div>
  )
}
