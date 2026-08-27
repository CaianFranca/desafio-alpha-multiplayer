export function isValidEmail(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim())
}

function validarEmail(valor: string): string | null {
  const trimmed = valor.trim()
  if (trimmed.length === 0) return 'Informe o email.'
  if (!isValidEmail(trimmed)) return 'Informe um email válido.'
  return null
}

export function validarApelido(valor: string): string | null {
  const trimmed = valor.trim()
  if (trimmed.length === 0) return 'Informe o apelido.'
  if (trimmed.length < 3 || trimmed.length > 20) return 'O apelido deve ter entre 3 e 20 caracteres.'
  return null
}

export function validarEmailCadastro(valor: string): string | null {
  return validarEmail(valor)
}

export function validarEmailCredenciais(valor: string): string | null {
  return validarEmail(valor)
}

export function validarSenhaCadastro(valor: string): string | null {
  if (valor.length === 0) return 'Informe a senha.'
  if (valor.length < 8) return 'A senha deve ter no mínimo 8 caracteres.'
  return null
}

export function validarSenhaCredenciais(valor: string): string | null {
  if (valor.length === 0) return 'Informe a senha.'
  return null
}
