import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import './helpers/mockWebSocket'
import { limparToquesDeAudio } from './helpers/mockAudio'

// O ponto de som de recusa (#228) grava toques no mock global de Audio;
// limpa antes de cada teste para asserções isoladas (tocou/não tocou).
beforeEach(() => {
  limparToquesDeAudio()
})

// jsdom não implementa ResizeObserver; o <Canvas> do @react-three/fiber
// (via react-use-measure) exige um na montagem. Stub sem observação real:
// nos testes o canvas tem tamanho zero e só o fallback é renderizado.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub
}
