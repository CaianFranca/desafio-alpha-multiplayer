/**
 * Blip do chat da Partida (issue #389).
 *
 * Som curto sintetizado via WebAudio (oscilador senoidal em rampa rápida) —
 * diferente do som de recusa (#228), que usa asset pré-gravado: o blip não
 * vale um arquivo próprio, nasce no navegador sem rede. Toca SOMENTE quando
 * o painel está fechado e há mensagem nova de terceiro; a coalescência de
 * rajada (um blip por lote) vive no `useChatDaPartida`.
 *
 * Contrato de volume da ADR-0007: `ganho = master * VOLUME_BASE_SOM_DE_BLIP_
 * DO_CHAT`, com master em [0, 1] — hoje 1 (o futuro botão de volume
 * multiplica aqui, sem recostura), mesmo padrão de `somDeRecusa.ts`.
 * Falhas de áudio (autoplay/bloqueios) viram no-op silencioso.
 */

/** Volume base do blip (ADR-0007: `master * VOLUME_BASE`, master padrão 1). */
export const VOLUME_BASE_SOM_DE_BLIP_DO_CHAT = 0.15

/** Frequência do blip (Hz) — tom curto e discreto, abaixo do estridente. */
const FREQUENCIA_DO_BLIP_HZ = 880

/** Duração do envelope do blip (segundos) — curto para não poluir o canal. */
const DURACAO_DO_BLIP_SEGUNDOS = 0.08

// Contexto único por sessão (lazy): criar vários AudioContext por blip
// estoura o limite de contexto do navegador; um só é reutilizado.
let contextoDeAudio: AudioContext | null = null

function obterContextoDeAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (contextoDeAudio === null) {
    try {
      contextoDeAudio = new AudioContext()
    } catch {
      return null
    }
  }
  return contextoDeAudio
}

/**
 * Toca o blip de mensagem nova — no-op silencioso se o WebAudio falhar
 * (autoplay bloqueado, contexto indisponível): o badge segue sendo o canal
 * visual, a Partida nunca quebra por áudio.
 */
export function tocarBlipDoChat(): void {
  try {
    const contexto = obterContextoDeAudio()
    if (contexto === null) return
    // Autoplay bloqueado suspende o contexto na primeira tentativa — sem o
    // resume o blip ficaria mudo para sempre (M2). Guarda defensiva: o stub
    // de teste não tem resume/state.
    if (typeof contexto.resume === 'function' && contexto.state === 'suspended') {
      try {
        void contexto.resume().catch(() => {})
      } catch {
        // Sem áudio desta vez; o badge segue sendo o canal visual.
      }
    }
    const oscilador = contexto.createOscillator()
    const ganho = contexto.createGain()
    oscilador.type = 'sine'
    oscilador.frequency.value = FREQUENCIA_DO_BLIP_HZ
    // Contrato de volume (ADR-0007): base fixa; o futuro botão de volume
    // aplica `ganho = master * VOLUME_BASE_SOM_DE_BLIP_DO_CHAT`.
    ganho.gain.value = 1 * VOLUME_BASE_SOM_DE_BLIP_DO_CHAT
    oscilador.connect(ganho)
    ganho.connect(contexto.destination)
    oscilador.start()
    oscilador.stop(contexto.currentTime + DURACAO_DO_BLIP_SEGUNDOS)
  } catch {
    // Blip silencioso sem quebrar nada.
  }
}