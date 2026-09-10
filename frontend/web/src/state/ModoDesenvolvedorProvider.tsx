/**
 * Estado do Modo Desenvolvedor (issue #340): modo ativo + visibilidade do
 * painel. Montado em ambas as branches do `App.tsx` — o gatilho vive no
 * Footer (HomePage) e o painel/botão flutuante são globais, ancorados na
 * borda direita (centro vertical). Esconder o painel não altera a captura
 * nem o stream do backend: o modo permanece ativo (sobrevive a reload) até
 * ser desligado pelo botão Desligar.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  aoAtivarModo,
  aoDesativarModo,
  ativarModoDoDesenvolvedor,
  desativarModoDoDesenvolvedor,
  estaModoAtivo,
} from '../utils/coletorDeDepuracao'
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

  const desativarModo = useCallback(() => {
    // Idempotente: desligar repetido não renotifica (o coletor ignora).
    desativarModoDoDesenvolvedor()
    setAtivo(false)
    setPainelVisivel(false)
  }, [])

  const alternarPainel = useCallback(() => {
    setPainelVisivel((visivel) => !visivel)
  }, [])

  // O gatilho do Footer ativa/desativa pelo coletor (fonte única do modo); o
  // provider espelha cada transição para remontar botão/painel.
  useEffect(() => {
    const desinscreverAtivacao = aoAtivarModo(() => setAtivo(true))
    const desinscreverDesativacao = aoDesativarModo(() => {
      setAtivo(false)
      setPainelVisivel(false)
    })
    return () => {
      desinscreverAtivacao()
      desinscreverDesativacao()
    }
  }, [])

  const valor = useMemo(
    () => ({ ativo, painelVisivel, ativarModo, desativarModo, alternarPainel }),
    [ativo, painelVisivel, ativarModo, desativarModo, alternarPainel],
  )

  return (
    <ModoDesenvolvedorContext.Provider value={valor}>
      {children}
      {ativo && (
        <div
          data-testid="controles-do-modo-desenvolvedor"
          className="fixed right-4 top-1/2 z-[70] flex max-h-[85vh] -translate-y-1/2 flex-col items-end gap-2"
        >
          <div className="flex gap-2">
            <button
              type="button"
              onClick={alternarPainel}
              aria-pressed={painelVisivel}
              className="z-[70] rounded-md border border-slate-600 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              {painelVisivel ? 'Fechar depuração' : 'Depuração'}
            </button>
            <button
              type="button"
              onClick={desativarModo}
              className="rounded-md border border-slate-600 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              Desligar
            </button>
          </div>
          {painelVisivel && <PainelDeDepuracao />}
        </div>
      )}
    </ModoDesenvolvedorContext.Provider>
  )
}
