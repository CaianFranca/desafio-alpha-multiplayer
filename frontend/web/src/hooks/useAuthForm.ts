import { useState } from 'react'
import type { AuthFieldErrors } from '../api/auth'

export function useAuthForm() {
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function clearFieldError(campo: keyof AuthFieldErrors) {
    setFieldErrors((prev) => ({ ...prev, [campo]: undefined }))
  }

  async function submit(
    validate: () => AuthFieldErrors | null,
    action: () => Promise<{ ok: boolean; fieldErrors?: AuthFieldErrors; generalError?: string }>,
  ): Promise<boolean> {
    const erros = validate()
    if (erros && Object.keys(erros).length > 0) {
      setFieldErrors(erros)
      setGeneralError(null)
      return false
    }
    setIsSubmitting(true)
    setFieldErrors({})
    setGeneralError(null)
    try {
      const result = await action()
      if (result.ok) return true
      setFieldErrors(result.fieldErrors ?? {})
      if (result.generalError) setGeneralError(result.generalError)
      return false
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    fieldErrors,
    setFieldErrors,
    generalError,
    setGeneralError,
    isSubmitting,
    setIsSubmitting,
    clearFieldError,
    submit,
  }
}
