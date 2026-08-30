import { chaveCelula, todasAsCelulas } from './contrato'
import type { PecaPosicionada } from './contrato'
import { Celula } from './Celula'
import { cursorParaCelula } from './interacao'
import type { EstadoInteracaoTabuleiro } from './interacao'
import { mapearCliqueNaCelula, mapearCliqueNaPecaPosicionada } from './interacao'
import type { TabuleiroComandoDoCliente } from '@flicker/shared'

interface TabuleiroProps {
  posicionadas: readonly PecaPosicionada[]
  /** Estado de interação (seleção/manipulação) para cursor e destaques. */
  estadoInteracao: EstadoInteracaoTabuleiro
  /** Callback de comando mapeado (null = sem ação). */
  onComando: (comando: TabuleiroComandoDoCliente | null) => void
}

export function Tabuleiro({ posicionadas, estadoInteracao, onComando }: TabuleiroProps) {
  const posicionadasPorChave = new Map<string, PecaPosicionada>()
  for (const p of posicionadas) {
    posicionadasPorChave.set(chaveCelula(p.celula), p)
  }

  const celulas = todasAsCelulas()

  return (
    <group>
      {celulas.map((celula) => {
        const chave = chaveCelula(celula)
        const peca = posicionadasPorChave.get(chave) ?? null
        const ocupada = Boolean(peca)
        const cursor = cursorParaCelula(ocupada, estadoInteracao.pecaSelecionadaId)
        const destacada =
          peca !== null &&
          (estadoInteracao.pecaSelecionadaId === peca.pecaId ||
            estadoInteracao.pecaEmManipulacaoId === peca.pecaId)
        return (
          <Celula
            key={chave}
            celula={celula}
            peca={peca}
            cursor={cursor}
            pecaDestacada={destacada}
            onClick={() => {
              // Clique na própria peça posicionada (fecha manipulação via
              // SELECIONAR_PECA) ou em célula vazia com seleção (POSICIONAR_PECA).
              const comando =
                peca !== null
                  ? mapearCliqueNaPecaPosicionada(estadoInteracao, peca.pecaId)
                  : mapearCliqueNaCelula(estadoInteracao, celula)
              onComando(comando)
            }}
          />
        )
      })}
    </group>
  )
}
