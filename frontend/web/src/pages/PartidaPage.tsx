import { GameCanvas } from '../components/partida/GameCanvas'
import { PartidaMoldura } from '../components/partida/PartidaMoldura'

export function PartidaPage() {
  // Acoplado ao header de App.tsx (5rem); remover/trocar por h-screen quando Partida deixar de ser filha de App
  return (
    <div className="relative min-h-[calc(100vh-5rem)] w-full overflow-hidden">
      <GameCanvas />
      <PartidaMoldura />
    </div>
  )
}
