import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  atingiuLimiar,
  panDeltaToWorld,
  clampAlvo,
  calcularDistanciaMin,
  calcularDistanciaMax,
  clampDistancia,
  aspectoSeguro,
  resolverAltura,
} from '../../game/ambiente/cameraLimites'
import type { AlvoXZ } from '../../game/ambiente/cameraLimites'
import { FOV_CAMERA } from '../../game/ambiente/contrato'

const SENSIBILIDADE_WHEEL = 0.002

export function useCameraInterativa(): void {
  const { camera, gl, size, invalidate } = useThree()

  const alvoRef = useRef<AlvoXZ>({ x: 0, z: 0 })
  const distanciaRef = useRef(calcularDistanciaMin())
  const suprimirCliqueAposArrastoRef = useRef(false)

  const dragRef = useRef({
    ativo: false,
    pointerId: null as number | null,
    inicioX: 0,
    inicioY: 0,
    ultimoX: 0,
    ultimoY: 0,
    engatado: false,
  })

  const pinchRef = useRef<{
    ativo: boolean
    distInicial: number
    distanciaInicial: number
    centroInicial: AlvoXZ | null
  }>({ ativo: false, distInicial: 0, distanciaInicial: 0, centroInicial: null })

  const ponteirosRef = useRef<Map<number, { x: number; y: number }>>(new Map())

  /* eslint-disable react-hooks/immutability -- mutação de câmera R3F é intencional */
  useFrame(() => {
    const persp = camera as THREE.PerspectiveCamera
    const aspect = aspectoSeguro(size.width > 0 && size.height > 0 ? size.width / size.height : 1)
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
    persp.position.set(alvo.x, componente, alvo.z + componente)
    persp.lookAt(alvo.x, 0, alvo.z)
  })
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    const canvas = gl.domElement
    const alvoEl = (canvas.parentElement ?? canvas) as HTMLElement

    const distanciaMin = calcularDistanciaMin()
    const distanciaMaxTeorica = calcularDistanciaMax(distanciaMin)

    function aplicarZoom(novaDistancia: number): void {
      const clamped = clampDistancia(novaDistancia, distanciaMin, distanciaMaxTeorica)
      if (clamped === distanciaRef.current) return
      distanciaRef.current = clamped
      const aspect = aspectoSeguro(size.width > 0 && size.height > 0 ? size.width / size.height : 1)
      alvoRef.current = clampAlvo(alvoRef.current, clamped, FOV_CAMERA, aspect)
      invalidate()
    }

    function onPointerDown(e: PointerEvent): void {
      ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

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
        dragRef.current.ativo = false
        dragRef.current.engatado = false
        try {
          alvoEl.setPointerCapture(e.pointerId)
        } catch {
          // ignore
        }
        return
      }

      if (ponteirosRef.current.size > 2) return

      dragRef.current.ativo = true
      dragRef.current.pointerId = e.pointerId
      dragRef.current.inicioX = e.clientX
      dragRef.current.inicioY = e.clientY
      dragRef.current.ultimoX = e.clientX
      dragRef.current.ultimoY = e.clientY
      dragRef.current.engatado = false
      try {
        alvoEl.setPointerCapture(e.pointerId)
      } catch {
        // ignore se não suportado
      }
    }

    function onPointerMove(e: PointerEvent): void {
      if (!ponteirosRef.current.has(e.pointerId)) return
      ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (ponteirosRef.current.size === 2 && pinchRef.current.ativo) {
        const pts = Array.from(ponteirosRef.current.values())
        const dx = pts[0].x - pts[1].x
        const dy = pts[0].y - pts[1].y
        const distAtual = Math.hypot(dx, dy) || 1
        const fator = pinchRef.current.distInicial / distAtual
        const novaDist = pinchRef.current.distanciaInicial * fator
        const clamped = clampDistancia(novaDist, distanciaMin, distanciaMaxTeorica)
        distanciaRef.current = clamped
        const aspect = aspectoSeguro(size.width > 0 && size.height > 0 ? size.width / size.height : 1)
        alvoRef.current = clampAlvo(alvoRef.current, clamped, FOV_CAMERA, aspect)
        invalidate()
        return
      }

      if (!dragRef.current.ativo || dragRef.current.pointerId !== e.pointerId) return

      const totalDx = e.clientX - dragRef.current.inicioX
      const totalDy = e.clientY - dragRef.current.inicioY

      if (!dragRef.current.engatado) {
        if (!atingiuLimiar(totalDx, totalDy)) return
        dragRef.current.engatado = true
        suprimirCliqueAposArrastoRef.current = true
      }

      const dx = e.clientX - dragRef.current.ultimoX
      const dy = e.clientY - dragRef.current.ultimoY
      dragRef.current.ultimoX = e.clientX
      dragRef.current.ultimoY = e.clientY

      const h = resolverAltura(size.height, gl.domElement.clientHeight)
      const delta = panDeltaToWorld(dx, dy, FOV_CAMERA, distanciaRef.current, h)
      const aspecto = aspectoSeguro(size.width > 0 && size.height > 0 ? size.width / size.height : 1)
      const alvoNovo = {
        x: alvoRef.current.x + delta.x,
        z: alvoRef.current.z + delta.z,
      }
      alvoRef.current = clampAlvo(alvoNovo, distanciaRef.current, FOV_CAMERA, aspecto)
      invalidate()
    }

    function onPointerUp(e: PointerEvent): void {
      ponteirosRef.current.delete(e.pointerId)

      if (pinchRef.current.ativo && ponteirosRef.current.size < 2) {
        pinchRef.current.ativo = false
      }

      if (dragRef.current.pointerId === e.pointerId) {
        const engatado = dragRef.current.engatado
        dragRef.current.ativo = false
        dragRef.current.pointerId = null
        dragRef.current.engatado = false
        try {
          alvoEl.releasePointerCapture(e.pointerId)
        } catch {
          // ignore
        }
        if (!engatado) {
          suprimirCliqueAposArrastoRef.current = false
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
      const fator = 1 + delta * SENSIBILIDADE_WHEEL
      const novaDist = distanciaRef.current * fator
      aplicarZoom(novaDist)
    }

    function onClickCapture(e: MouseEvent): void {
      if (suprimirCliqueAposArrastoRef.current) {
        e.preventDefault()
        e.stopPropagation()
        suprimirCliqueAposArrastoRef.current = false
      }
    }

    alvoEl.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    alvoEl.addEventListener('wheel', onWheel, { passive: false })
    alvoEl.addEventListener('click', onClickCapture, true)

    return () => {
      alvoEl.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      alvoEl.removeEventListener('wheel', onWheel)
      alvoEl.removeEventListener('click', onClickCapture, true)
    }
  }, [camera, gl, invalidate, size])
}
