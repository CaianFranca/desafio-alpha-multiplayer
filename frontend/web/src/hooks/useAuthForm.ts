import { useState } from 'react'
import type { AuthFieldErrors } from '../api/auth'

export function useAuthForm() {
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function clearFieldError(campo: keyof AuthFieldErrors) {
    setFieldErrors((prev) => ({ ...prev, [campo]: undefined }))
  }

  return {
    fieldErrors,
    setFieldErrors,
    generalError,
    setGeneralError,
    isSubmitting,
    setIsSubmitting,
    clearFieldError,
  }
}
