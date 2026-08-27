import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/useAuth'
import type { AuthFieldErrors } from '../api/auth'

function validarEmailLogin(valor: string): string | null {
  const trimmed = valor.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Informe um email válido.'
  return null
}

function validarSenhaLogin(valor: string): string | null {
  if (valor.length === 0) return 'Informe a senha.'
  return null
}

interface LoginLocationState {
  reason?: string
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const reason = (location.state as LoginLocationState | null)?.reason

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const erros: AuthFieldErrors = {}
    const erroEmail = validarEmailLogin(email)
    if (erroEmail) erros.email = erroEmail
    const erroSenha = validarSenhaLogin(senha)
    if (erroSenha) erros.senha = erroSenha

    if (Object.keys(erros).length > 0) {
      setFieldErrors(erros)
      setGeneralError(null)
      return
    }

    setIsSubmitting(true)
    setFieldErrors({})
    setGeneralError(null)
    const result = await login({ email: email.trim(), senha })
    setIsSubmitting(false)
    if (result.ok) {
      navigate('/')
      return
    }
    setFieldErrors(result.fieldErrors)
    if (result.generalError) setGeneralError(result.generalError)
    // Caso o backend envie Credenciais inválidas sem campo, garante exibição
    // mesmo que fieldErrors esteja vazio.
  }

  return (
    <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-[var(--color-surface)] border border-white/10 rounded-xl p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-center">Entrar</h1>
        <p className="text-sm text-[var(--color-muted)] text-center mt-2">Junte-se ao Flicker of Sanity</p>

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

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[var(--color-muted)] mb-1">
              Email
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-slate-400" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </span>
              <input
                id="email"
                name="email"
                type="text"
                autoComplete="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }))
                }}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                className="w-full pl-10 pr-3 py-2.5 bg-[#111827]/50 border border-slate-600 rounded-md text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
              />
            </div>
            {fieldErrors.email && (
              <p id="email-error" role="alert" className="mt-1 text-sm text-red-400">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="senha" className="block text-sm font-medium text-[var(--color-muted)] mb-1">
              Senha
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-slate-400" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <input
                id="senha"
                name="senha"
                type="password"
                autoComplete="current-password"
                placeholder="Senha"
                value={senha}
                onChange={(e) => {
                  setSenha(e.target.value)
                  if (fieldErrors.senha) setFieldErrors((prev) => ({ ...prev, senha: undefined }))
                }}
                aria-invalid={Boolean(fieldErrors.senha)}
                aria-describedby={fieldErrors.senha ? 'senha-error' : undefined}
                className="w-full pl-10 pr-3 py-2.5 bg-[#111827]/50 border border-slate-600 rounded-md text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
              />
            </div>
            {fieldErrors.senha && (
              <p id="senha-error" role="alert" className="mt-1 text-sm text-red-400">
                {fieldErrors.senha}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[var(--color-accent)] text-slate-900 font-bold uppercase tracking-wide py-3 rounded-md hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Enviando...' : 'ENTRAR'}
          </button>
        </form>

        <p className="text-sm text-center text-[var(--color-muted)] mt-6">
          Ainda não possui uma conta?{' '}
          <Link to="/cadastro" className="text-[var(--color-accent)] hover:underline font-medium">
            Crie uma
          </Link>
        </p>
      </div>
    </div>
  )
}
