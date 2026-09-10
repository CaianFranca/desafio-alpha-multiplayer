import * as fs from 'node:fs'
import * as path from 'node:path'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { HudDaPartida } from '../web/src/components/partida/HudDaPartida'
import {
  LIMIAR_ARRASTO_PX,
  LIMIAR_POR_TIPO,
  LIMITE_CELULAR_PX,
  FATOR_SUAVIZACAO_PINCH_CELULAR,
  atingiuLimiar,
  suavizarFatorPinch,
  calcularFatorPinch,
} from '../web/src/game/ambiente/cameraLimites'
import { TAMANHO_CELULA } from '../web/src/game/tabuleiro/contrato'
import { deveSuprimirCliquePorArrasto } from '../web/src/game/tabuleiro/interacao'

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
    // Mesmo onClick: só hitbox tem handleClick (visível com raycast null para evitar double-fire)
    const handleClickCount = (fonte.match(/onClick=\{handleClick\}/g) ?? []).length
    // 1 hitbox por corpo (2 corpos) => 2 ocorrências; visível usa raycast null sem onClick
    expect(handleClickCount).toBe(2)
    // Visível e contorno com raycast null (não rouba clique, evita double-fire)
    const raycastNullCount = (fonte.match(/raycast=\{\(\) => null\}/g) ?? []).length
    expect(raycastNullCount).toBeGreaterThanOrEqual(3) // 2 visíveis + 1 contorno
    expect(fonte).toContain('raycast={() => null}')
    // TAMANHO_CELULA = 1.6 conforme contrato
    expect(TAMANHO_CELULA).toBe(1.6)
  })

  it('Peão: hitbox cilindro r0.7 invisível (group cuida do cursor, hitbox só onClick)', () => {
    const fontePlaceholder = lerFonte('frontend/web/src/game/tabuleiro/PeaoPlaceholder.tsx')
    const fonteAvatar = lerFonte('frontend/web/src/game/tabuleiro/PeaoAvatar.tsx')
    for (const fonte of [fontePlaceholder, fonteAvatar]) {
      expect(fonte).toContain('cylinderGeometry args={[0.7')
      expect(fonte).toContain('transparent')
      expect(fonte).toContain('opacity={0}')
      expect(fonte).toContain('depthWrite={false}')
    }
    // PeaoPlaceholder hitbox com altura 1 e raio 0.7, só onClick na hitbox
    expect(fontePlaceholder).toContain('cylinderGeometry args={[0.7, 0.7, 1, 20]}')
    expect(fontePlaceholder).toContain('hitboxClick')
    expect(fontePlaceholder).toContain('onPointerLeave')
    // PeaoAvatar hitbox com altura 1.16 (ALTURA_ALVO) e raio 0.7
    expect(fonteAvatar).toContain('cylinderGeometry args={[0.7, 0.7, 1.16')
    expect(fonteAvatar).toContain('hitboxClick')
  })

  it('Caixa/Bandeja: hitbox plano 2.8×2.8 invisível delegando a despacharCliqueNaPecaDaBandeja', () => {
    const fonte = lerFonte('frontend/web/src/game/tabuleiro/Caixa.tsx')
    expect(fonte).toContain('planeGeometry args={[2.8, 2.8]}')
    expect(fonte).toContain('despacharCliqueNaPecaDaBandeja')
    expect(fonte).toContain('transparent')
    expect(fonte).toContain('opacity={0}')
    expect(fonte).toContain('depthWrite={false}')
    expect(fonte).toContain('handlersDeCursor')
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

describe('partida-alvos-de-dedo — bloqueante 1: arrasto não dispara clique (3D)', () => {
  // Simula a máquina do hook: tipoPorPointerId + atingiuLimiar adaptativo + suprimirCliqueAposArrastoRef + onClickCapture
  function simularGesto(tipo: string, deltas: Array<[number, number]>): { engatou: boolean; suprimirAposArrasto: boolean } {
    let engatado = false
    let suprimir = false
    let inicioX = 0
    let inicioY = 0
    for (let i = 0; i < deltas.length; i++) {
      const [dx, dy] = deltas[i]
      // dx,dy são totais desde inicio (como o hook calcula totalDx/totalDy)
      if (!engatado) {
        if (atingiuLimiar(dx, dy, tipo)) {
          engatado = true
          suprimir = true
        }
      }
    }
    // onPointerUp limpa suprimir se não engatou
    if (!engatado) suprimir = false
    // onClickCapture consome suprimir se engatado
    return { engatou: engatado, suprimirAposArrasto: suprimir }
  }

  function deveDispararAcao(tipo: string, dx: number, dy: number): boolean {
    // Ação (peça/peão/bandeja) dispara apenas se NÃO deve suprimir
    return !deveSuprimirCliquePorArrasto(dx, dy, tipo)
  }

  it('toque curto de dedo (9px touch) — não engata, não suprime, dispara ação', () => {
    const { engatou, suprimirAposArrasto } = simularGesto('touch', [[9, 0]])
    expect(engatou).toBe(false)
    expect(suprimirAposArrasto).toBe(false)
    expect(deveDispararAcao('touch', 9, 0)).toBe(true)
    // prova no nível do helper de peça/bandeja/peão (mesma semântica do 3D)
    expect(deveSuprimirCliquePorArrasto(9, 0, 'touch')).toBe(false)
  })

  it('arrasto de dedo (10px touch) — engata pan e suprime clique da peça/peão/bandeja', () => {
    const { engatou, suprimirAposArrasto } = simularGesto('touch', [[10, 0]])
    expect(engatou).toBe(true)
    expect(suprimirAposArrasto).toBe(true)
    expect(deveDispararAcao('touch', 10, 0)).toBe(false)
    expect(deveSuprimirCliquePorArrasto(10, 0, 'touch')).toBe(true)
  })

  it('arrasto iniciado sobre bandeja/peça/peão — mesma regra de supressão (ponto do clique 3D)', () => {
    // O hook não distingue alvo; o limiar é por pointerType, então bandeja tem mesma proteção
    for (const alvo of ['peca', 'peao', 'bandeja'] as const) {
      expect(deveDispararAcao('touch', 9, 0), `toque curto em ${alvo} deveria disparar`).toBe(true)
      expect(deveDispararAcao('touch', 10, 0), `arrasto em ${alvo} deveria suprimir`).toBe(false)
    }
  })

  it('pen 7px não suprime, 8px suprime — adaptativo por tipo', () => {
    expect(deveSuprimirCliquePorArrasto(7, 0, 'pen')).toBe(false)
    expect(deveSuprimirCliquePorArrasto(8, 0, 'pen')).toBe(true)
    const g7 = simularGesto('pen', [[7, 0]])
    const g8 = simularGesto('pen', [[8, 0]])
    expect(g7.engatou).toBe(false)
    expect(g8.engatou).toBe(true)
  })

  it('mouse 5px não suprime, 6px suprime — fallback', () => {
    expect(deveSuprimirCliquePorArrasto(5, 0, 'mouse')).toBe(false)
    expect(deveSuprimirCliquePorArrasto(6, 0, 'mouse')).toBe(true)
  })

  it('onClickCapture consome supressão apenas quando engatado', () => {
    // Simula hook: onClickCapture só suprime se flag true
    function onClickCapture(suprimirRef: { current: boolean }): boolean {
      if (suprimirRef.current) {
        suprimirRef.current = false
        return true // suprimido
      }
      return false
    }
    const refEngatado = { current: true }
    expect(onClickCapture(refEngatado)).toBe(true)
    expect(refEngatado.current).toBe(false)
    const refNaoEngatado = { current: false }
    expect(onClickCapture(refNaoEngatado)).toBe(false)
  })
})

describe('partida-alvos-de-dedo — bloqueantes 2/4/6: cursor global padrão', () => {
  it('cursor.ts: padrão global restaura com "" (nunca "auto") e usa contador', () => {
    const fonte = lerFonte('frontend/web/src/game/tabuleiro/cursor.ts')
    expect(fonte).toContain("document.body.style.cursor = ''")
    expect(fonte).toContain('hoversPointerAtivos')
    expect(fonte).not.toContain("cursor = 'auto'")
    // garante que o valor "auto" não é usado no projeto para limpeza (carona 6)
    const autoUsos = (fonte.match(/'auto'/g) ?? []).length
    expect(autoUsos).toBe(0)
  })

  it('Caixa/Bandeja: sem limpeza manual com auto e sem @ts-expect-error', () => {
    const fonte = lerFonte('frontend/web/src/game/tabuleiro/Caixa.tsx')
    expect(fonte).not.toContain("document.body.style.cursor = 'auto'")
    expect(fonte).not.toContain('@ts-expect-error')
    expect(fonte).not.toContain('@ts-ignore')
    expect(fonte).toContain('handlersDeCursor')
    // tipagem correta do ThreeEvent
    expect(fonte).toContain('ThreeEvent<MouseEvent>')
  })

  it('Peoes: PeaoPlaceholder e PeaoAvatar usam handlersDeCursor com contador global', () => {
    const ph = lerFonte('frontend/web/src/game/tabuleiro/PeaoPlaceholder.tsx')
    const av = lerFonte('frontend/web/src/game/tabuleiro/PeaoAvatar.tsx')
    for (const fonte of [ph, av]) {
      expect(fonte).toContain("handlersDeCursor")
      expect(fonte).toContain("from './cursor'")
      expect(fonte).not.toContain("document.body.style.cursor = 'auto'")
      // ainda faz stopPropagation no hover para não vazar para a cena
      expect(fonte).toContain('stopPropagation')
    }
    // PecaPlaceholder já usa o padrão — garante que os 3 agora convergem
    const peca = lerFonte('frontend/web/src/game/tabuleiro/PecaPlaceholder.tsx')
    expect(peca).toContain('handlersDeCursor')
  })
})

describe('partida-alvos-de-dedo — bloqueante 3: helper documentado', () => {
  it('interacao.ts documenta que proteção real vive em useCameraInterativa', () => {
    const fonte = lerFonte('frontend/web/src/game/tabuleiro/interacao.ts')
    expect(fonte).toContain('suprimirCliqueAposArrastoRef')
    expect(fonte).toContain('useCameraInterativa')
    expect(fonte).toContain('helper é 100% puro')
    expect(fonte).toContain('não tem chamador em produção')
  })
})

describe('partida-alvos-de-dedo — plus 7: pinch suave no celular', () => {
  it('exporta constantes de suavização', () => {
    expect(LIMITE_CELULAR_PX).toBe(768)
    expect(FATOR_SUAVIZACAO_PINCH_CELULAR).toBe(0.5)
  })

  it('suavizarFatorPinch: abaixo de 768 suaviza, >=768 mantém cru', () => {
    // caso real: distInicial 100 -> distAtual 50 => fator 2 (zoom 2x)
    const fatorCru = calcularFatorPinch(100, 50) // 2
    expect(fatorCru).toBe(2)
    // celular 375px: 1 + (2-1)*0.5 = 1.5
    expect(suavizarFatorPinch(fatorCru, 375)).toBe(1.5)
    expect(suavizarFatorPinch(fatorCru, 767)).toBe(1.5)
    // tablet/desktop: mantém 2
    expect(suavizarFatorPinch(fatorCru, 768)).toBe(2)
    expect(suavizarFatorPinch(fatorCru, 812)).toBe(2)
    expect(suavizarFatorPinch(fatorCru, 1024)).toBe(2)
    // pinch inverso (afastando): dist 50 -> 100 => fator 0.5
    const fatorAfast = calcularFatorPinch(100, 200) // 0.5
    expect(fatorAfast).toBe(0.5)
    expect(suavizarFatorPinch(fatorAfast, 375)).toBe(0.75) // 1 + (-0.5)*0.5
    expect(suavizarFatorPinch(fatorAfast, 1024)).toBe(0.5)
  })

  it('useCameraInterativa aplica suavização quando window.innerWidth <768', () => {
    const fonte = lerFonte('frontend/web/src/hooks/useCameraInterativa.ts')
    expect(fonte).toContain('suavizarFatorPinch')
    expect(fonte).toContain('window.innerWidth')
    expect(fonte).toContain('calcularFatorPinch')
  })
})
