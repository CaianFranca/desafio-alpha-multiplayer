import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { AuthFieldErrors } from '../api/auth'
import { useAuth } from '../state/useAuth'
import { AuthCard } from '../components/auth/AuthCard'
import { AuthField } from '../components/auth/AuthField'
import { useAuthForm } from '../hooks/useAuthForm'
import { validarEmailCredenciais, validarSenhaCredenciais } from '../utils/validacaoCredenciais'

interface CredenciaisLocationState {
  reason?: string
}

export function EntrarPage() {
  const { entrarComCredenciais } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const reason = (location.state as CredenciaisLocationState | null)?.reason

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const { fieldErrors, generalError, isSubmitting, clearFieldError, submit } = useAuthForm()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const ok = await submit(
      () => {
        const erros: AuthFieldErrors = {}
        const e1 = validarEmailCredenciais(email)
        if (e1) erros.email = e1
        const e2 = validarSenhaCredenciais(senha)
        if (e2) erros.senha = e2
        return Object.keys(erros).length > 0 ? erros : null
      },
      () => entrarComCredenciais({ email: email.trim(), senha }),
    )
    if (ok) navigate('/')
  }

  return (
    <AuthCard title="Entrar" subtitle="Junte-se ao Flicker of Sanity">
      {reason && (
        <p role="status" className="auth-notice mt-6">
          {reason}
        </p>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="mt-8 space-y-5">
        {generalError && (
          <p role="alert" className="auth-alert">
            {generalError}
          </p>
        )}

        <AuthField
          id="email"
          label="Email"
          autoComplete="email"
          placeholder="seu@email.com"
          value={email}
          error={fieldErrors.email}
          onChange={setEmail}
          onClearError={() => clearFieldError('email')}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          }
        />

        <AuthField
          id="senha"
          label="Senha"
          type="password"
          autoComplete="current-password"
          placeholder="Senha"
          value={senha}
          error={fieldErrors.senha}
          onChange={setSenha}
          onClearError={() => clearFieldError('senha')}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          }
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="auth-submit"
        >
          {isSubmitting ? 'Enviando...' : 'ENTRAR'}
        </button>
      </form>

      <p className="text-sm text-center text-muted mt-6">
        Ainda não tem Cadastro?{' '}
        <Link to="/cadastro" className="auth-link">
          Crie seu Cadastro
        </Link>
      </p>
    </AuthCard>
  )
}

/** @deprecated use EntrarPage — arquivo LoginPage removido, alias para compatibilidade */
export const LoginPage = EntrarPage
