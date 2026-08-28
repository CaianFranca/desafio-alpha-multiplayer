import { useSearchParams } from 'react-router-dom'
import { AmbienteDeJogo } from '../components/partida/AmbienteDeJogo'
import { PartidaMoldura } from '../components/partida/PartidaMoldura'
import { PartidaOverlays } from '../components/partida/PartidaOverlays'
import { PartidaDevToolbar } from '../components/partida/PartidaDevToolbar'
import { usePartidaTela } from '../components/partida/usePartidaTela'
import { isEstadoDaTela, type EstadoDaTela } from '../components/partida/partidaTelaMachine'

interface PartidaPageProps {
  estadoInicial?: EstadoDaTela
  loader?: () => Promise<unknown>
}

export function PartidaPage({ estadoInicial, loader }: PartidaPageProps) {
  const { estado, tentarNovamente, forcarEstado } = usePartidaTela({ estadoInicial, loader })
  const [searchParams] = useSearchParams()
  const param = searchParams.get('partidaEstado')
  const estadoDev = isEstadoDaTela(param) ? param : null
  const estadoEfetivo = estadoDev ?? estado

  // Acoplado ao header de App.tsx (5rem); remover/trocar por h-screen quando Partida deixar de ser filha de App
  return (
    <div className="relative min-h-[calc(100vh-5rem)] w-full overflow-hidden">
      <AmbienteDeJogo />
      <PartidaOverlays estado={estadoEfetivo} onRetry={tentarNovamente} />
      <PartidaMoldura />
      {import.meta.env.DEV && <PartidaDevToolbar onForcar={forcarEstado} />}
    </div>
  )
}
