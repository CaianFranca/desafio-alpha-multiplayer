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
      <label htmlFor={id} className="block text-sm font-medium text-[var(--color-muted)] mb-1">
        {label}
      </label>
      <div className="relative">
        <span className="absolute inset-y-0 left-3 flex items-center text-slate-400" aria-hidden="true">
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
          className="w-full pl-10 pr-3 py-2.5 bg-[#111827]/50 border border-slate-600 rounded-md text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
        />
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
