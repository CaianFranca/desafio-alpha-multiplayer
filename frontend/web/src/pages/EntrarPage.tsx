import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
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
        const erros: Record<string, string> = {}
        const e1 = validarEmailCredenciais(email)
        if (e1) erros.email = e1
        const e2 = validarSenhaCredenciais(senha)
        if (e2) erros.senha = e2
        return Object.keys(erros).length > 0 ? (erros as never) : null
      },
      () => entrarComCredenciais({ email: email.trim(), senha }),
    )
    if (ok) navigate('/')
  }

  return (
    <AuthCard title="Entrar" subtitle="Junte-se ao Flicker of Sanity">
      {reason && (
        <p role="status" className="mt-6 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2 text-center">
          {reason}
        </p>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="mt-8 space-y-5">
        {generalError && (
          <p role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
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
          className="w-full bg-[var(--color-accent)] text-slate-900 font-bold uppercase tracking-wide py-3 rounded-md hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {isSubmitting ? 'Enviando...' : 'ENTRAR'}
        </button>
      </form>

      <p className="text-sm text-center text-[var(--color-muted)] mt-6">
        Ainda não tem Cadastro?{' '}
        <Link to="/cadastro" className="!text-amber-400 underline decoration-2 underline-offset-4 decoration-amber-400/70 hover:decoration-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)] rounded-sm transition-colors">
          Crie seu Cadastro
        </Link>
      </p>
    </AuthCard>
  )
}

/** @deprecated use EntrarPage — arquivo LoginPage removido, alias para compatibilidade */
export const LoginPage = EntrarPage
