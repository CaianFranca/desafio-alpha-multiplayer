import type { EstadoDaTela, ResultadoDaPartida } from './partidaTelaMachine'

interface PartidaOverlaysProps {
  estado: EstadoDaTela
  resultado: ResultadoDaPartida | null
  onRetry: () => void
  onVoltar: () => void
}

const baseClasses = 'absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/80'

export function PartidaOverlays({ estado, resultado, onRetry, onVoltar }: PartidaOverlaysProps) {
  if (estado === 'disponivel') {
    return null
  }

  if (estado === 'resultado') {
    const vitoria = resultado === 'vitoria'
    return (
      <div
        data-testid="overlay-resultado"
        data-resultado={resultado ?? ''}
        role="status"
        className={baseClasses}
      >
        <div className="flex flex-col items-center gap-4">
          <p className="text-white text-2xl font-bold">{vitoria ? 'Vitória!' : 'Derrota'}</p>
          <p className="text-zinc-400 text-sm">
            {vitoria ? 'A equipe escapou do sanatório' : 'A equipe não conseguiu escapar'}
          </p>
          <button
            type="button"
            data-testid="voltar-a-sala"
            onClick={onVoltar}
            className="pointer-events-auto rounded bg-amber-500 px-6 py-2 text-sm font-medium text-zinc-900 hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            Voltar à sala
          </button>
        </div>
      </div>
    )
  }

  if (estado === 'carregando') {
    return (
      <div data-testid="overlay-carregando" role="status" className={baseClasses}>
        <p className="text-white text-lg">Carregando...</p>
      </div>
    )
  }

  if (estado === 'aguardando') {
    return (
      <div data-testid="overlay-aguardando" role="status" className={baseClasses}>
        <div className="flex flex-col items-center gap-2">
          <p className="text-white text-lg">Aguardando partida</p>
          <p className="text-zinc-400 text-sm">Partida preparada</p>
        </div>
      </div>
    )
  }

  // estado === 'falha'
  return (
    <div data-testid="overlay-falha" role="alert" className={baseClasses}>
      <div className="flex flex-col items-center gap-4">
        <p className="text-white text-lg">Falha ao carregar</p>
        <button
          type="button"
          data-testid="partida-tentar-novamente"
          onClick={onRetry}
          className="pointer-events-auto rounded bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  )
}
