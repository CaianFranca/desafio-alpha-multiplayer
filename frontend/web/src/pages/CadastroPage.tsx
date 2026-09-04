import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AuthFieldErrors } from '../api/auth'
import { useAuth } from '../state/useAuth'
import { AuthCard } from '../components/auth/AuthCard'
import { AuthField } from '../components/auth/AuthField'
import { useAuthForm } from '../hooks/useAuthForm'
import { validarApelido, validarEmailCadastro, validarSenhaCadastro } from '../utils/validacaoCredenciais'

export function CadastroPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [apelido, setApelido] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const { fieldErrors, generalError, isSubmitting, clearFieldError, submit } = useAuthForm()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const ok = await submit(
      () => {
        const erros: AuthFieldErrors = {}
        const e1 = validarApelido(apelido)
        if (e1) erros.apelido = e1
        const e2 = validarEmailCadastro(email)
        if (e2) erros.email = e2
        const e3 = validarSenhaCadastro(senha)
        if (e3) erros.senha = e3
        return Object.keys(erros).length > 0 ? erros : null
      },
      () => register({ apelido: apelido.trim(), email: email.trim(), senha }),
    )
    if (ok) navigate('/')
  }

  return (
    <AuthCard title="Crie seu Cadastro" subtitle="Junte-se ao Flicker of Sanity">
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="mt-8 space-y-5">
        {generalError && (
          <p role="alert" className="auth-alert">
            {generalError}
          </p>
        )}

        <AuthField
          id="apelido"
          label="Apelido"
          autoComplete="username"
          placeholder="Escolha um apelido"
          value={apelido}
          error={fieldErrors.apelido}
          onChange={setApelido}
          onClearError={() => clearFieldError('apelido')}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          }
        />

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
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
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
          {isSubmitting ? 'Enviando...' : 'CADASTRAR-SE'}
        </button>
      </form>

      <p className="text-sm text-center text-[var(--color-muted)] mt-6">
        Já tem Cadastro?{' '}
        <Link to="/login" className="auth-link">
          Entre
        </Link>
      </p>
    </AuthCard>
  )
}
