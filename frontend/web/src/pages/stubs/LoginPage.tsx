import { useLocation } from 'react-router-dom'
import { StubPage } from './StubPage'
import { stubs } from '../../components/home/placeholders'

interface LoginLocationState {
  reason?: string
}

export function LoginPage() {
  const location = useLocation()
  const reason = (location.state as LoginLocationState | null)?.reason

  return <StubPage title={stubs.login.title} message={stubs.login.message} notice={reason} />
}
