/* eslint-disable react-hooks/immutability */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  LIMIAR_ARRASTO_PX,
  atingiuLimiar,
  panDeltaToWorld,
  clampAlvo,
  calcularDistanciaMin,
  calcularDistanciaMax,
  clampDistancia,
} from '../../game/ambiente/cameraLimites'
import { FOV_CAMERA, LARGURA_MESA, PROFUNDIDADE_MESA } from '../../game/ambiente/contrato'

const SENSIBILIDADE_WHEEL = 0.002

function aspectoAtual(size: { width: number; height: number }): number {
  if (size.width > 0 && size.height > 0) return size.width / size.height
  if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
    return window.innerWidth / window.innerHeight
  }
  return 1
}

function alturaClientHeight(size: { width: number; height: number }, gl: THREE.WebGLRenderer): number {
  if (size.height > 0) return size.height
  const h = gl.domElement.clientHeight
  if (h > 0) return h
  if (typeof window !== 'undefined' && window.innerHeight > 0) return window.innerHeight
  return 1
}

export function useCameraInterativa(): void {
  const { camera, gl, size, invalidate } = useThree()

  const alvoRef = useRef({ x: 0, z: 0 })
  const distanciaRef = useRef(calcularDistanciaMin(LARGURA_MESA, PROFUNDIDADE_MESA, FOV_CAMERA))
  const didPanRef = useRef(false)

  // estado de arrasto
  const dragRef = useRef({
    ativo: false,
    pointerId: null as number | null,
    inicioX: 0,
    inicioY: 0,
    ultimoX: 0,
    ultimoY: 0,
    arrastou: false,
  })

  // estado de pinça
  const pinchRef = useRef<{
    ativo: boolean
    distInicial: number
    distanciaInicial: number
    centroInicial: { x: number; z: number } | null
  }>({ ativo: false, distInicial: 0, distanciaInicial: 0, centroInicial: null })

  const ponteirosRef = useRef<Map<number, { x: number; y: number }>>(new Map())

  // Aplicar pose da câmera a cada frame (demand precisa de invalidate)
  useFrame(() => {
    const persp = camera as THREE.PerspectiveCamera
    const aspect = aspectoAtual(size)
    if (persp.isPerspectiveCamera) {
      if (Math.abs(persp.aspect - aspect) > 1e-4) {
        persp.aspect = aspect
        persp.updateProjectionMatrix()
      }
      if (Math.abs(persp.fov - FOV_CAMERA) > 1e-4) {
        persp.fov = FOV_CAMERA
        persp.updateProjectionMatrix()
      }
    }
    const alvo = alvoRef.current
    const dist = distanciaRef.current
    const componente = dist / Math.SQRT2
    // Inclinação 45°: altura == distância horizontal; offset [0, c, c]
    persp.position.set(alvo.x, componente, alvo.z + componente)
    persp.lookAt(alvo.x, 0, alvo.z)
  })

  useEffect(() => {
    const canvas = gl.domElement
    const alvoEl = (canvas.parentElement ?? canvas) as HTMLElement

    // garantir que o container permita gesto sem scroll nativo
    const prevTouchAction = alvoEl.style.touchAction
    alvoEl.style.touchAction = 'none'

    const distanciaMin = calcularDistanciaMin(LARGURA_MESA, PROFUNDIDADE_MESA, FOV_CAMERA)
    const distanciaMaxTeorica = calcularDistanciaMax(distanciaMin)

    function aplicarZoom(novaDistancia: number): void {
      const clamped = clampDistancia(novaDistancia, distanciaMin, distanciaMaxTeorica)
      if (clamped === distanciaRef.current) return
      distanciaRef.current = clamped
      // re-clamp do alvo para não ficar fora após zoom-out
      const aspect = aspectoAtual(size)
      alvoRef.current = clampAlvo(alvoRef.current, clamped, FOV_CAMERA, aspect, LARGURA_MESA, PROFUNDIDADE_MESA)
      invalidate()
    }

    function onPointerDown(e: PointerEvent): void {
      ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      // Pinça com 2 ponteiros
      if (ponteirosRef.current.size === 2) {
        const pts = Array.from(ponteirosRef.current.values())
        const dx = pts[0].x - pts[1].x
        const dy = pts[0].y - pts[1].y
        const d = Math.hypot(dx, dy)
        pinchRef.current = {
          ativo: true,
          distInicial: d > 0 ? d : 1,
          distanciaInicial: distanciaRef.current,
          centroInicial: { ...alvoRef.current },
        }
        // cancelar arrasto simples
        dragRef.current.ativo = false
        dragRef.current.arrastou = false
        try {
          alvoEl.setPointerCapture(e.pointerId)
        } catch {
          // ignore
        }
        return
      }

      if (ponteirosRef.current.size > 2) return

      // um ponteiro: inicia arrasto
      dragRef.current.ativo = true
      dragRef.current.pointerId = e.pointerId
      dragRef.current.inicioX = e.clientX
      dragRef.current.inicioY = e.clientY
      dragRef.current.ultimoX = e.clientX
      dragRef.current.ultimoY = e.clientY
      dragRef.current.arrastou = false
      try {
        alvoEl.setPointerCapture(e.pointerId)
      } catch {
        // ignore se não suportado
      }
    }

    function onPointerMove(e: PointerEvent): void {
      if (!ponteirosRef.current.has(e.pointerId)) return
      ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      // Pinça ativa
      if (ponteirosRef.current.size === 2 && pinchRef.current.ativo) {
        const pts = Array.from(ponteirosRef.current.values())
        const dx = pts[0].x - pts[1].x
        const dy = pts[0].y - pts[1].y
        const distAtual = Math.hypot(dx, dy) || 1

        // zoom centrado: distância inversamente proporcional ao afastamento dos dedos
        const fator = pinchRef.current.distInicial / distAtual
        const novaDist = pinchRef.current.distanciaInicial * fator
        const clamped = clampDistancia(novaDist, distanciaMin, distanciaMaxTeorica)
        distanciaRef.current = clamped

        // pan do centro da pinça (midpoint delta) — opcional, preserva sensação tátil
        // Não implementamos pan de pinça complexo para manter matemática simples e testável;
        // o alvo é re-clampado para não sair dos limites.
        const aspect = aspectoAtual(size)
        alvoRef.current = clampAlvo(alvoRef.current, clamped, FOV_CAMERA, aspect, LARGURA_MESA, PROFUNDIDADE_MESA)
        invalidate()
        return
      }

      if (!dragRef.current.ativo || dragRef.current.pointerId !== e.pointerId) return

      const totalDx = e.clientX - dragRef.current.inicioX
      const totalDy = e.clientY - dragRef.current.inicioY

      if (!dragRef.current.arrastou) {
        if (!atingiuLimiar(totalDx, totalDy)) return
        dragRef.current.arrastou = true
        didPanRef.current = true
      }

      const dx = e.clientX - dragRef.current.ultimoX
      const dy = e.clientY - dragRef.current.ultimoY
      dragRef.current.ultimoX = e.clientX
      dragRef.current.ultimoY = e.clientY

      // Conversão px→mundo preservando limiar já superado (6px)
      void LIMIAR_ARRASTO_PX
      const h = alturaClientHeight(size, gl)
      const delta = panDeltaToWorld(dx, dy, FOV_CAMERA, distanciaRef.current, h)
      const aspecto = aspectoAtual(size)
      const alvoNovo = {
        x: alvoRef.current.x + delta.x,
        z: alvoRef.current.z + delta.z,
      }
      alvoRef.current = clampAlvo(alvoNovo, distanciaRef.current, FOV_CAMERA, aspecto, LARGURA_MESA, PROFUNDIDADE_MESA)
      invalidate()
    }

    function onPointerUp(e: PointerEvent): void {
      ponteirosRef.current.delete(e.pointerId)

      if (pinchRef.current.ativo && ponteirosRef.current.size < 2) {
        pinchRef.current.ativo = false
      }

      if (dragRef.current.pointerId === e.pointerId) {
        const arrastou = dragRef.current.arrastou
        dragRef.current.ativo = false
        dragRef.current.pointerId = null
        dragRef.current.arrastou = false
        try {
          alvoEl.releasePointerCapture(e.pointerId)
        } catch {
          // ignore
        }
        // manter didPan para suprimir click seguinte; reset no handler de click
        if (!arrastou) {
          didPanRef.current = false
        }
      } else {
        try {
          alvoEl.releasePointerCapture(e.pointerId)
        } catch {
          // ignore
        }
      }
    }

    function onPointerCancel(e: PointerEvent): void {
      onPointerUp(e)
    }

    function onWheel(e: WheelEvent): void {
      e.preventDefault()
      const delta = e.deltaY
      // Fator multiplicativo centrado: scroll para cima (delta negativo) aproxima
      const fator = 1 + delta * SENSIBILIDADE_WHEEL
      const novaDist = distanciaRef.current * fator
      aplicarZoom(novaDist)
    }

    function onClickCapture(e: MouseEvent): void {
      if (didPanRef.current) {
        e.preventDefault()
        e.stopPropagation()
        // permitir que o próximo clique não seja suprimido
        didPanRef.current = false
      }
    }

    alvoEl.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    alvoEl.addEventListener('wheel', onWheel, { passive: false })
    alvoEl.addEventListener('click', onClickCapture, true)

    return () => {
      alvoEl.style.touchAction = prevTouchAction
      alvoEl.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      alvoEl.removeEventListener('wheel', onWheel)
      alvoEl.removeEventListener('click', onClickCapture, true)
    }
  }, [camera, gl, invalidate, size])
}
