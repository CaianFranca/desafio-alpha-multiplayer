import { useCopiar } from '../../hooks/useCopiar'
import { BotaoCopiar } from './BotaoCopiar'

interface Props {
  codigoDeSala: string
}

export function CodigoDeSalaCard({ codigoDeSala }: Props) {
  const { copiado, copiar } = useCopiar()

  return (
    <div className="border border-white/10 bg-[#1e1e1e] p-5 flex flex-col gap-2">
      <p className="text-sm tracking-[0.18em] uppercase text-white/60">Código de Sala</p>
      <div className="flex items-center justify-between gap-3">
        <p className="text-2xl tracking-[0.35em] font-mono text-[#f5b86e]" aria-label="Código de Sala">
          {codigoDeSala}
        </p>
        <BotaoCopiar rotulo="Código de Sala" copiado={copiado} aoClicar={() => void copiar(codigoDeSala)} />
      </div>
      {copiado && <span className="text-sm text-green-400">Copiado!</span>}
    </div>
  )
}