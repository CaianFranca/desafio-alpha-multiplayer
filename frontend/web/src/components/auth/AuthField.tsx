import type { ReactNode } from 'react'

interface AuthFieldProps {
  id: string
  label: string
  type?: string
  autoComplete?: string
  placeholder?: string
  value: string
  error?: string
  onChange: (value: string) => void
  onClearError?: () => void
  icon: ReactNode
}

export function AuthField({
  id,
  label,
  type = 'text',
  autoComplete,
  placeholder,
  value,
  error,
  onChange,
  onClearError,
  icon,
}: AuthFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="auth-field__label">
        {label}
      </label>
      <div className="relative">
        <span className="absolute inset-y-0 left-3 flex items-center text-muted" aria-hidden="true">
          {icon}
        </span>
        <input
          id={id}
          name={id}
          type={type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            if (error && onClearError) onClearError()
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className="auth-field__input"
        />
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="auth-field__error">
          {error}
        </p>
      )}
    </div>
  )
}
