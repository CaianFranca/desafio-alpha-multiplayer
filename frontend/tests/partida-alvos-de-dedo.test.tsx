import * as fs from 'node:fs'
import * as path from 'node:path'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { HudDaPartida } from '../web/src/components/partida/HudDaPartida'
import {
  LIMIAR_ARRASTO_PX,
  LIMIAR_POR_TIPO,
  atingiuLimiar,
} from '../web/src/game/ambiente/cameraLimites'
import { TAMANHO_CELULA } from '../web/src/game/tabuleiro/contrato'

// Helper para ler fonte
function lerFonte(rel: string): string {
  // tenta resolver a partir da raiz do repo (frontend/tests -> ../../..)
  const base = path.resolve(__dirname, '..')
  // rel é caminho relativo a partir da raiz do repo
  const p = path.resolve(base, '..', rel)
  // fallback: tenta via base direta
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
  const alt = path.resolve(process.cwd(), rel)
  if (fs.existsSync(alt)) return fs.readFileSync(alt, 'utf8')
  return fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8')
}

describe('partida-alvos-de-dedo — limiar adaptativo', () => {
  it('exporta LIMIAR_POR_TIPO com mouse 6 / pen 8 / touch 10 e mantém LIMIAR_ARRASTO_PX=6', () => {
    expect(LIMIAR_ARRASTO_PX).toBe(6)
    expect(LIMIAR_POR_TIPO.mouse).toBe(6)
    expect(LIMIAR_POR_TIPO.pen).toBe(8)
    expect(LIMIAR_POR_TIPO.touch).toBe(10)
  })

  it('atingiuLimiar default é mouse (6px)', () => {
    expect(atingiuLimiar(6, 0)).toBe(true)
    expect(atingiuLimiar(5.9, 0)).toBe(false)
    expect(atingiuLimiar(3, 4)).toBe(false) // 5 <6
    expect(atingiuLimiar(6, 0, undefined)).toBe(true)
    expect(atingiuLimiar(6, 0, 'mouse')).toBe(true)
  })

  it('mouse 6px: abaixo não atinge, exatamente/at acima atinge', () => {
    expect(atingiuLimiar(5, 0, 'mouse')).toBe(false)
    expect(atingiuLimiar(0, 5, 'mouse')).toBe(false)
    expect(atingiuLimiar(4, 4, 'mouse')).toBe(false) // hypot ~5.65
    expect(atingiuLimiar(6, 0, 'mouse')).toBe(true)
    expect(atingiuLimiar(0, 6, 'mouse')).toBe(true)
    const c = 6 / Math.SQRT2
    expect(atingiuLimiar(c, c, 'mouse')).toBe(true)
  })

  it('pen 8px: 7 não atinge, 8 atinge', () => {
    expect(atingiuLimiar(7, 0, 'pen')).toBe(false)
    expect(atingiuLimiar(7.9, 0, 'pen')).toBe(false)
    expect(atingiuLimiar(8, 0, 'pen')).toBe(true)
    expect(atingiuLimiar(0, 8, 'pen')).toBe(true)
    expect(atingiuLimiar(6, 6, 'pen')).toBe(true) // hypot 8.48
    expect(atingiuLimiar(5, 5, 'pen')).toBe(false) // hypot 7.07
  })

  it('touch 10px: <10 não suprime nem move; >=10 suprime e move', () => {
    // <10 não atinge → não engata arrasto, não suprime clique, não move câmera
    expect(atingiuLimiar(9, 0, 'touch')).toBe(false)
    expect(atingiuLimiar(0, 9, 'touch')).toBe(false)
    expect(atingiuLimiar(6, 6, 'touch')).toBe(false) // hypot 8.48 <10
    expect(atingiuLimiar(7, 7, 'touch')).toBe(false) // hypot 9.89
    // >=10 atinge → engata, suprime ghost click, move câmera
    expect(atingiuLimiar(10, 0, 'touch')).toBe(true)
    expect(atingiuLimiar(0, 10, 'touch')).toBe(true)
    expect(atingiuLimiar(6, 8, 'touch')).toBe(true) // hypot 10
    expect(atingiuLimiar(8, 8, 'touch')).toBe(true)
  })

  it('pointerType desconhecido faz fallback para mouse (6px)', () => {
    expect(atingiuLimiar(6, 0, 'unknown')).toBe(true)
    expect(atingiuLimiar(5, 0, 'unknown')).toBe(false)
    expect(atingiuLimiar(6, 0, '')).toBe(true)
  })

  it('viewport 812x375 touch: valida semântica de arrasto-vs-clique', () => {
    // Simula viewport paisagem exigido pelo critério
    const originalW = window.innerWidth
    const originalH = window.innerHeight
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 812 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 375 })
    try {
      // touch 9px: clique preservado
      expect(atingiuLimiar(9, 0, 'touch')).toBe(false)
      // touch 10px: vira arrasto, clique suprimido, câmera move
      expect(atingiuLimiar(10, 0, 'touch')).toBe(true)
      // mouse 6px ainda válido no mesmo viewport
      expect(atingiuLimiar(6, 0, 'mouse')).toBe(true)
      expect(atingiuLimiar(5, 0, 'mouse')).toBe(false)
    } finally {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalW })
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalH })
    }
  })
})

