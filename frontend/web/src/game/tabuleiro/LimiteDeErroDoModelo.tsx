import { Component, type ReactNode } from 'react'

interface LimiteDeErroDoModeloProps {
  fallback: ReactNode
  children: ReactNode
  /**
   * Chave de reset (URL do modelo/textura): trocar o asset limpa o estado
   * de falha — um 500 transitório não condena o próximo carregamento (B5
   * da revisão da PR #317). Use junto com `key={mesmaUrl}` no ponto de uso.
   */
  resetKey?: string
}

interface LimiteDeErroDoModeloState {
  falhou: boolean
  chaveVista: string | undefined
}

/**
 * Limite de erro dos modelos 3D (issue #274): se o GLB/textura falhar
 * (rede/parse/404), renderiza o `fallback` em vez de derrubar o Canvas
 * inteiro (B4 da revisão da PR #317) — a cena nunca quebra.
 * O `Suspense` acima cobre o carregamento; este cobre a falha.
 */
export class LimiteDeErroDoModelo extends Component<
  LimiteDeErroDoModeloProps,
  LimiteDeErroDoModeloState
> {
  state: LimiteDeErroDoModeloState = {
    falhou: false,
    chaveVista: this.props.resetKey,
  }

  static getDerivedStateFromError(): Partial<LimiteDeErroDoModeloState> {
    return { falhou: true }
  }

  static getDerivedStateFromProps(
    props: LimiteDeErroDoModeloProps,
    state: LimiteDeErroDoModeloState,
  ): Partial<LimiteDeErroDoModeloState> | null {
    if (props.resetKey !== state.chaveVista) {
      return { falhou: false, chaveVista: props.resetKey }
    }
    return null
  }

  render() {
    if (this.state.falhou) return this.props.fallback
    return this.props.children
  }
}
