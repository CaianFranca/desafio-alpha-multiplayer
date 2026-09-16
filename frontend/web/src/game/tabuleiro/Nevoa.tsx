import { useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import {
  COR_NEVOA,
  MANCHAS_DA_NEVOA,
  MEIO_BURACO_NEVOA,
} from './nevoaDaMesa'

/**
 * PRNG com semente fixa: o desenho da névoa é estável entre reloads (mesma
 * Mesa toda vez) — e segue puro/testável fora do componente.
 */
function mulberry32(semente: number): () => number {
  let estado = semente
  return () => {
    estado |= 0
    estado = (estado + 0x6d2b79f5) | 0
    let resto = Math.imul(estado ^ (estado >>> 15), 1 | estado)
    resto = (resto + Math.imul(resto ^ (resto >>> 7), 61 | resto)) ^ resto
    return ((resto ^ (resto >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Máscara da névoa (luminância: branco = névoa, preto = limpo): ~60 manchas
 * suaves espalhadas (+ buraco quadrado com pena sobre o tabuleiro, só no
 * topo). O `alphaMap` lê o canal verde — por isso o desenho é em
 * branco-sobre-preto, não em alfa. A mancha é relativa (cobre a pegada
 * inteira), então serve a qualquer tamanho de lâmina.
 */
function gerarMascaraDaNevoa(comBuraco: boolean): HTMLCanvasElement {
  const LADO = 512
  const aleatorio = mulberry32(comBuraco ? 7 : 21)
  const manchas = document.createElement('canvas')
  manchas.width = LADO
  manchas.height = LADO
  const base = manchas.getContext('2d')
  if (base === null) throw new Error('Canvas 2D indisponível para a névoa')
  base.fillStyle = '#000'
  base.fillRect(0, 0, LADO, LADO)
  for (let i = 0; i < 60; i++) {
    const x = aleatorio() * LADO
    const y = aleatorio() * LADO
    const raio = 30 + aleatorio() * 90
    const brilho = 0.05 + aleatorio() * 0.11
    const mancha = base.createRadialGradient(x, y, 0, x, y, raio)
    mancha.addColorStop(0, `rgba(255,255,255,${brilho.toFixed(3)})`)
    mancha.addColorStop(1, 'rgba(255,255,255,0)')
    base.fillStyle = mancha
    base.beginPath()
    base.arc(x, y, raio, 0, Math.PI * 2)
    base.fill()
  }

  if (comBuraco) {
    // Máscara: branca em tudo, buraco preto com pena sobre o tabuleiro
    // (buraco em fração da lâmina: 6.2u sobre 19u de lado).
    const mascara = document.createElement('canvas')
    mascara.width = LADO
    mascara.height = LADO
    const tinta = mascara.getContext('2d')
    if (tinta === null) throw new Error('Canvas 2D indisponível para a névoa')
    tinta.fillStyle = '#fff'
    tinta.fillRect(0, 0, LADO, LADO)
    const meioBuracoPx = (MEIO_BURACO_NEVOA / 19) * LADO
    // Pena larga no buraco: a transição limpo→névoa ao redor do tabuleiro
    // também lia como anel.
    tinta.filter = 'blur(60px)'
    tinta.fillStyle = '#000'
    tinta.fillRect(
      LADO / 2 - meioBuracoPx,
      LADO / 2 - meioBuracoPx,
      meioBuracoPx * 2,
      meioBuracoPx * 2,
    )
    tinta.filter = 'none'
    // destination-in: mantém as manchas onde a máscara é branca.
    base.globalCompositeOperation = 'destination-in'
    base.drawImage(mascara, 0, 0)
    base.globalCompositeOperation = 'source-over'
  }

  // Feather das bordas do plano: a máscara dissolve nas 4 bordas numa
  // zona larga (40%) com curva suave — a névoa vai sumindo nas extremidades
  // em vez de terminar. Sem isso a quina do quad aparece como linha onde a
  // névoa encontra o vazio.
  const margem = Math.round(LADO * 0.4)
  const borda = document.createElement('canvas')
  borda.width = LADO
  borda.height = LADO
  const dissolve = borda.getContext('2d')
  if (dissolve === null) throw new Error('Canvas 2D indisponível para a névoa')
  dissolve.fillStyle = '#fff'
  dissolve.fillRect(0, 0, LADO, LADO)
  dissolve.globalCompositeOperation = 'destination-out'
  const faixas: ReadonlyArray<readonly [number, number, number, number, number, number, number, number]> = [
    // x0, y0, x1, y1 (gradiente), x, y, w, h (faixa)
    [0, 0, margem, 0, 0, 0, margem, LADO],
    [LADO, 0, LADO - margem, 0, LADO - margem, 0, margem, LADO],
    [0, 0, 0, margem, 0, 0, LADO, margem],
    [0, LADO, 0, LADO - margem, 0, LADO - margem, LADO, margem],
  ]
  for (const [x0, y0, x1, y1, x, y, w, h] of faixas) {
    // Curva suave (aproxima smoothstep): derrete em vez de cair linear.
    const degradê = dissolve.createLinearGradient(x0, y0, x1, y1)
    degradê.addColorStop(0, 'rgba(0,0,0,1)')
    degradê.addColorStop(0.45, 'rgba(0,0,0,0.7)')
    degradê.addColorStop(0.75, 'rgba(0,0,0,0.25)')
    degradê.addColorStop(1, 'rgba(0,0,0,0)')
    dissolve.fillStyle = degradê
    dissolve.fillRect(x, y, w, h)
  }
  dissolve.globalCompositeOperation = 'source-over'
  base.globalCompositeOperation = 'destination-in'
  base.drawImage(borda, 0, 0)
  base.globalCompositeOperation = 'source-over'
  return manchas
}

/**
 * Névoa da Mesa: pouca sobre o tampo (quadriculado legível) e densa ao
 * redor, abraçando a borda. Material iluminado (`Standard`) para a névoa
 * pegar o calor das chamas como na referência — sem sombra projetada nem
 * recebida (volume de ar, não superfície) e sem raycast (o clique cai na
 * Mesa/vazio e desseleciona, como antes). Estática: compatível com
 * `frameloop="demand"`.
 */
export function NevoaDaMesa() {
  const mapaComBuraco = useMemo(() => {
    const textura = new THREE.CanvasTexture(gerarMascaraDaNevoa(true))
    textura.colorSpace = THREE.NoColorSpace
    return textura
  }, [])
  const mapaCheio = useMemo(() => {
    const textura = new THREE.CanvasTexture(gerarMascaraDaNevoa(false))
    textura.colorSpace = THREE.NoColorSpace
    return textura
  }, [])

  useLayoutEffect(() => {
    return () => {
      mapaComBuraco.dispose()
      mapaCheio.dispose()
    }
  }, [mapaComBuraco, mapaCheio])

  return (
    <group>
      {MANCHAS_DA_NEVOA.map((mancha, indice) => (
        <mesh
          key={indice}
          position={[mancha.centro[0], mancha.y, mancha.centro[1]]}
          rotation={[-Math.PI / 2, 0, mancha.giro]}
          renderOrder={10 + indice}
          raycast={() => null}
        >
          <planeGeometry args={[mancha.largura, mancha.profundidade]} />
          <meshStandardMaterial
            color={COR_NEVOA}
            transparent
            opacity={mancha.opacidade}
            alphaMap={mancha.comBuraco ? mapaComBuraco : mapaCheio}
            roughness={1}
            metalness={0}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}
