import {
  CAMINHO_SOM_DE_AVISO_DO_TURNO,
  VOLUME_BASE_SOM_DE_AVISO_DO_TURNO,
  tocarSomDeAvisoDoTurno,
} from '../web/src/components/partida/somDoAvisoDoTurno'
import { VOLUME_BASE_SOM_DE_RECUSA } from '../web/src/components/partida/somDeRecusa'
import {
  armarExcecaoNoProximoPlay,
  armarFalhaNoProximoPlay,
  toquesDeAudio,
} from './helpers/mockAudio'

// Ponto de som do aviso de tempo de turno (issue #430): comportamento
// externo — tocou com qual asset e volume, e silêncio em falha. Áudio
// mockado globalmente (tests/helpers/mockAudio.ts). A unicidade por turno
// (one-shot) vem do evento TURNO_AVISO_30S no servidor — aqui só o contrato
// do ponto (asset + volume + catch silencioso), no padrão do som de recusa.

describe('som de aviso do turno — contrato (issue #430)', () => {
  it('toca o asset de 3 bipes com volume base abaixo dos efeitos de erro', () => {
    tocarSomDeAvisoDoTurno()

    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]!.src).toBe(CAMINHO_SOM_DE_AVISO_DO_TURNO)
    expect(toquesDeAudio[0]!.src).toContain('aviso-turno')
    expect(toquesDeAudio[0]!.volume).toBe(VOLUME_BASE_SOM_DE_AVISO_DO_TURNO)
    // Informativo, não punitivo: abaixo do THUD de recusa (ADR-0007).
    expect(VOLUME_BASE_SOM_DE_AVISO_DO_TURNO).toBeLessThan(VOLUME_BASE_SOM_DE_RECUSA)
  })

  it('falha de play() não quebra (aviso silencioso)', async () => {
    armarFalhaNoProximoPlay()
    expect(() => tocarSomDeAvisoDoTurno()).not.toThrow()
    expect(toquesDeAudio).toHaveLength(1)
    // Unhandled rejections quebrariam a suíte — dá um giro ao event loop.
    await Promise.resolve()

    armarExcecaoNoProximoPlay()
    expect(() => tocarSomDeAvisoDoTurno()).not.toThrow()
  })
})
