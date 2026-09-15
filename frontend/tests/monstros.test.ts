/**
 * Modelos 3D das peças de Monstro (vulto/espectro).
 *
 * Só comportamento externo observável do seam puro: vulto e espectro têm
 * modelo (demais tipos seguem só a base), as URLs resolvem GLBs distintos
 * sob `assets/3d-models/` e os arquivos estão commitados e parseáveis.
 * Nada de three.js/DOM — jsdom-safe.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MODELOS_DE_MONSTRO,
  temModeloDeMonstro,
  urlDoModeloDeMonstro,
} from '../web/src/game/tabuleiro/monstros'

describe('modelos 3D dos monstros (vulto/espectro)', () => {
  it('só Monstros têm modelo; demais tipos seguem só a base', () => {
    expect(temModeloDeMonstro('vulto')).toBe(true)
    expect(temModeloDeMonstro('espectro')).toBe(true)
    for (const tipo of [
      'inicial',
      'reta',
      'T',
      'cruz',
      'gerador',
      'sala_do_diretor',
      'sala_medica',
      'portao_de_saida',
    ] as const) {
      expect(temModeloDeMonstro(tipo)).toBe(false)
    }
  })

  it('URLs distintas sob assets/3d-models/*.glb', () => {
    expect(Object.keys(MODELOS_DE_MONSTRO).sort()).toEqual([
      'espectro',
      'vulto',
    ])
    for (const tipo of ['vulto', 'espectro'] as const) {
      const url = urlDoModeloDeMonstro(tipo)
      expect(url).toBe(MODELOS_DE_MONSTRO[tipo])
      expect(url).toContain('assets/3d-models/')
      expect(url.endsWith('.glb')).toBe(true)
    }
    expect(MODELOS_DE_MONSTRO.vulto).toContain('vulto.glb')
    expect(MODELOS_DE_MONSTRO.espectro).toContain('espectro.glb')
    expect(MODELOS_DE_MONSTRO.vulto).not.toBe(MODELOS_DE_MONSTRO.espectro)
  })

  it('GLBs commitados e parseáveis (vulto + espectro)', () => {
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
    for (const relativo of [
      'web/public/assets/3d-models/vulto.glb',
      'web/public/assets/3d-models/espectro.glb',
    ]) {
      const bytes = readFileSync(join(raiz, relativo))
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('glTF')
      const tamanhoJson = bytes.readUInt32LE(12)
      const glb = JSON.parse(bytes.subarray(20, 20 + tamanhoJson).toString('utf-8'))
      expect(glb.materials.length).toBeGreaterThan(0)
    }
  })
})