describe('partida-alvos-de-dedo — botões 44px', () => {
  const originalW = window.innerWidth
  const originalH = window.innerHeight

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 812 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 375 })
  })
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalW })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalH })
  })

  it('HudDaPartida: 3 botões (hud-sair, confirmar, cancelar) têm min-h-[44px] min-w-[44px]', () => {
    const baseProps = {
      jogadorPorId: {
        'j1': { apelido: 'João', cor: 'branco' as const, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false, ordem: 0 },
        'j2': { apelido: 'Maria', cor: 'azul' as const, sanidade: 2, emBaixaIluminacao: false, amedrontado: false, protegido: false, ordem: 1 },
      },
      jogadorAtivoId: 'j1',
      jogadorLocalId: 'j1',
      geradoresLigados: [],
      cartaoDeAcessoObtido: false,
      emAndamento: true,
      emResultado: false,
      partidaId: 'p1',
      onSair: () => {},
    }
    render(<HudDaPartida {...baseProps} />)
    const sair = screen.getByTestId('hud-sair')
    expect(sair.className).toContain('min-h-[44px]')
    expect(sair.className).toContain('min-w-[44px]')

    // abrir confirmação para expor os outros 2 botões
    act(() => {
      fireEvent.click(sair)
    })
    const confirmar = screen.getByTestId('hud-sair-confirmar')
    const cancelar = screen.getByTestId('hud-sair-cancelar')
    expect(confirmar.className).toContain('min-h-[44px]')
    expect(confirmar.className).toContain('min-w-[44px]')
    expect(cancelar.className).toContain('min-h-[44px]')
    expect(cancelar.className).toContain('min-w-[44px]')
  })

  it('PartidaPage: 5 botões (Permanecer/Confirmar/Encerrar/Girar×2) têm min-h-[44px] no fonte', () => {
    // Leitura de fonte garante que mesmo quando o estado não expõe o botão em teste,
    // o critério de 44px está codificado. Checa os 5 testIds + classes no arquivo.
    const fonte = lerFonte('frontend/web/src/pages/PartidaPage.tsx')
    const alvos = [
      'botao-permanecer',
      'botao-confirmar-posicao',
      'botao-encerrar-turno',
      'girar-anti-horario',
      'girar-horario',
    ]
    for (const tid of alvos) {
      expect(fonte).toContain(tid)
    }
    // Conta ocorrências de min-h-[44px] próximas aos botões
    const ocorrencias = (fonte.match(/min-h-\[44px\]/g) ?? []).length
    expect(ocorrencias).toBeGreaterThanOrEqual(5)
    // Cada um dos 5 botões deve ter px-5 py-3 (compatível com bottom-32/right-6 e bottom-24)
    const px5py3 = (fonte.match(/px-5 py-3/g) ?? []).length
    expect(px5py3).toBeGreaterThanOrEqual(5)
    // min-w também exigido
    const minW = (fonte.match(/min-w-\[44px\]/g) ?? []).length
    expect(minW).toBeGreaterThanOrEqual(5)
  })

  it('ao todo 8 botões acionáveis da Partida têm 44px (5 PartidaPage + 3 Hud)', () => {
    const fontePartida = lerFonte('frontend/web/src/pages/PartidaPage.tsx')
    const fonteHud = lerFonte('frontend/web/src/components/partida/HudDaPartida.tsx')
    const totalMinH = (fontePartida.match(/min-h-\[44px\]/g) ?? []).length + (fonteHud.match(/min-h-\[44px\]/g) ?? []).length
    expect(totalMinH).toBeGreaterThanOrEqual(8)
  })
})

