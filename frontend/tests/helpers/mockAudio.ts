// Mock de Audio global para os testes da Partida (issue #228).
//
// O ponto de som de recusa (`tocarSomDeRecusa`) instancia `new Audio(...)` e
// chama `play()` — jsdom não implementa áudio de verdade. Este mock grava
// cada toque (src + volume no momento do play) para asserções externas
// (tocou/não tocou, com qual asset e volume), sem rede nem som real.
//
// Instalado globalmente via tests/setup.ts; o array é limpo antes de cada
// teste (hook global no setup). Para simular falha de `play()`, o teste
// sobrescreve `falhaDoProximoPlay` / `playLancaExcecao`.

export interface ToqueDeAudioGravado {
  readonly src: string
  readonly volume: number
}

export const toquesDeAudio: ToqueDeAudioGravado[] = []

/** Quando true, o próximo `play()` retorna Promise rejeitada (autoplay bloqueado). */
export let falhaDoProximoPlay = false

/** Quando true, o próximo `play()` lança exceção síncrona. */
export let playLancaExcecao = false

export function limparToquesDeAudio(): void {
  toquesDeAudio.length = 0
  falhaDoProximoPlay = false
  playLancaExcecao = false
}

class AudioMock {
  src: string
  volume = 1

  constructor(src = '') {
    this.src = src
  }

  play(): Promise<void> {
    if (playLancaExcecao) {
      playLancaExcecao = false
      throw new Error('play lançou exceção (mock)')
    }
    toquesDeAudio.push({ src: this.src, volume: this.volume })
    if (falhaDoProximoPlay) {
      falhaDoProximoPlay = false
      return Promise.reject(new Error('play rejeitado (mock)'))
    }
    return Promise.resolve()
  }

  pause(): void {}
}

// Sobrescreve o construtor global (tipos compatíveis em runtime; o mock
// expõe só o subconjunto usado pelo ponto de som: src, volume, play).
globalThis.Audio = AudioMock as unknown as typeof Audio

export function armarFalhaNoProximoPlay(): void {
  falhaDoProximoPlay = true
}

export function armarExcecaoNoProximoPlay(): void {
  playLancaExcecao = true
}
