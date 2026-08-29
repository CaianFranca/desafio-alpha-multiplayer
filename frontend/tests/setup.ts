import '@testing-library/jest-dom/vitest'

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
