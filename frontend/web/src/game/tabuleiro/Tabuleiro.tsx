import { chaveCelula, todasAsCelulas } from './contrato'
import type { PecaPosicionada } from './contrato'
import { Celula } from './Celula'

interface TabuleiroProps {
  posicionadas: readonly PecaPosicionada[]
}

export function Tabuleiro({ posicionadas }: TabuleiroProps) {
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
        return <Celula key={chave} celula={celula} peca={peca} />
      })}
    </group>
  )
}
