import { Component, type ReactNode } from 'react'
import { ErrorPage } from './ErrorPage'
import { coletar } from '../../utils/coletorDeDepuracao'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  // Captura do boundary no stream de depuração (issue #340): fonte `boundary`
  // com o componente no contexto. `getDerivedStateFromError` é o caminho
  // render-safe; o registro vai aqui para não poluir a fase de render.
  componentDidCatch(error: Error): void {
    coletar('boundary', 'error', error.message, 'ErrorBoundary')
  }

  render() {
    if (this.state.hasError) {
      return <ErrorPage message={this.state.error?.message} />
    }
    return this.props.children
  }
}
