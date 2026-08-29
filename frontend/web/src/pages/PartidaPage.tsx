import { useState } from 'react'
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
  const [searchParams] = useSearchParams()
  const param = searchParams.get('partidaEstado')
  // ?partidaEstado é initialOnly e exclusivo de DEV — lido só no mount; após isso, estado interno (toolbar/retry) governa.
  // Prioridade: URL (DEV) > prop > default do hook. Gate DEV evita vazamento para produção (B2).
  const estadoViaUrl =
    import.meta.env.DEV && isEstadoDaTela(param) ? (param as EstadoDaTela) : null
  const estadoInicialEfetivo = estadoViaUrl ?? estadoInicial
  const { estado, tentarNovamente, forcarEstado } = usePartidaTela({
    estadoInicial: estadoInicialEfetivo,
    loader,
  })

  const [bordaPx, setBordaPx] = useState(0)

  // Acoplado ao header de App.tsx (5rem); remover/trocar por h-screen quando Partida deixar de ser filha de App
  return (
    <div className="relative min-h-[calc(100vh-5rem)] w-full overflow-hidden">
      <AmbienteDeJogo bordaPx={bordaPx} />
      <PartidaOverlays estado={estado} onRetry={tentarNovamente} />
      <PartidaMoldura onBordaChange={setBordaPx} />
      <PartidaDevToolbar onForcar={forcarEstado} />
    </div>
  )
}
