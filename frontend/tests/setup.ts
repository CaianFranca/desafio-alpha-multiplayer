import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import './helpers/mockWebSocket'
import { limparToquesDeAudio } from './helpers/mockAudio'
import { CHAVE_SESSAO_TUTORIAL_DA_PARTIDA } from '../web/src/components/partida/conteudoDoTutorialDaPartida'

// O ponto de som de recusa (#228) grava toques no mock global de Audio;
// limpa antes de cada teste para asserções isoladas (tocou/não tocou).
// O Tutorial (#434) auto-abre na primeira Partida em andamento da aba: nos
// testes a aba (sessionStorage do jsdom) é compartilhada, então o default é
// "aba já atendida" para as suítes existentes não verem o modal; a suíte do
// tutorial limpa a flag quando testa a auto-abertura.
beforeEach(() => {
  limparToquesDeAudio()
  try {
    window.sessionStorage.setItem(CHAVE_SESSAO_TUTORIAL_DA_PARTIDA, '1')
  } catch {
    // Sessão indisponível: sem a flag, o Tutorial auto-abre (degradado
    // progressivo, nunca trava o jogo nem os testes).
  }
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