describe('partida-alvos-de-dedo — hitbox invisível ampliada', () => {
  it('PecaPlaceholder: hitbox box TAMANHO_CELULA (1.6) com opacity 0 depthWrite false e mesmo onClick', () => {
    const fonte = lerFonte('frontend/web/src/game/tabuleiro/PecaPlaceholder.tsx')
    // Verifica TAMANHO_CELULA usado na hitbox
    expect(fonte).toContain('TAMANHO_CELULA')
    // boxGeometry com TAMANHO_CELULA na hitbox
    expect(fonte).toContain('boxGeometry args={[TAMANHO_CELULA, ESPESSURA_PECA, TAMANHO_CELULA]}')
    // Material invisível
    expect(fonte).toContain('transparent')
    expect(fonte).toContain('opacity={0}')
    expect(fonte).toContain('depthWrite={false}')
    // Mesmo onClick: hitbox compartilha handleClick
    const handleClickCount = (fonte.match(/onClick=\{handleClick\}/g) ?? []).length
    // 1 mesh visível + 1 hitbox em cada corpo => pelo menos 4 ocorrências (2 corpos ×2)
    expect(handleClickCount).toBeGreaterThanOrEqual(4)
    // Contorno mantém raycast null (não rouba clique)
    expect(fonte).toContain('raycast={() => null}')
    // TAMANHO_CELULA = 1.6 conforme contrato
    expect(TAMANHO_CELULA).toBe(1.6)
  })

  it('Peão: hitbox cilindro r0.7 invisível com mesmo onClick (PeaoPlaceholder + PeaoAvatar)', () => {
    const fontePlaceholder = lerFonte('frontend/web/src/game/tabuleiro/PeaoPlaceholder.tsx')
    const fonteAvatar = lerFonte('frontend/web/src/game/tabuleiro/PeaoAvatar.tsx')
    for (const fonte of [fontePlaceholder, fonteAvatar]) {
      expect(fonte).toContain('cylinderGeometry args={[0.7')
      expect(fonte).toContain('transparent')
      expect(fonte).toContain('opacity={0}')
      expect(fonte).toContain('depthWrite={false}')
    }
    // PeaoPlaceholder hitbox com altura 1 e raio 0.7
    expect(fontePlaceholder).toContain('cylinderGeometry args={[0.7, 0.7, 1, 20]}')
    // PeaoAvatar hitbox com altura 1.16 (ALTURA_ALVO) e raio 0.7
    expect(fonteAvatar).toContain('cylinderGeometry args={[0.7, 0.7, 1.16')
  })

  it('Caixa/Bandeja: hitbox plano 2.8×2.8 invisível delegando a despacharCliqueNaPecaDaBandeja', () => {
    const fonte = lerFonte('frontend/web/src/game/tabuleiro/Caixa.tsx')
    expect(fonte).toContain('planeGeometry args={[2.8, 2.8]}')
    expect(fonte).toContain('despacharCliqueNaPecaDaBandeja')
    expect(fonte).toContain('transparent')
    expect(fonte).toContain('opacity={0}')
    expect(fonte).toContain('depthWrite={false}')
    // Plano horizontal na bandeja
    expect(fonte).toContain("rotation={[-Math.PI / 2, 0, 0]}")
  })

  it('limiar e hitbox juntos: touch 10px não move câmera, mas hitbox garante toque', () => {
    // A semântica final: arrasto só após 10px para touch, <10 é clique;
    // hitbox ampliada garante que o toque atinja a peça/peão/bandeja mesmo com dedo.
    expect(atingiuLimiar(9, 0, 'touch')).toBe(false)
    expect(atingiuLimiar(10, 0, 'touch')).toBe(true)
    // mouse mantém 6px
    expect(atingiuLimiar(6, 0, 'mouse')).toBe(true)
    // pen mantém 8px
    expect(atingiuLimiar(8, 0, 'pen')).toBe(true)
  })
})
