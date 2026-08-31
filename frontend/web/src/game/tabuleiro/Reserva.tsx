import { COLUNAS_RESERVA, dimensaoReserva, POSICAO_RESERVA, reservaIndiceParaLocal } from './contrato'
import type { PecaDaReserva } from './contrato'
import { PecaPlaceholder } from './PecaPlaceholder'
import type { EstadoInteracaoTabuleiro } from './interacao'
import type { EstadoInteracaoPeoes } from './interacaoPeoes'
import { ehComandoDePeao, mapearCliqueNaReservaComCiclo } from './interacaoPeoes'
import type {
  PeaoComandoDoCliente,
  RecebidaId,
  TabuleiroComandoDoCliente,
} from '@flicker/shared'

interface ReservaProps {
  reserva: readonly PecaDaReserva[]
  /** Estado de interação para destaque da peça selecionada. */
  estadoInteracao: EstadoInteracaoTabuleiro
  onComando: (comando: TabuleiroComandoDoCliente | null) => void
  /** Estado do ciclo do peão: com pendências, a Reserva oferta tipos (#91). */
  estadoPeoes?: EstadoInteracaoPeoes | null
  /** Recebida focada (validada pelo pai; null = sem foco → não reage). */
  recebidaFocadaId?: RecebidaId | null
  /** Comando do ciclo do peão (escolha de tipo; jogadorId injetado no pai). */
  onComandoPeao?: (comando: PeaoComandoDoCliente) => void
}

export function Reserva({
  reserva,
  estadoInteracao,
  onComando,
  estadoPeoes = null,
  recebidaFocadaId = null,
  onComandoPeao,
}: ReservaProps) {
  const total = reserva.length
  const linhas = Math.ceil(total / COLUNAS_RESERVA) || 1
  const { largura, profundidade } = dimensaoReserva(linhas)

  return (
    <group position={[POSICAO_RESERVA[0], POSICAO_RESERVA[1], POSICAO_RESERVA[2]]}>
      <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[largura, profundidade]} />
        <meshStandardMaterial color="#1f1a18" transparent opacity={0.9} />
      </mesh>
      {reserva.map((peca, indice) => {
        const [lx, , lz] = reservaIndiceParaLocal(indice)
        const destacada = estadoInteracao.pecaSelecionadaId === peca.pecaId
        return (
          <PecaPlaceholder
            key={peca.pecaId}
            tipo={peca.tipo}
            orientacao={peca.orientacao}
            position={[lx, 0.02, lz]}
            destacada={destacada}
            cursor="pointer"
            onClick={() => {
              // Roteador da Reserva (#91): com pendências, clique oferta o
              // tipo da peça para a Recebida focada; sem pendências, ST-09.
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
                onComando(comando)
              }
            }}
          />
        )
      })}
    </group>
  )
}
