import { useEffect, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  atingiuLimiar,
  panDeltaToWorld,
  clampAlvo,
  calcularDistanciaMin,
  calcularDistanciaMax,
  clampDistancia,
  aspectoVisivel,
  resolverAltura,
  getBordaMolduraPxViaEstilo,
  calcularFatorPinch,
  distanciaPinch,
  poseCamera,
  SENSIBILIDADE_WHEEL,
  criarDragInicial,
  criarPinchInicial,
} from '../../game/ambiente/cameraLimites'
import type { AlvoXZ, EstadoDrag, EstadoPinch } from '../../game/ambiente/cameraLimites'
import { FOV_CAMERA } from '../../game/ambiente/contrato'

export function useCameraInterativa(): void {
  const { camera, gl, size, invalidate } = useThree()
  const { width, height } = size

  const alvoRef = useRef<AlvoXZ>({ x: 0, z: 0 })
  const distanciaRef = useRef(calcularDistanciaMin())
  const suprimirCliqueAposArrastoRef = useRef(false)

  const dragRef = useRef<EstadoDrag>(criarDragInicial())
  const pinchRef = useRef<EstadoPinch>(criarPinchInicial())

  const ponteirosRef = useRef<Map<number, { x: number; y: number }>>(new Map())

  function getBordaPx(): number {
    const el = document.querySelector('[data-testid="partida-moldura"]')
    if (!el) return 0
    const v = getComputedStyle(el).borderTopWidth
    const parsed = getBordaMolduraPxViaEstilo(v)
    if (parsed > 0) return parsed
    // Fallback: implementação atual de PartidaMoldura tem a borda no filho interno
    const inner = el.querySelector('div')
    if (inner) {
      const vi = getComputedStyle(inner).borderTopWidth
      return getBordaMolduraPxViaEstilo(vi)
    }
    return 0
  }

  function getAspectVis(): number {
    const b = getBordaPx()
    return aspectoVisivel({ width, height }, b)
  }

  function aplicarAlvoClampado(alvo: AlvoXZ, dist: number): void {
    const aspect = getAspectVis()
    alvoRef.current = clampAlvo(alvo, dist, FOV_CAMERA, aspect)
    invalidate()
  }

  const distanciaMinInicial = calcularDistanciaMin()
  const distanciaMinRef = useRef(distanciaMinInicial)
  const distanciaMaxTeoricaRef = useRef(calcularDistanciaMax(distanciaMinInicial))

  useLayoutEffect(() => {
    const nextMin = calcularDistanciaMin(getAspectVis())
    const nextMax = calcularDistanciaMax(nextMin)
    distanciaMinRef.current = nextMin
    distanciaMaxTeoricaRef.current = nextMax
    const clampedDist = clampDistancia(distanciaRef.current, nextMin, nextMax)
    if (clampedDist !== distanciaRef.current) distanciaRef.current = clampedDist
    const reClamped = clampAlvo(alvoRef.current, clampedDist, FOV_CAMERA, getAspectVis())
    if (reClamped.x !== alvoRef.current.x || reClamped.z !== alvoRef.current.z) {
      alvoRef.current = reClamped
      invalidate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, invalidate])

  /* eslint-disable react-hooks/immutability -- mutação de câmera R3F é intencional */
  useFrame(() => {
    const persp = camera as THREE.PerspectiveCamera
    const aspect = getAspectVis()
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
    const { pos, alvo: alvoVec } = poseCamera(alvoRef.current, distanciaRef.current)
    persp.position.set(pos[0], pos[1], pos[2])
    persp.lookAt(alvoVec[0], alvoVec[1], alvoVec[2])
  })
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    const canvas = gl.domElement
    const alvoEl = (canvas.parentElement ?? canvas) as HTMLElement

    function aplicarZoom(novaDistancia: number): void {
      const clamped = clampDistancia(
        novaDistancia,
        distanciaMinRef.current,
        distanciaMaxTeoricaRef.current,
      )
      if (clamped === distanciaRef.current) return
      distanciaRef.current = clamped
      aplicarAlvoClampado(alvoRef.current, clamped)
    }

    function onPointerDown(e: PointerEvent): void {
      ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (ponteirosRef.current.size === 2) {
        const d = distanciaPinch(ponteirosRef.current)
        pinchRef.current = {
          ativo: true,
          distInicial: d > 0 ? d : 1,
          distanciaInicial: distanciaRef.current,
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
        const distAtual = distanciaPinch(ponteirosRef.current) || 1
        const fator = calcularFatorPinch(pinchRef.current.distInicial, distAtual)
        const novaDist = pinchRef.current.distanciaInicial * fator
        const clamped = clampDistancia(
          novaDist,
          distanciaMinRef.current,
          distanciaMaxTeoricaRef.current,
        )
        distanciaRef.current = clamped
        aplicarAlvoClampado(alvoRef.current, clamped)
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

      const h = resolverAltura(height, gl.domElement.clientHeight)
      const delta = panDeltaToWorld(dx, dy, FOV_CAMERA, distanciaRef.current, h)
      const alvoNovo = {
        x: alvoRef.current.x + delta.x,
        z: alvoRef.current.z + delta.z,
      }
      aplicarAlvoClampado(alvoNovo, distanciaRef.current)
    }

    function onPointerUp(e: PointerEvent): void {
      ponteirosRef.current.delete(e.pointerId)

      if (pinchRef.current.ativo && ponteirosRef.current.size < 2) {
        pinchRef.current = criarPinchInicial()
        // Re-arme drag com o ponteiro restante, se houver
        if (ponteirosRef.current.size === 1) {
          const [[restId, pos]] = Array.from(ponteirosRef.current.entries())
          dragRef.current = {
            ativo: true,
            pointerId: restId,
            inicioX: pos.x,
            inicioY: pos.y,
            ultimoX: pos.x,
            ultimoY: pos.y,
            engatado: false,
          }
        }
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
    // getAspectVis e aplicarAlvoClampado são estáveis via width/height já listados
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl, invalidate, width, height])
}
