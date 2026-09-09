/**
 * Estado do Modo Desenvolvedor (issue #340): modo ativo + visibilidade do
 * painel. Montado em ambas as branches do `App.tsx` — o gatilho vive no
 * Footer (HomePage) e o painel/botão flutuante são globais. Esconder o
 * painel não altera a captura nem o stream do backend: o modo continua
 * ativo até a aba fechar.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { aoAtivarModo, ativarModoDoDesenvolvedor, estaModoAtivo } from '../utils/coletorDeDepuracao'
import { ModoDesenvolvedorContext } from './modo-desenvolvedor-context'
import { PainelDeDepuracao } from '../components/depuracao/PainelDeDepuracao'

export function ModoDesenvolvedorProvider({ children }: { children: ReactNode }) {
  // O modo lê do sessionStorage no boot do coletor: sobrevive a reload.
  const [ativo, setAtivo] = useState(() => estaModoAtivo())
  const [painelVisivel, setPainelVisivel] = useState(false)

  const ativarModo = useCallback(() => {
    // Idempotente: cliques extra não renotificam nem remontam o painel.
    ativarModoDoDesenvolvedor()
    setAtivo(true)
  }, [])

  const alternarPainel = useCallback(() => {
    setPainelVisivel((visivel) => !visivel)
  }, [])

  // O gatilho do Footer ativa pelo coletor (fonte única do modo); o provider
  // espelha o instante da ativação para remontar botão/painel.
  useEffect(() => aoAtivarModo(() => setAtivo(true)), [])

  const valor = useMemo(
    () => ({ ativo, painelVisivel, ativarModo, alternarPainel }),
    [ativo, painelVisivel, ativarModo, alternarPainel],
  )

  return (
    <ModoDesenvolvedorContext.Provider value={valor}>
      {children}
      {ativo && (
        <button
          type="button"
          onClick={alternarPainel}
          aria-pressed={painelVisivel}
          className="fixed right-4 top-4 z-[60] rounded-md border border-slate-600 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
        >
          {painelVisivel ? 'Fechar depuração' : 'Depuração'}
        </button>
      )}
      {ativo && painelVisivel && <PainelDeDepuracao />}
    </ModoDesenvolvedorContext.Provider>
  )
}
