import { StubPage } from './StubPage'
import { stubs } from '../../components/home/placeholders'

export function LoginPage() {
  return <StubPage title={stubs.login.title} message={stubs.login.message} />
}
