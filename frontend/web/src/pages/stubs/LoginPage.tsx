import { useLocation } from 'react-router-dom'
import { StubPage } from './StubPage'
import { stubs } from '../../components/home/placeholders'

interface LoginLocationState {
  motivo?: string
}

export function LoginPage() {
  const location = useLocation()
  const motivo = (location.state as LoginLocationState | null)?.motivo

  return <StubPage title={stubs.login.title} message={stubs.login.message} aviso={motivo} />
}
