import { useState } from 'react'

interface Props {
  codigoDeSala: string
}

export function CodigoDeAcessoCard({ codigoDeSala }: Props) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigoDeSala)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      // ignora falha de clipboard
    }
  }

  return (
    <div className="border border-white/10 bg-[#1e1e1e] p-5 flex flex-col gap-2">
      <p className="text-[10px] tracking-[0.18em] uppercase text-white/60">Código de Acesso</p>
      <div className="flex items-center justify-between gap-3">
        <p className="text-2xl tracking-[0.35em] font-mono text-[#f5b86e]" aria-label="Código de Sala">
          {codigoDeSala}
        </p>
        <button
          type="button"
          onClick={() => void copiar()}
          aria-label="Copiar Código de Acesso"
          className="border border-white/20 w-8 h-8 flex items-center justify-center text-white/70 hover:text-white hover:border-white/40 transition-colors"
        >
          <span aria-hidden>{copiado ? '✓' : '⧉'}</span>
        </button>
      </div>
      {copiado && <span className="text-xs text-green-400">Copiado!</span>}
    </div>
  )
}
