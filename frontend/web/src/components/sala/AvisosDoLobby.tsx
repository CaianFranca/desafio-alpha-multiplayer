import type { AvisoDoLobby } from '../../hooks/useSalaWebSocket'

interface Props {
  avisos: AvisoDoLobby[]
}

export function AvisosDoLobby({ avisos }: Props) {
  if (avisos.length === 0) return null
  return (
    <div
      className="flex flex-col gap-2 max-h-36 overflow-y-auto pr-1"
      aria-live="polite"
      aria-label="Avisos do Lobby"
    >
      {avisos.map((aviso) => (
        <p key={aviso.id} role="status" className="text-sm text-white/85 bg-white/5 border border-white/30 px-3 py-2">
          {aviso.mensagem}
        </p>
      ))}
    </div>
  )
}
