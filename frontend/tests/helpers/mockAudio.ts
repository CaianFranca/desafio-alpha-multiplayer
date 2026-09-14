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
  registrosDeBlipDoChat.length = 0
  falhaDoProximoPlay = false
  playLancaExcecao = false
}

// Blip do chat da Partida (issue #389): `tocarBlipDoChat` sintetiza via
// WebAudio (`new AudioContext()` + oscilador + GainNode) — jsdom não tem
// AudioContext. O stub abaixo grava cada blip (ganho do GainNode no instante
// do start + frequência) para asserções do contrato de volume (ADR-0007:
// ganho = master * VOLUME_BASE, master padrão 1) e da coalescência de rajada.

export interface BlipDeChatGravado {
  readonly ganho: number
  readonly frequencia: number
}

export const registrosDeBlipDoChat: BlipDeChatGravado[] = []

class OsciladorDoAudioMock {
  type = 'sine'
  frequency = { value: 0 }
  private ganhoConectado: GainNodeDoAudioMock | null = null

  connect(alvo: GainNodeDoAudioMock): void {
    this.ganhoConectado = alvo
  }

  start(): void {
    registrosDeBlipDoChat.push({
      ganho: this.ganhoConectado?.gain.value ?? 0,
      frequencia: this.frequency.value,
    })
  }

  stop(): void {}
}

class GainNodeDoAudioMock {
  gain = { value: 0 }
  connect(): void {}
}

class AudioContextMock {
  currentTime = 0
  destination = {}

  createOscillator(): OsciladorDoAudioMock {
    return new OsciladorDoAudioMock()
  }

  createGain(): GainNodeDoAudioMock {
    return new GainNodeDoAudioMock()
  }
}

// Sobrescreve o construtor global (jsdom não define AudioContext); o ponto
// de som captura falhas e segue sem áudio se o stub não existir.
globalThis.AudioContext = AudioContextMock as unknown as typeof AudioContext

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
