import { chaveCelula, selecionarPeaoNaExibicao } from '../../game/tabuleiro/contrato'
import type {
  Celula,
  PeaoDaExibicao,
  PeaoId,
  PecaDaReserva,
  PecaId,
  PecaPosicionada,
} from '../../game/tabuleiro/contrato'
import type { EstadoInteracaoTabuleiro } from '../../game/tabuleiro/interacao'
import type { EstadoInteracaoPeoes } from '../../game/tabuleiro/interacaoPeoes'
import {
  despacharCliqueDeCelula,
  ehComandoDePeao,
  mapearCliqueNaReservaComCiclo,
} from '../../game/tabuleiro/interacaoPeoes'
import type {
  PeaoComandoDoCliente,
  RecebidaId,
  TabuleiroComandoDoCliente,
} from '@flicker/shared'

interface TabuleiroMirrorDOMProps {
  todasCelulas: readonly Celula[]
  ocupadasSet: ReadonlySet<string>
  reserva: readonly PecaDaReserva[]
  posicionadas: readonly PecaPosicionada[]
  peoes: readonly PeaoDaExibicao[]
  /** Peão selecionado (estado visual local espelhado da cena, issue #90). */
  peaoSelecionadoId: PeaoId | null
  /** Peão do Jogador Ativo da vez (data-ativo no espelho, #118). */
  peaoAtivoId?: PeaoId | null
  /** PecaIds destinos válidos do peão selecionado (mesma fonte do destaque). */
  destinosSet: ReadonlySet<PecaId>
  aoSelecionarPeao?: (peaoId: PeaoId) => void
  aoDesselecionar?: () => void
  /** Estado de interação ST-09 para o fallback de célula/reserva (#91). */
  estadoInteracao?: EstadoInteracaoTabuleiro | null
  /** Estado do ciclo do peão: roteia cliques em células/pendências/reserva. */
  estadoPeoes?: EstadoInteracaoPeoes | null
  onComando?: (comando: TabuleiroComandoDoCliente | null) => void
  onComandoPeao?: (comando: PeaoComandoDoCliente) => void
  /** Recebida focada (validada pelo dono do foco, AmbienteDeJogo). */
  recebidaFocadaId?: RecebidaId | null
  aoFocarPendencia?: (recebidaId: RecebidaId) => void
  /** Chaves das células-alvo de pendências ativas (mesma fonte da cena). */
  alvosPendentesSet?: ReadonlySet<string>
  /** Chave da célula-alvo da pendência FOCADA. */
  alvoFocadoKey?: string | null
}

/**
 * Espelho DOM do tabuleiro — seam de testes (a cena WebGL é caixa-preta no
 * jsdom). Deriva do MESMO estado que a cena: peões, seleção, conexões e
 * pendências de Recebimento; cliques passam pelo MESMO roteador do ciclo
 * (despacharCliqueDeCelula / mapearCliqueNaReservaComCiclo, issue #91).
 *
 * Os handlers de clique aqui só têm efeito em testes: em browser real o
 * overlay é `pointer-events-none` (os cliques passam para a cena, onde os
 * mesmos callbacks são disparados via raycast). Clicar um peão seleciona;
 * clicar célula/peça roteia pelo ciclo (foco ou comando) ou aplica o fallback
 * ST-09; clicar qualquer outra área desseleciona — espelhando a cena.
 */
export function TabuleiroMirrorDOM({
  todasCelulas,
  ocupadasSet,
  reserva,
  posicionadas,
  peoes,
  peaoSelecionadoId,
  peaoAtivoId = null,
  destinosSet,
  aoSelecionarPeao,
  aoDesselecionar,
  estadoInteracao = null,
  estadoPeoes = null,
  onComando,
  onComandoPeao,
  recebidaFocadaId = null,
  aoFocarPendencia,
  alvosPendentesSet = new Set<string>(),
  alvoFocadoKey = null,
}: TabuleiroMirrorDOMProps) {
  // Mesma derivação pura usada pela cena: resolve a peça sob o peão selecionado
  // (null quando o peão está sobre a Mesa ou sem peça → sem conexões destacadas).
  const selecao =
    peaoSelecionadoId !== null
      ? selecionarPeaoNaExibicao({ posicionadas, peoes }, peaoSelecionadoId)
      : null

  const aoClicarCelula = (celula: Celula, e: { stopPropagation(): void }) => {
    if (estadoInteracao === null) {
      // Sem canal de interação (mock DEV): deixa o clique borbulhar para a
      // raiz — comportamento de desseleção do #90.
      return
    }
    e.stopPropagation()
    despacharCliqueDeCelula(estadoPeoes, estadoInteracao, celula, {
      onComando,
      onComandoPeao,
      onFocarPendencia: aoFocarPendencia,
    })
  }

  const aoClicarReserva = (peca: PecaDaReserva) => {
    if (estadoInteracao === null) return
    const comando = mapearCliqueNaReservaComCiclo(
      estadoPeoes,
      estadoInteracao,
      recebidaFocadaId,
      peca,
    )
    if (comando === null) return
    if (ehComandoDePeao(comando)) {
      onComandoPeao?.(comando)
    } else {
      onComando?.(comando)
    }
  }

  return (
    <div
      data-testid="tabuleiro"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      onClick={aoDesselecionar}
    >
      {todasCelulas.map((celula) => {
        const chave = chaveCelula(celula)
        const ocupada = ocupadasSet.has(chave)
        const alvoPendente = alvosPendentesSet.has(chave)
        return (
          <div
            key={chave}
            data-testid="tabuleiro-celula"
            data-ocupada={ocupada ? 'true' : 'false'}
            data-linha={celula.linha}
            data-coluna={celula.coluna}
            data-alvo-pendente={alvoPendente ? 'true' : undefined}
            data-focada={chave === alvoFocadoKey ? 'true' : undefined}
            onClick={(e) => {
              aoClicarCelula(celula, e)
            }}
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
            onClick={(e) => {
              e.stopPropagation()
              aoClicarReserva(peca)
            }}
          />
        ))}
      </div>
      {posicionadas.map((p) => (
        <div
          key={p.pecaId}
          data-testid="peca-posicionada"
          data-peca-id={p.pecaId}
          data-conectada={
            selecao ? (destinosSet.has(p.pecaId) ? 'true' : 'false') : undefined
          }
          data-selecionada={
            selecao ? (selecao.pecaId === p.pecaId ? 'true' : 'false') : undefined
          }
          onClick={(e) => {
            aoClicarCelula(p.celula, e)
          }}
        />
      ))}
      {estadoPeoes
        ? estadoPeoes.recebidasPendentes.map((r) => (
            <div
              key={r.recebidaId}
              data-testid="recebida-pendente"
              data-recebida-id={r.recebidaId}
              data-celula-alvo={
                r.celulaAlvo !== null ? chaveCelula(r.celulaAlvo) : undefined
              }
              data-peca-id={r.pecaId ?? undefined}
              data-focada={r.recebidaId === recebidaFocadaId ? 'true' : 'false'}
              onClick={(e) => {
                e.stopPropagation()
                aoFocarPendencia?.(r.recebidaId)
              }}
            />
          ))
        : null}
      <div data-testid="peoes">
        {peoes.map((peao) => (
          <div
            key={peao.peaoId}
            data-testid="peao"
            data-peao-id={peao.peaoId}
            data-cor={peao.cor}
            data-posicionado={peao.celula !== null ? 'true' : 'false'}
            data-selecionado={peao.peaoId === peaoSelecionadoId ? 'true' : 'false'}
            data-ativo={peao.peaoId === peaoAtivoId ? 'true' : 'false'}
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
