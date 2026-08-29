import type { EstadoDaTela } from './partidaTelaMachine'

interface PartidaDevToolbarProps {
  onForcar: (estado: EstadoDaTela) => void
}

const estados: readonly EstadoDaTela[] = ['carregando', 'aguardando', 'disponivel', 'falha'] as const

export function PartidaDevToolbar({ onForcar }: PartidaDevToolbarProps) {
  if (!import.meta.env.DEV) {
    return null
  }

  return (
    <div
      data-testid="partida-dev-toolbar"
      className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 gap-2 rounded bg-zinc-800 p-2 shadow-lg"
      aria-label="Controles de desenvolvimento da partida"
    >
      {estados.map((estado) => (
        <button
          key={estado}
          type="button"
          data-testid={`dev-forcar-${estado}`}
          aria-label={`Forçar estado ${estado}`}
          onClick={() => onForcar(estado)}
          className="rounded bg-zinc-700 px-3 py-1 text-xs text-white hover:bg-zinc-600"
        >
          {estado}
        </button>
      ))}
    </div>
  )
}
