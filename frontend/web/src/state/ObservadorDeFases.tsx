/**
 * Observador de fases do stream de depuração (issue #340), no nível App:
 * status de auth + rota → login/registro; autenticado → sala. As fases de
 * turno (turno-1..4) são definidas pela PartidaPage — é ela quem consome o
 * canal da partida (TURNO_INICIADO/ENCERRADO + snapshot com a ordem do
 * roster); ao sair da partida devolve a fase para `sala`.
 */

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import { definirFase } from '../utils/coletorDeDepuracao'

export function ObservadorDeFases() {
  const { authState } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (authState.status !== 'authenticated') {
      // Visitante: login por padrão; a rota de cadastro marca o registro.
      definirFase(location.pathname.startsWith('/cadastro') ? 'registro' : 'login')
      return
    }
    definirFase('sala')
  }, [authState.status, location.pathname])

  return null
}
